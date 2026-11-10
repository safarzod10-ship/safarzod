import secrets

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import PaidCaseOpen, PrizeFund
from app.money import MILLI_PER_STAR, milli_to_str
from app.services import ledger, prizes
from app.settings_store import PAID_CASE_PRICES, PAID_RETURN_LIMIT, RuntimeSettings

_random = secrets.SystemRandom()


class PaidCaseError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def prizes_key(price: int) -> str:
    return f"paid_case_{price}_prizes"


def fund_share(price_milli: int) -> int:
    return int(price_milli * PAID_RETURN_LIMIT)


async def current_fund(session: AsyncSession) -> int:
    fund = (await session.execute(select(PrizeFund.fund_milli).where(PrizeFund.id == 1))).scalar_one_or_none()
    return int(fund or 0)


async def _lock_fund(session: AsyncSession) -> PrizeFund:
    await session.execute(insert(PrizeFund).values(id=1, fund_milli=0, paid_in_milli=0, paid_out_milli=0).on_conflict_do_nothing(index_elements=[PrizeFund.id]))
    return (await session.execute(select(PrizeFund).where(PrizeFund.id == 1).with_for_update().execution_options(populate_existing=True))).scalar_one()


def tier_view(settings: RuntimeSettings, price: int, fund_milli: int) -> dict:
    table = settings.prizes(prizes_key(price))
    reachable = fund_milli + fund_share(price * MILLI_PER_STAR)
    available = [amount for amount, _ in table if amount <= reachable]
    return {
        "price": price,
        "prizes": prizes.table_view(settings, prizes_key(price)),
        "max": milli_to_str(max(amount for amount, _ in table)),
        "max_now": milli_to_str(max(available) if available else table[0][0]),
        "expected": milli_to_str(prizes.expected_milli(settings, prizes_key(price))),
    }


async def catalog(session: AsyncSession, settings: RuntimeSettings) -> dict:
    fund = await current_fund(session)
    return {"enabled": settings.bool("paid_cases_enabled"), "tiers": [tier_view(settings, price, fund) for price in PAID_CASE_PRICES]}


def _draw(table: list[tuple[int, int]], limit: int) -> int:
    allowed = [(amount, weight) for amount, weight in table if amount <= limit]
    if not allowed:
        allowed = [min(table)]
    amounts = [amount for amount, _ in allowed]
    weights = [weight for _, weight in allowed]
    return _random.choices(amounts, weights=weights, k=1)[0]


async def open_case(session: AsyncSession, user_id: int, price: int, key: str, settings: RuntimeSettings) -> PaidCaseOpen:
    if not settings.bool("paid_cases_enabled"):
        raise PaidCaseError("feature_disabled", "Платные кейсы сейчас недоступны")
    if price not in PAID_CASE_PRICES:
        raise PaidCaseError("not_found", "Такого кейса нет")
    user = await ledger.lock_user(session, user_id)
    scoped = f"paid:{user.id}:{key}"
    existing = (await session.execute(select(PaidCaseOpen).where(PaidCaseOpen.idempotency_key == scoped))).scalar_one_or_none()
    if existing is not None:
        return existing
    price_milli = price * MILLI_PER_STAR
    if user.balance_available < price_milli:
        raise PaidCaseError("insufficient_funds", "Недостаточно звёзд. Пополни баланс")
    fund = await _lock_fund(session)
    before = fund.fund_milli
    fund.fund_milli += fund_share(price_milli)
    fund.paid_in_milli += price_milli
    prize = _draw(settings.prizes(prizes_key(price)), fund.fund_milli)
    if prize > fund.fund_milli:
        prize = fund.fund_milli
    fund.fund_milli -= prize
    fund.paid_out_milli += prize
    fund.updated_at = utcnow()
    record = PaidCaseOpen(user_id=user.id, price=price, prize_milli=prize, fund_before_milli=before, idempotency_key=scoped)
    session.add(record)
    await session.flush()
    await ledger.debit(session, user, kind="case_purchase", amount_milli=price_milli, reason=f"Кейс за {price} ⭐", key=f"paidcase:{record.id}:buy")
    if prize > 0:
        await ledger.credit(
            session, user, kind="paid_case_reward", amount_milli=prize, pending=False, reason=f"Приз из кейса за {price} ⭐", key=f"paidcase:{record.id}:win"
        )
    await session.flush()
    return record
