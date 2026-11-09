from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import Case, Completion, Operation, User
from app.money import milli_to_str
from app.services import ledger, referrals
from app.settings_store import RuntimeSettings


class CaseError(Exception):
    pass


async def open_case(session: AsyncSession, user_id: int, case_id: int, settings: RuntimeSettings) -> Case:
    user = await ledger.lock_user(session, user_id)
    case = (await session.execute(select(Case).where(Case.id == case_id, Case.user_id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if case is None:
        raise CaseError("Кейс не найден")
    if case.state == "opened":
        return case
    if case.state != "ready":
        raise CaseError("Кейс недоступен")
    if case.source == "referral":
        operation = await ledger.credit(
            session, user, kind="referral_reward", amount_milli=case.amount_milli, pending=False, reason=case.label, key=f"case:{case.id}", case_id=case.id
        )
    else:
        completion = (await session.execute(select(Completion).where(Completion.id == case.completion_id))).scalar_one()
        if completion.status == "cancelled":
            case.state = "cancelled"
            await session.flush()
            return case
        operation = await ledger.credit(
            session,
            user,
            kind="case_reward",
            amount_milli=case.amount_milli,
            pending=completion.status != "confirmed",
            reason=case.label,
            key=f"case:{case.id}",
            case_id=case.id,
            completion_id=completion.id,
        )
    case.state = "opened"
    case.operation_id = operation.id
    case.opened_at = utcnow()
    await session.flush()
    await session.refresh(case)
    if case.source == "task" and operation.status == "completed":
        await referrals.evaluate(session, user.id, settings)
    return case


async def list_cases(session: AsyncSession, user: User) -> tuple[list[Case], list[tuple[Case, str | None]]]:
    ready = list(
        (await session.execute(select(Case).where(Case.user_id == user.id, Case.state == "ready").order_by(Case.created_at))).scalars()
    )
    opened = (
        await session.execute(
            select(Case, Operation.status)
            .outerjoin(Operation, Operation.id == Case.operation_id)
            .where(Case.user_id == user.id, Case.state.in_(("opened", "cancelled")))
            .order_by(Case.opened_at.desc().nulls_last(), Case.created_at.desc())
            .limit(100)
        )
    ).all()
    return ready, [(case, status) for case, status in opened]


def case_view(case: Case, reward_status: str | None = None) -> dict:
    revealed = case.state == "opened"
    return {
        "id": case.id,
        "source": case.source,
        "source_label": case.label,
        "state": case.state,
        "amount": milli_to_str(case.amount_milli) if revealed else None,
        "reward_status": reward_status if revealed else ("cancelled" if case.state == "cancelled" else None),
        "created_at": case.created_at,
        "opened_at": case.opened_at,
    }


async def counts(session: AsyncSession, user_id: int) -> tuple[int, int]:
    rows = dict(
        (await session.execute(select(Case.state, func.count(Case.id)).where(Case.user_id == user_id).group_by(Case.state))).all()
    )
    return rows.get("opened", 0), rows.get("ready", 0)
