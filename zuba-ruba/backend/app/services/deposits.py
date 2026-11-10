import uuid

from aiogram.types import LabeledPrice
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import Deposit
from app.money import MILLI_PER_STAR
from app.services import ledger, notifications

PAYLOAD_PREFIX = "dep:"
MIN_STARS = 1
MAX_STARS = 10000


class DepositError(Exception):
    pass


def parse_payload(payload: str | None) -> uuid.UUID | None:
    if not payload or not payload.startswith(PAYLOAD_PREFIX):
        return None
    try:
        return uuid.UUID(payload[len(PAYLOAD_PREFIX):])
    except ValueError:
        return None


def is_deposit(payload: str | None) -> bool:
    return bool(payload) and payload.startswith(PAYLOAD_PREFIX)


async def create(session: AsyncSession, bot, user_id: int, stars: int) -> tuple[Deposit, str]:
    if not MIN_STARS <= stars <= MAX_STARS:
        raise DepositError(f"Сумма от {MIN_STARS} до {MAX_STARS} ⭐")
    deposit = Deposit(user_id=user_id, stars=stars, status="created")
    session.add(deposit)
    await session.flush()
    url = await bot.create_invoice_link(
        title="Пополнение ZUBA RUBA",
        description=f"{stars} ⭐ на баланс для открытия кейсов",
        payload=f"{PAYLOAD_PREFIX}{deposit.id}",
        currency="XTR",
        prices=[LabeledPrice(label="Звёзды", amount=stars)],
    )
    return deposit, url


async def validate_checkout(session: AsyncSession, payload: str | None, currency: str, total_amount: int, payer_id: int) -> str | None:
    deposit_id = parse_payload(payload)
    deposit = (await session.execute(select(Deposit).where(Deposit.id == deposit_id))).scalar_one_or_none() if deposit_id else None
    if deposit is None:
        return "Счёт не найден"
    if deposit.status != "created":
        return "Счёт уже оплачен"
    if deposit.user_id != payer_id:
        return "Счёт выставлен другому пользователю"
    if currency != "XTR" or total_amount != deposit.stars:
        return "Сумма счёта не совпадает"
    return None


async def mark_paid(session: AsyncSession, payload: str | None, charge_id: str, payer_id: int, total_amount: int) -> Deposit | None:
    existing = (await session.execute(select(Deposit).where(Deposit.telegram_payment_charge_id == charge_id))).scalar_one_or_none()
    if existing is not None:
        return existing
    deposit_id = parse_payload(payload)
    if deposit_id is None:
        return None
    deposit = (
        await session.execute(select(Deposit).where(Deposit.id == deposit_id).with_for_update().execution_options(populate_existing=True))
    ).scalar_one_or_none()
    if deposit is None or deposit.status == "paid":
        return deposit
    user = await ledger.lock_user(session, deposit.user_id)
    operation = await ledger.credit(
        session, user, kind="deposit", amount_milli=total_amount * MILLI_PER_STAR, pending=False, reason=f"Пополнение {total_amount} ⭐", key=f"deposit:{deposit.id}"
    )
    deposit.status = "paid"
    deposit.telegram_payment_charge_id = charge_id
    deposit.operation_id = operation.id
    deposit.paid_at = utcnow()
    await notifications.enqueue(
        session,
        user.id,
        "deposit",
        f"deposit:{deposit.id}",
        "Баланс пополнен",
        f"Зачислено: +{total_amount} ⭐\n\nМожно открывать кейсы.",
        [[{"text": "Открыть кейсы", "web_app": "/cases?tab=shop"}]],
    )
    await session.flush()
    return deposit
