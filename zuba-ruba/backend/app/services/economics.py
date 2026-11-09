import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Boost, BoostPeriod, Case, Completion, Operation, User
from app.money import kopecks_to_str, milli_to_kopecks
from app.settings_store import RuntimeSettings


async def _sum(session: AsyncSession, stmt) -> int:
    return int((await session.execute(stmt)).scalar_one() or 0)


async def compute(session: AsyncSession, settings: RuntimeSettings) -> dict:
    star = settings.kopecks("star_cost_rub")
    non_boost = Completion.task_type != "boost"
    gross = await _sum(session, select(func.sum(Completion.income_kopecks)).where(non_boost, Completion.status != "cancelled"))
    confirmed = await _sum(session, select(func.sum(Completion.income_kopecks)).where(non_boost, Completion.status == "confirmed"))
    boost_income = await _sum(session, select(func.sum(BoostPeriod.income_kopecks)))
    gross += boost_income
    confirmed += boost_income
    flyer_reported = await _sum(session, select(func.sum(Completion.flyer_price_kopecks)).where(Completion.status == "confirmed"))

    def ops(kinds, status):
        return select(func.sum(Operation.amount_milli)).where(Operation.kind.in_(kinds), Operation.status == status)

    rewards_completed = await _sum(session, ops(("case_reward", "boost_reward", "reversal", "adjustment"), "completed"))
    referral_completed = await _sum(session, ops(("referral_reward",), "completed"))
    rewards_pending = await _sum(session, ops(("case_reward", "boost_reward", "referral_reward"), "pending"))
    unopened = await _sum(session, select(func.sum(Case.amount_milli)).where(Case.state == "ready"))
    balances = (
        await session.execute(
            select(
                func.coalesce(func.sum(User.balance_available), 0),
                func.coalesce(func.sum(User.balance_pending), 0),
                func.coalesce(func.sum(User.balance_withdrawing), 0),
            )
        )
    ).one()
    liabilities_milli = int(balances[0]) + int(balances[1]) + int(balances[2]) + unopened

    reward_expenses = milli_to_kopecks(rewards_completed, star)
    referral_expenses = milli_to_kopecks(referral_completed, star)
    pending_kop = milli_to_kopecks(rewards_pending, star)
    unopened_kop = milli_to_kopecks(unopened, star)
    threshold = settings.kopecks("flyer_withdraw_threshold_rub")
    fee = int(settings.decimal("flyer_fee_usd") * settings.decimal("usd_rub") * 100)
    payouts = math.ceil(confirmed / threshold) if confirmed > 0 and threshold > 0 else 0
    commissions = payouts * fee
    net = confirmed - reward_expenses - referral_expenses - commissions
    expected_costs = reward_expenses + referral_expenses + pending_kop + unopened_kop + commissions
    warning = None
    if expected_costs > confirmed:
        warning = (
            f"Ожидаемые расходы {kopecks_to_str(expected_costs)} ₽ превышают подтверждённый доход "
            f"{kopecks_to_str(confirmed)} ₽. Проверьте размер наград."
        )
    return {
        "income_gross": kopecks_to_str(gross),
        "income_confirmed": kopecks_to_str(confirmed),
        "income_flyer_reported": kopecks_to_str(flyer_reported),
        "rewards_pending": kopecks_to_str(pending_kop),
        "reward_expenses": kopecks_to_str(reward_expenses),
        "referral_expenses": kopecks_to_str(referral_expenses),
        "commissions": kopecks_to_str(commissions),
        "liabilities": kopecks_to_str(milli_to_kopecks(liabilities_milli, star)),
        "net_profit": kopecks_to_str(net),
        "unopened_cases": kopecks_to_str(unopened_kop),
        "flyer_withdraw_threshold": kopecks_to_str(threshold),
        "warning": warning,
    }


async def overview(session: AsyncSession, settings: RuntimeSettings) -> dict:
    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    users_total = await _sum(session, select(func.count(User.id)))
    active = await _sum(session, select(func.count(User.id)).where(User.last_seen_at >= day_ago))
    new = await _sum(session, select(func.count(User.id)).where(User.registered_at >= day_ago))
    by_status = dict((await session.execute(select(Completion.status, func.count(Completion.id)).group_by(Completion.status))).all())
    boosts_active = await _sum(session, select(func.count(Boost.id)).where(Boost.status == "active"))
    finance = await compute(session, settings)
    return {
        "users_total": users_total,
        "users_active_24h": active,
        "users_new_24h": new,
        "tasks_completed": sum(by_status.values()),
        "tasks_paid": by_status.get("confirmed", 0),
        "tasks_waiting": by_status.get("waiting_payment", 0) + by_status.get("holding", 0),
        "tasks_disputed": by_status.get("disputed", 0),
        "boosts_active": boosts_active,
        "income": finance["income_confirmed"],
        "reward_expenses": finance["reward_expenses"],
        "net_profit": finance["net_profit"],
        "warning": finance["warning"],
    }
