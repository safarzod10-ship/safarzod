import uuid

from aiogram.types import LabeledPrice
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import StarTopup
from app.services import audit

PAYLOAD_PREFIX = "topup:"
MIN_AMOUNT = 1
MAX_AMOUNT = 100000


class TopupError(Exception):
    pass


def payload_for(topup: StarTopup) -> str:
    return f"{PAYLOAD_PREFIX}{topup.id}"


def parse_payload(payload: str | None) -> uuid.UUID | None:
    if not payload or not payload.startswith(PAYLOAD_PREFIX):
        return None
    try:
        return uuid.UUID(payload[len(PAYLOAD_PREFIX):])
    except ValueError:
        return None


async def create(session: AsyncSession, bot, admin_id: int, amount: int) -> tuple[StarTopup, str]:
    if not MIN_AMOUNT <= amount <= MAX_AMOUNT:
        raise TopupError(f"Сумма от {MIN_AMOUNT} до {MAX_AMOUNT} ⭐")
    topup = StarTopup(admin_id=admin_id, amount=amount, status="created")
    session.add(topup)
    await session.flush()
    url = await bot.create_invoice_link(
        title="Пополнение баланса бота",
        description=f"{amount} ⭐ на баланс бота для отправки подарков пользователям",
        payload=payload_for(topup),
        currency="XTR",
        prices=[LabeledPrice(label="Stars", amount=amount)],
    )
    return topup, url


async def validate_checkout(session: AsyncSession, payload: str | None, currency: str, total_amount: int) -> str | None:
    topup_id = parse_payload(payload)
    if topup_id is None:
        return "Счёт не найден"
    topup = (await session.execute(select(StarTopup).where(StarTopup.id == topup_id))).scalar_one_or_none()
    if topup is None:
        return "Счёт не найден"
    if topup.status != "created":
        return "Счёт уже оплачен"
    if currency != "XTR" or total_amount != topup.amount:
        return "Сумма счёта не совпадает"
    return None


async def mark_paid(session: AsyncSession, payload: str | None, charge_id: str, payer_id: int, total_amount: int) -> StarTopup | None:
    existing = (await session.execute(select(StarTopup).where(StarTopup.telegram_payment_charge_id == charge_id))).scalar_one_or_none()
    if existing is not None:
        return existing
    topup_id = parse_payload(payload)
    if topup_id is None:
        return None
    topup = (
        await session.execute(select(StarTopup).where(StarTopup.id == topup_id).with_for_update().execution_options(populate_existing=True))
    ).scalar_one_or_none()
    if topup is None or topup.status == "paid":
        return topup
    topup.status = "paid"
    topup.telegram_payment_charge_id = charge_id
    topup.payer_id = payer_id
    topup.paid_at = utcnow()
    await audit.record(session, topup.admin_id, "stars.topup_paid", str(topup.id), amount=total_amount, payer_id=payer_id, charge_id=charge_id)
    await session.flush()
    return topup


def view(topup: StarTopup) -> dict:
    return {
        "id": str(topup.id),
        "admin_id": topup.admin_id,
        "amount": topup.amount,
        "status": topup.status,
        "created_at": topup.created_at,
        "paid_at": topup.paid_at,
    }
