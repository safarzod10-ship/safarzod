import base64
import csv
import hashlib
import hmac
import io
import time
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import Date, and_, cast, distinct, exists, func, literal, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Case, Completion, FlyerError, Operation, ReferralReward, TaskCheck, User, Withdrawal
from app.money import milli_to_str

REWARD_KINDS = ("case_reward", "boost_reward", "referral_reward", "daily_spin")
AUDIENCES = {
    "all": "Все пользователи бота",
    "active7": "Активные за 7 дней",
    "balance": "С доступным балансом",
    "no_tasks": "Ещё не выполняли задания",
}
USER_SORTS = {"registered_at", "last_seen_at", "available", "earned"}
USER_FILTERS = {"", "blocked", "suspicious", "withdrawing"}
EXPORT_KINDS = {"users", "operations"}
EXPORT_TTL = 300


def _day(column):
    return cast(func.timezone("UTC", column), Date)


def earned_subquery():
    return (
        select(Operation.user_id.label("user_id"), func.sum(Operation.amount_milli).label("earned"))
        .where(Operation.kind.in_(REWARD_KINDS), Operation.status == "completed")
        .group_by(Operation.user_id)
        .subquery()
    )


async def _daily(session: AsyncSession, column, since: datetime, value=None, where=()) -> dict[date, int]:
    day = _day(column)
    stmt = select(day, value if value is not None else func.count()).where(column >= since, *where).group_by(day)
    return {row[0]: int(row[1] or 0) for row in (await session.execute(stmt)).all()}


async def series(session: AsyncSession, days: int) -> dict:
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    since = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    activity = union(
        select(TaskCheck.user_id.label("user_id"), _day(TaskCheck.created_at).label("day")).where(TaskCheck.created_at >= since),
        select(Case.user_id, _day(Case.opened_at)).where(Case.opened_at >= since),
        select(Withdrawal.user_id, _day(Withdrawal.created_at)).where(Withdrawal.created_at >= since),
    ).subquery()
    active = {
        row[0]: int(row[1])
        for row in (await session.execute(select(activity.c.day, func.count(distinct(activity.c.user_id))).group_by(activity.c.day))).all()
    }
    metrics = {
        "new_users": await _daily(session, User.registered_at, since),
        "active_users": active,
        "task_checks": await _daily(session, TaskCheck.created_at, since),
        "completions": await _daily(session, Completion.completed_at, since),
        "confirmed": await _daily(session, Completion.confirmed_at, since),
        "cancelled": await _daily(session, Completion.cancelled_at, since),
        "cases_opened": await _daily(session, Case.opened_at, since),
        "payouts": await _daily(session, Withdrawal.processed_at, since, func.sum(Withdrawal.stars), (Withdrawal.status == "completed",)),
        "rewards": await _daily(
            session,
            Operation.created_at,
            since,
            func.sum(Operation.amount_milli),
            (Operation.kind.in_(REWARD_KINDS), Operation.status == "completed"),
        ),
    }
    dates = [start + timedelta(days=i) for i in range(days)]
    result = {}
    for key, values in metrics.items():
        points = [values.get(d, 0) for d in dates]
        if key == "rewards":
            result[key] = {"points": [milli_to_str(v) for v in points], "total": milli_to_str(sum(points))}
        else:
            result[key] = {"points": points, "total": sum(points)}
    return {"days": days, "dates": [d.isoformat() for d in dates], "series": result}


async def funnel(session: AsyncSession, days: int) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    cohort = select(User.id).where(User.registered_at >= since).subquery()

    async def count(condition=None) -> int:
        stmt = select(func.count()).select_from(User).where(User.id.in_(select(cohort.c.id)))
        if condition is not None:
            stmt = stmt.where(condition)
        return int((await session.execute(stmt)).scalar_one())

    steps = [
        ("registered", "Зарегистрировались", None),
        ("onboarded", "Прошли приветствие", User.onboarded_at.is_not(None)),
        ("checked", "Проверили задание", exists().where(TaskCheck.user_id == User.id)),
        ("completed", "Выполнили задание", exists().where(Completion.user_id == User.id)),
        ("opened", "Открыли кейс", exists().where(and_(Case.user_id == User.id, Case.state == "opened"))),
        ("withdrew", "Получили вывод", exists().where(and_(Withdrawal.user_id == User.id, Withdrawal.status == "completed"))),
    ]
    return [{"key": key, "label": label, "count": await count(condition)} for key, label, condition in steps]


async def top_referrers(session: AsyncSession, limit: int = 10) -> list[dict]:
    invitee = User.__table__.alias("invitee")
    confirmed = (
        select(Completion.user_id.label("user_id"), func.count().label("n")).where(Completion.status == "confirmed").group_by(Completion.user_id).subquery()
    )
    rewards = select(ReferralReward.inviter_id.label("inviter_id"), func.count().label("n")).group_by(ReferralReward.inviter_id).subquery()
    stmt = (
        select(
            User.id,
            User.username,
            User.first_name,
            func.count(distinct(invitee.c.id)).label("invited"),
            func.coalesce(func.sum(confirmed.c.n), 0).label("confirmed"),
            func.coalesce(func.max(rewards.c.n), 0).label("cases"),
        )
        .join(invitee, invitee.c.referrer_id == User.id)
        .outerjoin(confirmed, confirmed.c.user_id == invitee.c.id)
        .outerjoin(rewards, rewards.c.inviter_id == User.id)
        .group_by(User.id)
        .order_by(func.count(distinct(invitee.c.id)).desc(), User.id)
        .limit(limit)
    )
    return [
        {"id": r.id, "username": r.username, "first_name": r.first_name, "invited": r.invited, "confirmed_tasks": int(r.confirmed), "referral_cases": int(r.cases)}
        for r in (await session.execute(stmt)).all()
    ]


async def top_earners(session: AsyncSession, limit: int = 10) -> list[dict]:
    earned = earned_subquery()
    stmt = (
        select(User.id, User.username, User.first_name, earned.c.earned, User.balance_available)
        .join(earned, earned.c.user_id == User.id)
        .order_by(earned.c.earned.desc(), User.id)
        .limit(limit)
    )
    return [
        {"id": r.id, "username": r.username, "first_name": r.first_name, "earned": milli_to_str(int(r.earned)), "available": milli_to_str(r.balance_available)}
        for r in (await session.execute(stmt)).all()
    ]


async def events(session: AsyncSession, limit: int = 20) -> list[dict]:
    feed: list[dict] = []
    for w, username in (
        await session.execute(
            select(Withdrawal, User.username).join(User, User.id == Withdrawal.user_id).order_by(Withdrawal.updated_at.desc()).limit(limit)
        )
    ).all():
        feed.append(
            {
                "kind": "withdrawal",
                "at": w.updated_at,
                "user_id": w.user_id,
                "username": username,
                "title": f"Вывод {w.stars} ⭐",
                "status": w.status,
            }
        )
    for c in (await session.execute(select(Completion).where(Completion.status == "disputed").order_by(Completion.completed_at.desc()).limit(limit))).scalars():
        feed.append({"kind": "dispute", "at": c.completed_at, "user_id": c.user_id, "username": None, "title": c.title or "Задание на проверке", "status": c.note})
    for e in (await session.execute(select(FlyerError).order_by(FlyerError.created_at.desc()).limit(limit))).scalars():
        feed.append({"kind": "flyer_error", "at": e.created_at, "user_id": e.user_id, "username": None, "title": e.method, "status": e.error})
    feed.sort(key=lambda item: item["at"], reverse=True)
    return feed[:limit]


def user_conditions(q: str = "", status: str = "", invited_by: int | None = None) -> list:
    conditions = []
    query = q.strip().lstrip("@")
    if query:
        pattern = f"%{query.lower()}%"
        options = [func.lower(User.username).like(pattern), func.lower(User.first_name).like(pattern), func.lower(func.coalesce(User.last_name, "")).like(pattern)]
        if query.isdigit():
            options.append(User.id == int(query))
        conditions.append(or_(*options))
    if status == "blocked":
        conditions.append(User.is_blocked.is_(True))
    elif status == "suspicious":
        conditions.append(User.is_suspicious.is_(True))
    elif status == "withdrawing":
        conditions.append(User.balance_withdrawing > 0)
    if invited_by is not None:
        conditions.append(User.referrer_id == invited_by)
    return conditions


async def users_page(
    session: AsyncSession, q: str, status: str, invited_by: int | None, sort: str, order: str, page: int, per_page: int
) -> tuple[list[tuple[User, int]], int]:
    earned = earned_subquery()
    conditions = user_conditions(q, status, invited_by)
    total = int((await session.execute(select(func.count()).select_from(User).where(*conditions))).scalar_one())
    column = {
        "registered_at": User.registered_at,
        "last_seen_at": User.last_seen_at,
        "available": User.balance_available,
        "earned": func.coalesce(earned.c.earned, 0),
    }[sort]
    ordering = column.asc() if order == "asc" else column.desc()
    stmt = (
        select(User, func.coalesce(earned.c.earned, 0))
        .outerjoin(earned, earned.c.user_id == User.id)
        .where(*conditions)
        .order_by(ordering, User.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return [(u, int(e)) for u, e in (await session.execute(stmt)).all()], total


async def user_earned(session: AsyncSession, user_id: int) -> int:
    value = (
        await session.execute(
            select(func.coalesce(func.sum(Operation.amount_milli), 0)).where(
                Operation.user_id == user_id, Operation.kind.in_(REWARD_KINDS), Operation.status == "completed"
            )
        )
    ).scalar_one()
    return int(value)


def audience_condition(audience: str | None):
    now = datetime.now(timezone.utc)
    if audience == "active7":
        return User.last_seen_at >= now - timedelta(days=7)
    if audience == "balance":
        return User.balance_available > 0
    if audience == "no_tasks":
        return ~exists().where(Completion.user_id == User.id)
    return literal(True)


def recipients_condition(audience: str | None):
    return and_(User.bot_started_at.is_not(None), User.bot_blocked.is_(False), User.is_blocked.is_(False), audience_condition(audience))


def _sign(secret: bytes, message: str) -> str:
    return base64.urlsafe_b64encode(hmac.new(secret, message.encode(), hashlib.sha256).digest()[:24]).decode().rstrip("=")


def export_secret(bot_token: str) -> bytes:
    return hashlib.sha256(f"zuba-export:{bot_token}".encode()).digest()


def make_export_token(secret: bytes, admin_id: int, kind: str, user_id: int | None, now: float | None = None) -> str:
    expires = int((now if now is not None else time.time()) + EXPORT_TTL)
    message = f"{admin_id}.{kind}.{user_id or 0}.{expires}"
    return f"{message}.{_sign(secret, message)}"


def read_export_token(secret: bytes, token: str, kind: str, now: float | None = None) -> tuple[int, int | None] | None:
    parts = token.split(".")
    if len(parts) != 5:
        return None
    admin, token_kind, user, expires, signature = parts
    message = ".".join(parts[:4])
    if not hmac.compare_digest(_sign(secret, message), signature) or token_kind != kind:
        return None
    try:
        admin_id, user_id, expires_at = int(admin), int(user), int(expires)
    except ValueError:
        return None
    if expires_at < (now if now is not None else time.time()):
        return None
    return admin_id, (user_id or None)


def _csv_line(values: list) -> str:
    buffer = io.StringIO()
    csv.writer(buffer, delimiter=";").writerow(["" if v is None else v for v in values])
    return buffer.getvalue()


def _dt(value: datetime | None) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S") if value else ""


async def export_rows(session_factory, kind: str, user_id: int | None):
    yield "﻿"
    async with session_factory() as session:
        if kind == "users":
            yield _csv_line(["id", "username", "имя", "регистрация (UTC)", "последний вход (UTC)", "доступно ⭐", "в ожидании ⭐", "на выводе ⭐", "заработано ⭐", "пригласил", "заблокирован", "подозрительный"])
            earned = earned_subquery()
            stmt = select(User, func.coalesce(earned.c.earned, 0)).outerjoin(earned, earned.c.user_id == User.id).order_by(User.id)
            result = await session.stream(stmt.execution_options(yield_per=500))
            async for user, earned_value in result:
                yield _csv_line(
                    [
                        user.id,
                        user.username,
                        " ".join(filter(None, [user.first_name, user.last_name])),
                        _dt(user.registered_at),
                        _dt(user.last_seen_at),
                        milli_to_str(user.balance_available),
                        milli_to_str(user.balance_pending),
                        milli_to_str(user.balance_withdrawing),
                        milli_to_str(int(earned_value)),
                        user.referrer_id,
                        "да" if user.is_blocked else "нет",
                        "да" if user.is_suspicious else "нет",
                    ]
                )
        else:
            yield _csv_line(["id", "пользователь", "тип", "сумма ⭐", "статус", "основание", "создана (UTC)", "обновлена (UTC)", "админ"])
            stmt = select(Operation).order_by(Operation.created_at, Operation.id)
            if user_id is not None:
                stmt = stmt.where(Operation.user_id == user_id)
            result = await session.stream_scalars(stmt.execution_options(yield_per=500))
            async for op in result:
                yield _csv_line(
                    [str(op.id), op.user_id, op.kind, milli_to_str(op.amount_milli), op.status, op.reason, _dt(op.created_at), _dt(op.updated_at), op.admin_id]
                )


def case_status(state: str, op_status: str | None) -> str:
    if state == "ready":
        return "Не открыт"
    if state == "cancelled":
        return "Отменён"
    return {"pending": "В ожидании", "completed": "Зачислен", "cancelled": "Отменён"}.get(op_status or "", "Открыт")


async def user_cases(session: AsyncSession, user_id: int, limit: int = 100) -> list[dict]:
    rows = (
        await session.execute(
            select(Case, Operation.status)
            .outerjoin(Operation, Operation.id == Case.operation_id)
            .where(Case.user_id == user_id)
            .order_by(Case.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": c.id,
            "source": c.source,
            "label": c.label,
            "state": c.state,
            "status_label": case_status(c.state, status),
            "amount": milli_to_str(c.amount_milli),
            "created_at": c.created_at,
            "opened_at": c.opened_at,
        }
        for c, status in rows
    ]

