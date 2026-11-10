import re
from datetime import datetime

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select, tuple_, update

from app.api.common import ApiError, Ctx, balance_view, ctx, me_view, operation_view, rate_limit
from app.config import Config, get_config
from app.models import Notification, Operation, User, Withdrawal
from app.money import milli_to_str
from app.services import cases as cases_service
from app.services import deposits, paid_cases, prizes, referrals, spins, tasks, withdrawals
from app.services import users as users_service

router = APIRouter(prefix="/api")

SIGNATURE_RE = re.compile(r"^[A-Za-z0-9_\-:.=+/]{1,512}$")
IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")


@router.post("/session")
async def session_start(request: Request, c: Ctx = Depends(ctx), config: Config = Depends(get_config)):
    user, _ = await users_service.upsert(c.session, c.data.user, c.data.start_param)
    await c.session.commit()
    return me_view(user, config, c.is_admin)


@router.get("/me")
async def me(c: Ctx = Depends(ctx), config: Config = Depends(get_config)):
    return me_view(c.user, config, c.is_admin)


@router.post("/me/onboarding")
async def onboarding(c: Ctx = Depends(ctx), config: Config = Depends(get_config)):
    if c.user.onboarded_at is None:
        await c.session.execute(update(User).where(User.id == c.user.id).values(onboarded_at=func.now()))
        await c.session.commit()
        await c.session.refresh(c.user)
    return me_view(c.user, config, c.is_admin)


@router.get("/config")
async def app_config(c: Ctx = Depends(ctx), config: Config = Depends(get_config)):
    s = c.settings
    return {
        "bot_username": config.bot_username,
        "support_url": s.raw("support_url") or None,
        "maintenance": s.bool("maintenance"),
        "features": {
            "withdrawals": s.bool("withdrawals_enabled"),
            "boosts": s.bool("boosts_enabled"),
            "referrals": s.bool("referrals_enabled"),
            "tasks": s.bool("tasks_enabled"),
        },
        "rewards": {"boost": s.raw("reward_boost")},
        "case_prizes": prizes.table_view(s),
        "case_expected": milli_to_str(prizes.expected_milli(s)),
        "withdraw": {
            "min_stars": s.int("withdraw_min_stars"),
            "gift_stars": s.int_list("withdraw_gift_stars"),
            "per_day": s.int("withdrawals_per_day"),
            "auto": s.bool("withdraw_auto"),
        },
        "paid_cases": s.bool("paid_cases_enabled"),
        "limits": {"checks_per_minute": s.int("checks_per_minute"), "referral_daily_cases": s.int("referral_daily_cases_limit")},
        "hold_hours": {"channel": s.int("hold_hours_channel"), "bot": s.int("hold_hours_bot")},
        "referral_threshold": s.int("referral_threshold"),
        "boost": {
            "first_check_hours": s.int("boost_first_check_hours"),
            "interval_hours": s.int("boost_interval_hours"),
            "recurring": s.bool("boost_recurring_enabled"),
        },
        "stars_are_internal": not s.bool("withdrawals_enabled"),
        "daily_spin": {
            "enabled": s.bool("daily_spin_enabled"),
            "tasks_required": s.int("daily_spin_tasks"),
            "prizes": prizes.table_view(s, "daily_spin_prizes"),
        },
    }


@router.get("/home")
async def home(c: Ctx = Depends(ctx)):
    await c.session.execute(update(User).where(User.id == c.user.id).values(last_seen_at=func.now()))
    await c.session.commit()
    opened, ready = await cases_service.counts(c.session, c.user.id)
    unread = (
        await c.session.execute(
            select(func.count(Notification.id)).where(Notification.user_id == c.user.id, Notification.read_at.is_(None))
        )
    ).scalar_one()
    recent = (
        await c.session.execute(
            select(Operation).where(Operation.user_id == c.user.id).order_by(Operation.created_at.desc(), Operation.id.desc()).limit(5)
        )
    ).scalars()
    return {
        "balance": balance_view(c.user),
        "cases_opened": opened,
        "cases_ready": ready,
        "unread_notifications": unread,
        "recent_operations": [operation_view(op) for op in recent],
        "spin": await spins.status(c.session, c.user.id, c.settings, c.is_admin),
    }


@router.get("/spin")
async def spin_status(c: Ctx = Depends(ctx)):
    return await spins.status(c.session, c.user.id, c.settings, c.is_admin)


@router.post("/spin")
async def spin_now(request: Request, c: Ctx = Depends(ctx)):
    await rate_limit(request, f"spin:{c.user.id}", 60 if c.is_admin else 10)
    current = await spins.status(c.session, c.user.id, c.settings, c.is_admin)
    if current["test_available"]:
        return {"amount": milli_to_str(spins.test_draw(c.settings)), "test": True, "balance": balance_view(c.user), "spin": current}
    try:
        record = await spins.spin(c.session, c.user.id, c.settings)
    except spins.SpinError as exc:
        await c.session.rollback()
        raise ApiError(403 if exc.code == "feature_disabled" else 409, exc.code, str(exc)) from None
    await c.session.commit()
    await c.session.refresh(c.user)
    return {
        "amount": milli_to_str(record.amount_milli),
        "test": False,
        "balance": balance_view(c.user),
        "spin": await spins.status(c.session, c.user.id, c.settings, c.is_admin),
    }


def _parse_cursor(cursor: str | None):
    if not cursor:
        return None
    try:
        created, op_id = cursor.split("|", 1)
        return datetime.fromisoformat(created), op_id
    except ValueError:
        raise ApiError(422, "validation", "Некорректный курсор") from None


@router.get("/operations")
async def operations(cursor: str | None = None, limit: int = Query(30, ge=1, le=100), c: Ctx = Depends(ctx)):
    stmt = select(Operation).where(Operation.user_id == c.user.id)
    parsed = _parse_cursor(cursor)
    if parsed:
        stmt = stmt.where(tuple_(Operation.created_at, Operation.id) < tuple_(parsed[0], parsed[1]))
    rows = list((await c.session.execute(stmt.order_by(Operation.created_at.desc(), Operation.id.desc()).limit(limit + 1))).scalars())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = f"{rows[-1].created_at.isoformat()}|{rows[-1].id}"
    return {"items": [operation_view(op) for op in rows], "next_cursor": next_cursor}


@router.get("/notifications")
async def notification_list(c: Ctx = Depends(ctx)):
    rows = (
        await c.session.execute(
            select(Notification).where(Notification.user_id == c.user.id).order_by(Notification.created_at.desc()).limit(50)
        )
    ).scalars()
    return {
        "items": [
            {"id": n.id, "title": n.title, "text": n.text, "created_at": n.created_at, "read": n.read_at is not None}
            for n in rows
        ]
    }


@router.post("/notifications/read")
async def notification_read(c: Ctx = Depends(ctx)):
    await c.session.execute(
        update(Notification).where(Notification.user_id == c.user.id, Notification.read_at.is_(None)).values(read_at=func.now())
    )
    await c.session.commit()
    return {"ok": True}


@router.get("/tasks")
async def task_list(request: Request, type: str = Query("all", pattern="^(all|channel|bot|boost)$"), c: Ctx = Depends(ctx)):
    refresh = await request.app.state.limiter.hit(f"tasks_refresh:{c.user.id}", 1, 10)
    items, error = await tasks.list_tasks(c.session, request.app.state.flyer, c.user, c.settings, refresh=refresh)
    await c.session.commit()
    if type != "all":
        items = [task for task in items if task.task_type == type]
    return {"items": [tasks.task_view(task, c.settings) for task in items], "flyer_error": error}


@router.post("/tasks/{signature:path}/check")
async def task_check(signature: str, request: Request, c: Ctx = Depends(ctx)):
    if not SIGNATURE_RE.match(signature):
        raise ApiError(422, "validation", "Некорректное задание")
    await rate_limit(request, f"check:{c.user.id}", c.settings.int("checks_per_minute"))
    result = await tasks.check_task(c.session, request.app.state.flyer, c.user, signature, c.settings)
    await c.session.commit()
    if result["task"] is None:
        raise ApiError(404, "not_found", result["message"])
    return {
        "task": tasks.task_view(result["task"], c.settings),
        "result": result["result"],
        "message": result["message"],
        "case_id": result["case_id"],
    }


@router.get("/cases")
async def case_list(c: Ctx = Depends(ctx)):
    ready, opened = await cases_service.list_cases(c.session, c.user)
    return {
        "ready": [cases_service.case_view(case) for case in ready],
        "opened": [cases_service.case_view(case, status) for case, status in opened],
    }


@router.get("/paid-cases")
async def paid_case_catalog(c: Ctx = Depends(ctx)):
    data = await paid_cases.catalog(c.session, c.settings)
    return {**data, "balance": balance_view(c.user)}


@router.post("/paid-cases/{price}/open")
async def paid_case_open(price: int, request: Request, idempotency_key: str | None = Header(default=None), c: Ctx = Depends(ctx)):
    if not idempotency_key or not IDEMPOTENCY_RE.match(idempotency_key):
        raise ApiError(422, "validation", "Отсутствует ключ идемпотентности")
    await rate_limit(request, f"paidcase:{c.user.id}", 40)
    try:
        record = await paid_cases.open_case(c.session, c.user.id, price, idempotency_key, c.settings)
    except paid_cases.PaidCaseError as exc:
        await c.session.rollback()
        status = {"feature_disabled": 403, "not_found": 404, "insufficient_funds": 409}.get(exc.code, 422)
        raise ApiError(status, exc.code, str(exc)) from None
    await c.session.commit()
    await c.session.refresh(c.user)
    catalog = await paid_cases.catalog(c.session, c.settings)
    return {"id": record.id, "price": record.price, "prize": milli_to_str(record.prize_milli), "balance": balance_view(c.user), "tiers": catalog["tiers"]}


class DepositIn(BaseModel):
    stars: int = Field(ge=deposits.MIN_STARS, le=deposits.MAX_STARS)


@router.post("/deposits")
async def deposit_create(body: DepositIn, request: Request, c: Ctx = Depends(ctx)):
    if not c.settings.bool("paid_cases_enabled"):
        raise ApiError(403, "feature_disabled", "Пополнение сейчас недоступно")
    await rate_limit(request, f"deposit:{c.user.id}", 10)
    try:
        deposit, url = await deposits.create(c.session, request.app.state.bot, c.user.id, body.stars)
    except deposits.DepositError as exc:
        await c.session.rollback()
        raise ApiError(422, "validation", str(exc)) from None
    except Exception:
        await c.session.rollback()
        raise ApiError(502, "telegram_unavailable", "Telegram не выставил счёт. Попробуй позже.") from None
    await c.session.commit()
    return {"id": str(deposit.id), "stars": deposit.stars, "url": url}


@router.post("/cases/test")
async def case_test(request: Request, c: Ctx = Depends(ctx)):
    if not c.is_admin:
        raise ApiError(403, "forbidden", "Нет доступа")
    await rate_limit(request, f"case-test:{c.user.id}", 60)
    return {"amount": milli_to_str(prizes.draw(c.settings)), "test": True}


@router.post("/cases/{case_id}/open")
async def case_open(case_id: int, request: Request, c: Ctx = Depends(ctx)):
    await rate_limit(request, f"case:{c.user.id}", 30)
    try:
        case = await cases_service.open_case(c.session, c.user.id, case_id, c.settings)
    except cases_service.CaseError as exc:
        await c.session.rollback()
        raise ApiError(409, "conflict", str(exc)) from None
    status = None
    if case.operation_id is not None:
        status = (await c.session.execute(select(Operation.status).where(Operation.id == case.operation_id))).scalar_one()
    await c.session.commit()
    return cases_service.case_view(case, status)


@router.get("/referrals")
async def referral_summary(c: Ctx = Depends(ctx), config: Config = Depends(get_config)):
    data = await referrals.summary(c.session, c.user, c.settings)
    return {"ref_link": me_view(c.user, config, c.is_admin)["ref_link"], **data}


async def _options(request: Request, c: Ctx) -> list[withdrawals.GiftOption]:
    if not c.settings.bool("withdrawals_enabled"):
        return []
    try:
        return await withdrawals.gift_options(request.app.state.bot, c.settings)
    except Exception:
        raise ApiError(502, "telegram_unavailable", "Не удалось получить варианты вывода. Попробуйте позже.") from None


@router.get("/withdrawals")
async def withdrawal_list(request: Request, c: Ctx = Depends(ctx)):
    options = await _options(request, c)
    rows = (
        await c.session.execute(select(Withdrawal).where(Withdrawal.user_id == c.user.id).order_by(Withdrawal.created_at.desc()).limit(50))
    ).scalars()
    reason = withdrawals.disabled_reason(c.settings)
    if reason is None and not options:
        reason = "Сейчас нет доступных вариантов вывода."
    return {
        "enabled": reason is None,
        "disabled_reason": reason,
        "balance": balance_view(c.user),
        "options": [option.view() for option in options],
        "items": [withdrawals.view(w) for w in rows],
    }


class WithdrawalIn(BaseModel):
    gift_id: str = Field(min_length=1, max_length=64, pattern=r"^[0-9]+$")


@router.post("/withdrawals")
async def withdrawal_create(body: WithdrawalIn, request: Request, idempotency_key: str | None = Header(default=None), c: Ctx = Depends(ctx)):
    if not idempotency_key or not IDEMPOTENCY_RE.match(idempotency_key):
        raise ApiError(422, "validation", "Отсутствует ключ идемпотентности")
    await rate_limit(request, f"withdraw:{c.user.id}", 5)
    options = await _options(request, c)
    try:
        withdrawal = await withdrawals.create(c.session, c.user.id, body.gift_id, idempotency_key, c.settings, options)
    except withdrawals.WithdrawalError as exc:
        await c.session.rollback()
        status = {"feature_disabled": 403, "insufficient_funds": 409, "rate_limited": 429}.get(exc.code, 422)
        raise ApiError(status, exc.code, str(exc)) from None
    await c.session.commit()
    return withdrawals.view(withdrawal)

