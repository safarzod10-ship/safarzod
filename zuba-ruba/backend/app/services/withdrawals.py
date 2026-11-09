import logging
import time
from dataclasses import dataclass
from datetime import timedelta

from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import Withdrawal
from app.money import MILLI_PER_STAR, milli_to_str
from app.services import ledger, notifications
from app.settings_store import RuntimeSettings

log = logging.getLogger(__name__)

STATUS_LABELS = {
    "pending": "На рассмотрении",
    "approved": "Отправляется",
    "completed": "Отправлено",
    "rejected": "Отклонено",
    "failed": "Не выполнено",
}
GIFT_NAMES = {
    "💝": "Сердце",
    "🧸": "Мишка",
    "🎁": "Подарок",
    "🌹": "Роза",
    "🎂": "Торт",
    "💐": "Букет",
    "🚀": "Ракета",
    "🍾": "Шампанское",
    "🏆": "Кубок",
    "💍": "Кольцо",
    "💎": "Алмаз",
}


class WithdrawalError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class GiftOption:
    gift_id: str
    stars: int
    emoji: str | None

    @property
    def name(self) -> str:
        return GIFT_NAMES.get(self.emoji or "", "Подарок")

    def view(self) -> dict:
        return {"gift_id": self.gift_id, "stars": self.stars, "emoji": self.emoji, "name": self.name}


_gift_cache: tuple[float, dict[str, GiftOption]] | None = None


def cached_gift(gift_id: str | None) -> GiftOption | None:
    if gift_id is None or _gift_cache is None:
        return None
    return _gift_cache[1].get(gift_id)


async def all_gifts(bot) -> dict[str, GiftOption]:
    global _gift_cache
    if _gift_cache is None or time.monotonic() - _gift_cache[0] > 600:
        gifts = await bot.get_available_gifts()
        catalog = {}
        for gift in gifts.gifts:
            if gift.remaining_count == 0 or gift.personal_remaining_count == 0:
                continue
            emoji = getattr(getattr(gift, "sticker", None), "emoji", None)
            catalog[gift.id] = GiftOption(gift_id=gift.id, stars=gift.star_count, emoji=emoji)
        _gift_cache = (time.monotonic(), catalog)
    return _gift_cache[1]


async def gift_options(bot, settings: RuntimeSettings) -> list[GiftOption]:
    allowed = set(settings.int_list("withdraw_gift_stars"))
    minimum = settings.int("withdraw_min_stars")
    catalog = await all_gifts(bot)
    return sorted(
        (option for option in catalog.values() if option.stars in allowed and option.stars >= minimum),
        key=lambda option: (option.stars, option.gift_id),
    )


def disabled_reason(settings: RuntimeSettings) -> str | None:
    if not settings.bool("withdrawals_enabled"):
        return "Вывод временно недоступен. Звёзды продолжают копиться на балансе."
    return None


def view(withdrawal: Withdrawal) -> dict:
    gift = cached_gift(withdrawal.gift_id)
    return {
        "id": withdrawal.id,
        "amount": milli_to_str(withdrawal.amount_milli),
        "stars": withdrawal.stars,
        "gift_id": withdrawal.gift_id,
        "gift_emoji": gift.emoji if gift else None,
        "gift_name": gift.name if gift else "Подарок",
        "status": withdrawal.status,
        "status_label": STATUS_LABELS[withdrawal.status],
        "comment": withdrawal.comment,
        "created_at": withdrawal.created_at,
        "updated_at": withdrawal.updated_at,
    }


async def create(session: AsyncSession, user_id: int, gift_id: str, key: str, settings: RuntimeSettings, options: list[GiftOption]) -> Withdrawal:
    reason = disabled_reason(settings)
    if reason:
        raise WithdrawalError("feature_disabled", reason)
    user = await ledger.lock_user(session, user_id)
    scoped_key = f"withdrawal:{user.id}:{key}"
    existing = (await session.execute(select(Withdrawal).where(Withdrawal.idempotency_key == scoped_key))).scalar_one_or_none()
    if existing is not None:
        return existing
    option = next((o for o in options if o.gift_id == gift_id), None)
    if option is None:
        raise WithdrawalError("validation", "Этот подарок сейчас недоступен для вывода")
    since = utcnow() - timedelta(hours=24)
    recent = (
        await session.execute(
            select(func.count(Withdrawal.id)).where(Withdrawal.user_id == user.id, Withdrawal.created_at >= since, Withdrawal.status != "rejected")
        )
    ).scalar_one()
    if recent >= settings.int("withdrawals_per_day"):
        raise WithdrawalError("rate_limited", "Достигнут лимит заявок на сутки")
    amount = option.stars * MILLI_PER_STAR
    if user.balance_available < amount:
        raise WithdrawalError("insufficient_funds", "Недостаточно доступного баланса")
    withdrawal = Withdrawal(user_id=user.id, amount_milli=amount, stars=option.stars, gift_id=option.gift_id, status="pending", idempotency_key=scoped_key)
    session.add(withdrawal)
    await session.flush()
    operation = await ledger.reserve_withdrawal(session, user, amount, f"Вывод: {option.name}, {option.stars} ⭐", f"wd:{withdrawal.id}", withdrawal.id)
    withdrawal.operation_id = operation.id
    await notifications.withdrawal_status(session, user.id, withdrawal.id, "pending", option.stars, None)
    await session.flush()
    return withdrawal


async def _lock(session: AsyncSession, withdrawal_id: int) -> Withdrawal:
    withdrawal = (
        await session.execute(select(Withdrawal).where(Withdrawal.id == withdrawal_id).with_for_update().execution_options(populate_existing=True))
    ).scalar_one_or_none()
    if withdrawal is None:
        raise WithdrawalError("not_found", "Заявка не найдена")
    return withdrawal


async def mark_processing(session: AsyncSession, withdrawal_id: int, admin_id: int | None) -> Withdrawal:
    withdrawal = await _lock(session, withdrawal_id)
    if withdrawal.status != "pending":
        raise WithdrawalError("conflict", "Заявка уже обработана")
    withdrawal.status = "approved"
    withdrawal.admin_id = admin_id
    withdrawal.updated_at = utcnow()
    await session.flush()
    return withdrawal


async def finish(session: AsyncSession, withdrawal_id: int, success: bool, error: str | None, comment: str | None = None) -> Withdrawal:
    withdrawal = await _lock(session, withdrawal_id)
    if withdrawal.status not in ("approved", "pending"):
        raise WithdrawalError("conflict", "Заявка уже обработана")
    user = await ledger.lock_user(session, withdrawal.user_id)
    operation = await ledger.lock_operation(session, withdrawal.operation_id)
    status = "completed" if success else ("failed" if withdrawal.status == "approved" and error else "rejected")
    await ledger.settle_withdrawal(session, user, operation, success, None if success else f"Вывод {withdrawal.stars} ⭐: {STATUS_LABELS[status].lower()}")
    withdrawal.status = status
    withdrawal.error = error
    withdrawal.comment = comment
    withdrawal.processed_at = utcnow()
    withdrawal.updated_at = utcnow()
    await notifications.withdrawal_status(session, user.id, withdrawal.id, status, withdrawal.stars, comment)
    await session.flush()
    return withdrawal


async def send_gift(session: AsyncSession, bot, withdrawal_id: int, admin_id: int | None, comment: str | None = None) -> Withdrawal:
    withdrawal = await mark_processing(session, withdrawal_id, admin_id)
    await session.commit()
    try:
        sent = await bot.send_gift(gift_id=withdrawal.gift_id, user_id=withdrawal.user_id, text="Вывод из ZUBA RUBA")
    except (TelegramBadRequest, TelegramForbiddenError) as exc:
        withdrawal = await finish(session, withdrawal.id, False, str(exc)[:500], comment)
        await session.commit()
        return withdrawal
    except Exception as exc:
        log.error("send_gift uncertain result for withdrawal %s: %s", withdrawal.id, exc)
        raise WithdrawalError("uncertain", "Telegram не подтвердил отправку. Проверьте баланс бота и историю подарков, затем завершите заявку вручную.") from exc
    withdrawal = await finish(session, withdrawal.id, bool(sent), None if sent else "Telegram вернул отказ", comment)
    await session.commit()
    return withdrawal


async def due_auto(session: AsyncSession, limit: int = 10) -> list[int]:
    rows = await session.execute(select(Withdrawal.id).where(Withdrawal.status == "pending").order_by(Withdrawal.created_at).limit(limit))
    return [row[0] for row in rows]
