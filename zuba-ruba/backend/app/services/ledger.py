from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import Operation, User

KINDS = {
    "case_reward",
    "boost_reward",
    "referral_reward",
    "daily_spin",
    "deposit",
    "case_purchase",
    "paid_case_reward",
    "reversal",
    "adjustment",
    "withdrawal",
}


class LedgerError(Exception):
    pass


class InsufficientFunds(LedgerError):
    pass


async def lock_user(session: AsyncSession, user_id: int) -> User:
    user = (await session.execute(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if user is None:
        raise LedgerError("user not found")
    return user


async def find(session: AsyncSession, key: str) -> Operation | None:
    return (await session.execute(select(Operation).where(Operation.idempotency_key == key))).scalar_one_or_none()


async def lock_operation(session: AsyncSession, operation_id) -> Operation:
    return (await session.execute(select(Operation).where(Operation.id == operation_id).with_for_update().execution_options(populate_existing=True))).scalar_one()


async def credit(
    session: AsyncSession,
    user: User,
    *,
    kind: str,
    amount_milli: int,
    pending: bool,
    reason: str,
    key: str,
    **links,
) -> Operation:
    if kind not in KINDS or amount_milli <= 0:
        raise LedgerError("invalid credit")
    existing = await find(session, key)
    if existing is not None:
        return existing
    operation = Operation(
        user_id=user.id,
        kind=kind,
        amount_milli=amount_milli,
        status="pending" if pending else "completed",
        reason=reason,
        idempotency_key=key,
        **links,
    )
    session.add(operation)
    if pending:
        user.balance_pending += amount_milli
    else:
        user.balance_available += amount_milli
    await session.flush()
    return operation


async def release(session: AsyncSession, user: User, operation: Operation) -> bool:
    if operation.status != "pending" or operation.amount_milli <= 0 or operation.kind == "withdrawal":
        return False
    user.balance_pending -= operation.amount_milli
    user.balance_available += operation.amount_milli
    operation.status = "completed"
    operation.updated_at = utcnow()
    await session.flush()
    return True


async def cancel_pending(session: AsyncSession, user: User, operation: Operation, reason: str) -> bool:
    if operation.status != "pending" or operation.kind == "withdrawal":
        return False
    user.balance_pending -= operation.amount_milli
    operation.status = "cancelled"
    operation.reason = reason
    operation.updated_at = utcnow()
    await session.flush()
    return True


async def reverse_completed(session: AsyncSession, user: User, operation: Operation, reason: str, admin_id: int | None) -> Operation:
    if operation.status != "completed" or operation.amount_milli <= 0:
        raise LedgerError("only completed credits can be reversed")
    key = f"reversal:{operation.id}"
    existing = await find(session, key)
    if existing is not None:
        return existing
    reversal = Operation(
        user_id=user.id,
        kind="reversal",
        amount_milli=-operation.amount_milli,
        status="completed",
        reason=reason,
        idempotency_key=key,
        case_id=operation.case_id,
        completion_id=operation.completion_id,
        admin_id=admin_id,
    )
    session.add(reversal)
    user.balance_available -= operation.amount_milli
    await session.flush()
    return reversal


async def debit(session: AsyncSession, user: User, *, kind: str, amount_milli: int, reason: str, key: str) -> Operation:
    if kind not in KINDS or amount_milli <= 0:
        raise LedgerError("invalid debit")
    existing = await find(session, key)
    if existing is not None:
        return existing
    if user.balance_available < amount_milli:
        raise InsufficientFunds("Недостаточно звёзд на балансе")
    operation = Operation(user_id=user.id, kind=kind, amount_milli=-amount_milli, status="completed", reason=reason, idempotency_key=key)
    session.add(operation)
    user.balance_available -= amount_milli
    await session.flush()
    return operation


async def adjust(session: AsyncSession, user: User, amount_milli: int, reason: str, key: str, admin_id: int) -> Operation:
    if amount_milli == 0:
        raise LedgerError("zero adjustment")
    existing = await find(session, key)
    if existing is not None:
        return existing
    if amount_milli < 0 and user.balance_available + amount_milli < 0:
        raise InsufficientFunds("Недостаточно доступного баланса для списания")
    operation = Operation(
        user_id=user.id,
        kind="adjustment",
        amount_milli=amount_milli,
        status="completed",
        reason=reason,
        idempotency_key=key,
        admin_id=admin_id,
    )
    session.add(operation)
    user.balance_available += amount_milli
    await session.flush()
    return operation


async def reserve_withdrawal(session: AsyncSession, user: User, amount_milli: int, reason: str, key: str, withdrawal_id: int) -> Operation:
    if amount_milli <= 0:
        raise LedgerError("invalid amount")
    if user.balance_available < amount_milli:
        raise InsufficientFunds("Недостаточно доступного баланса")
    operation = Operation(
        user_id=user.id,
        kind="withdrawal",
        amount_milli=-amount_milli,
        status="pending",
        reason=reason,
        idempotency_key=key,
        withdrawal_id=withdrawal_id,
    )
    session.add(operation)
    user.balance_available -= amount_milli
    user.balance_withdrawing += amount_milli
    await session.flush()
    return operation


async def settle_withdrawal(session: AsyncSession, user: User, operation: Operation, success: bool, reason: str | None = None) -> None:
    if operation.kind != "withdrawal" or operation.status != "pending":
        raise LedgerError("withdrawal already settled")
    amount = -operation.amount_milli
    user.balance_withdrawing -= amount
    if success:
        operation.status = "completed"
    else:
        user.balance_available += amount
        operation.status = "failed"
    if reason:
        operation.reason = reason
    operation.updated_at = utcnow()
    await session.flush()


async def recompute(session: AsyncSession, user_id: int) -> dict[str, int]:
    rows = (
        await session.execute(
            select(Operation.kind, Operation.status, func.coalesce(func.sum(Operation.amount_milli), 0))
            .where(Operation.user_id == user_id)
            .group_by(Operation.kind, Operation.status)
        )
    ).all()
    available = pending = withdrawing = 0
    for kind, status, total in rows:
        total = int(total)
        if kind == "withdrawal":
            if status == "completed":
                available += total
            elif status == "pending":
                available += total
                withdrawing -= total
        elif status == "completed":
            available += total
        elif status == "pending":
            pending += total
    return {"available": available, "pending": pending, "withdrawing": withdrawing}


async def touch_user_seen(session: AsyncSession, user_id: int) -> None:
    await session.execute(update(User).where(User.id == user_id).values(last_seen_at=func.now()))
