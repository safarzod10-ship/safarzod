import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import Withdrawal
from app.money import MILLI_PER_STAR, milli_to_str
from app.services import ledger, notifications
from app.settings_store import RuntimeSettings

STATUS_LABELS = {
    "pending": "На рассмотрении",
    "approved": "Выполняется",
    "completed": "Выполнено",
    "rejected": "Отклонено",
    "failed": "Не выполнено",
}


class WithdrawalError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class GiftOption:
    gift_id: str
    stars: int


_gift_cache: tuple[float, list[GiftOption]] | None = None


async def gift_options(bot, settings: RuntimeSettings) -> list[GiftOption]:
    global _gift_cache
    if _gift_cache is None or time.monotonic() - _gift_cache[0] > 600:
        gifts = await bot.get_available_gifts()
        options: dict[int, GiftOption] = {}
        for gift in gifts.gifts:
            if gift.remaining_count == 0 or gift.personal_remaining_count == 0:
                continue
            options.setdefault(gift.star_count, GiftOption(gift_id=gift.id, stars=gift.star_count))
        _gift_cache = (time.monotonic(), sorted(options.values(), key=lambda o: o.stars))
    minimum = settings.int("withdraw_min_stars")
    return [option for option in _gift_cache[1] if option.stars >= minimum]


def disabled_reason(settings: RuntimeSettings) -> str | None:
    if not settings.bool("withdrawals_enabled"):
        return "Вывод временно недоступен. Баллы ⭐ продолжают копиться на балансе."
    return None


def view(withdrawal: Withdrawal) -> dict:
    return {
        "id": withdrawal.id,
        "amount": milli_to_str(withdrawal.amount_milli),
        "status": withdrawal.status,
        "status_label": STATUS_LABELS[withdrawal.status],
        "comment": withdrawal.comment,
        "created_at": withdrawal.created_at,
        "updated_at": withdrawal.updated_at,
    }


async def create(session: AsyncSession, user_id: int, stars: int, key: str, settings: RuntimeSettings, options: list[GiftOption]) -> Withdrawal:
    reason = disabled_reason(settings)
    if reason:
        raise WithdrawalError("feature_disabled", reason)
    user = await ledger.lock_user(session, user_id)
    scoped_key = f"withdrawal:{user.id}:{key}"
    existing = (await session.execute(select(Withdrawal).where(Withdrawal.idempotency_key == scoped_key))).scalar_one_or_none()
    if existing is not None:
        return existing
    option = next((o for o in options if o.stars == stars), None)
    if option is None:
        raise WithdrawalError("validation", "Выберите сумму из предложенных")
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    recent = (
        await session.execute(
            select(func.count(Withdrawal.id)).where(Withdrawal.user_id == user.id, Withdrawal.created_at >= since, Withdrawal.status != "rejected")
        )
    ).scalar_one()
    if recent >= settings.int("withdrawals_per_day"):
        raise WithdrawalError("rate_limited", "Достигнут лимит заявок на сутки")
    amount = stars * MILLI_PER_STAR
    if user.balance_available < amount:
        raise WithdrawalError("insufficient_funds", "Недостаточно доступного баланса")
    withdrawal = Withdrawal(user_id=user.id, amount_milli=amount, stars=stars, gift_id=option.gift_id, status="pending", idempotency_key=scoped_key)
    session.add(withdrawal)
    await session.flush()
    operation = await ledger.reserve_withdrawal(session, user, amount, f"Вывод {stars} ⭐ подарком Telegram", f"wd:{withdrawal.id}", withdrawal.id)
    withdrawal.operation_id = operation.id
    await notifications.withdrawal_status(session, user.id, withdrawal.id, "pending", stars, None)
    await session.flush()
    return withdrawal


async def _lock(session: AsyncSession, withdrawal_id: int) -> Withdrawal:
    withdrawal = (await session.execute(select(Withdrawal).where(Withdrawal.id == withdrawal_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if withdrawal is None:
        raise WithdrawalError("not_found", "Заявка не найдена")
    return withdrawal


async def mark_processing(session: AsyncSession, withdrawal_id: int, admin_id: int) -> Withdrawal:
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
