from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Case, Operation, ReferralReward, User
from app.services import notifications
from app.settings_store import RuntimeSettings


async def confirmed_case_count(session: AsyncSession, user_id: int) -> int:
    return (
        await session.execute(
            select(func.count(Case.id))
            .join(Operation, Operation.id == Case.operation_id)
            .where(Case.user_id == user_id, Case.source == "task", Case.state == "opened", Operation.status == "completed")
        )
    ).scalar_one()


async def evaluate(session: AsyncSession, invitee_id: int, settings: RuntimeSettings) -> list[Case]:
    if not settings.bool("referrals_enabled"):
        return []
    invitee = (await session.execute(select(User).where(User.id == invitee_id).with_for_update().execution_options(populate_existing=True))).scalar_one()
    if invitee.referrer_id is None or invitee.is_suspicious or invitee.is_blocked:
        return []
    inviter = (await session.execute(select(User).where(User.id == invitee.referrer_id))).scalar_one()
    if inviter.is_blocked or inviter.is_suspicious:
        return []
    threshold = settings.int("referral_threshold")
    groups = await confirmed_case_count(session, invitee.id) // threshold
    existing = (await session.execute(select(func.count(ReferralReward.id)).where(ReferralReward.invitee_id == invitee.id))).scalar_one()
    if groups <= existing:
        return []
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    issued_today = (
        await session.execute(select(func.count(ReferralReward.id)).where(ReferralReward.inviter_id == inviter.id, ReferralReward.created_at >= since))
    ).scalar_one()
    daily_limit = settings.int("referral_daily_cases_limit")
    amount = settings.milli("reward_referral_case")
    name = f"@{invitee.username}" if invitee.username else invitee.first_name or "друга"
    created: list[Case] = []
    for group_index in range(existing, groups):
        if issued_today >= daily_limit:
            break
        case = Case(
            user_id=inviter.id,
            source="referral",
            label=f"Подарочный кейс за {name}",
            referral_key=f"ref:{invitee.id}:{group_index}",
            amount_milli=amount,
        )
        session.add(case)
        await session.flush()
        session.add(ReferralReward(inviter_id=inviter.id, invitee_id=invitee.id, group_index=group_index, case_id=case.id))
        await session.flush()
        await notifications.referral_case(session, inviter.id, case.id, threshold)
        issued_today += 1
        created.append(case)
    return created


async def pending_invitees(session: AsyncSession, limit: int = 200) -> list[int]:
    threshold_rows = (
        await session.execute(
            select(User.id).where(User.referrer_id.is_not(None), User.is_blocked.is_(False), User.is_suspicious.is_(False)).order_by(User.last_seen_at.desc()).limit(limit)
        )
    ).all()
    return [row[0] for row in threshold_rows]


async def summary(session: AsyncSession, user: User, settings: RuntimeSettings) -> dict:
    threshold = settings.int("referral_threshold")
    invited = (await session.execute(select(func.count(User.id)).where(User.referrer_id == user.id))).scalar_one()
    received = (await session.execute(select(func.count(ReferralReward.id)).where(ReferralReward.inviter_id == user.id))).scalar_one()
    counts = (
        await session.execute(
            select(Case.user_id, func.count(Case.id))
            .join(Operation, Operation.id == Case.operation_id)
            .join(User, User.id == Case.user_id)
            .where(User.referrer_id == user.id, Case.source == "task", Case.state == "opened", Operation.status == "completed")
            .group_by(Case.user_id)
        )
    ).all()
    progress = max((count % threshold for _, count in counts), default=0)
    return {"invited": invited, "progress": progress, "threshold": threshold, "cases_received": received}
