import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

from aiogram.exceptions import TelegramAPIError, TelegramBadRequest, TelegramForbiddenError
from fastapi import APIRouter, Depends, File, Form, Header, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_, select, tuple_
from sqlalchemy import case as sql_case

from app import settings_store
from app.api.common import ApiError, Ctx, admin_ctx, operation_view
from app.bot.messages import send_broadcast
from app.clock import utcnow
from app.config import get_config
from app.db import sessionmaker
from app.models import (
    AuditLog,
    Boost,
    Broadcast,
    Completion,
    FlyerError,
    FlyerTask,
    Operation,
    StarTopup,
    TaskCheck,
    User,
    Withdrawal,
)
from app.money import AmountError, kopecks_to_str, milli_to_str, stars_to_milli
from app.services import analytics, audit, economics, ledger, tasks, topups, withdrawals

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin")

IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGE = 5 * 1024 * 1024


def user_row(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "first_name": user.first_name,
        "registered_at": user.registered_at,
        "last_seen_at": user.last_seen_at,
        "available": milli_to_str(user.balance_available),
        "pending": milli_to_str(user.balance_pending),
        "is_blocked": user.is_blocked,
    }


def completion_view(c: Completion) -> dict:
    return {
        "id": c.id,
        "user_id": c.user_id,
        "signature": c.signature,
        "type": c.task_type,
        "title": c.title,
        "status": c.status,
        "status_label": tasks.COMPLETION_LABELS[c.status],
        "flyer_status": c.flyer_status,
        "reward": milli_to_str(c.reward_milli),
        "income": kopecks_to_str(c.income_kopecks),
        "completed_at": c.completed_at,
        "hold_until": c.hold_until,
        "next_check_at": c.next_check_at,
        "note": c.note,
    }


def boost_view(b: Boost) -> dict:
    return {
        "id": b.id,
        "user_id": b.user_id,
        "channel": b.channel,
        "link": b.link,
        "status": b.status,
        "assigned_at": b.assigned_at,
        "last_check_at": b.last_check_at,
        "next_check_at": b.next_check_at,
        "periods_paid": b.periods_paid,
        "rewarded": milli_to_str(b.rewarded_milli),
    }


@router.get("/overview")
async def overview(c: Ctx = Depends(admin_ctx)):
    return await economics.overview(c.session, c.settings)


@router.get("/analytics")
async def analytics_view(days: int = Query(30), c: Ctx = Depends(admin_ctx)):
    if days not in (7, 30, 90):
        raise ApiError(422, "validation", "Период: 7, 30 или 90 дней")
    data = await analytics.series(c.session, days)
    return {
        **data,
        "funnel": await analytics.funnel(c.session, days),
        "top_referrers": await analytics.top_referrers(c.session),
        "top_earners": await analytics.top_earners(c.session),
        "events": await analytics.events(c.session),
    }


@router.get("/users")
async def users(
    q: str = "",
    status: str = "",
    invited_by: int | None = None,
    sort: str = "last_seen_at",
    order: str = "desc",
    page: int = Query(1, ge=1, le=100000),
    per_page: int = Query(50, ge=1, le=200),
    c: Ctx = Depends(admin_ctx),
):
    if sort not in analytics.USER_SORTS or order not in ("asc", "desc") or status not in analytics.USER_FILTERS:
        raise ApiError(422, "validation", "Некорректные параметры списка")
    rows, total = await analytics.users_page(c.session, q, status, invited_by, sort, order, page, per_page)
    return {
        "items": [{**user_row(u), "earned": milli_to_str(earned), "is_suspicious": u.is_suspicious, "withdrawing": milli_to_str(u.balance_withdrawing)} for u, earned in rows],
        "total": total,
        "page": page,
        "pages": max(1, -(-total // per_page)),
    }


async def _user_or_404(c: Ctx, user_id: int) -> User:
    user = (await c.session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise ApiError(404, "not_found", "Пользователь не найден")
    return user


@router.get("/users/{user_id}")
async def user_card(user_id: int, c: Ctx = Depends(admin_ctx)):
    user = await _user_or_404(c, user_id)
    s = c.session
    ops = (await s.execute(select(Operation).where(Operation.user_id == user.id).order_by(Operation.created_at.desc()).limit(200))).scalars()
    referrer = None
    if user.referrer_id is not None:
        ref_user = (await s.execute(select(User).where(User.id == user.referrer_id))).scalar_one_or_none()
        if ref_user is not None:
            referrer = {"id": ref_user.id, "username": ref_user.username, "first_name": ref_user.first_name}
    confirmed = (
        select(Completion.user_id, func.count(Completion.id).label("n")).where(Completion.status == "confirmed").group_by(Completion.user_id).subquery()
    )
    refs = (
        await s.execute(
            select(User, func.coalesce(confirmed.c.n, 0))
            .outerjoin(confirmed, confirmed.c.user_id == User.id)
            .where(User.referrer_id == user.id)
            .order_by(User.registered_at.desc())
            .limit(200)
        )
    ).all()
    completions = (await s.execute(select(Completion).where(Completion.user_id == user.id).order_by(Completion.completed_at.desc()).limit(100))).scalars()
    boosts = (await s.execute(select(Boost).where(Boost.user_id == user.id).order_by(Boost.assigned_at.desc()).limit(50))).scalars()
    wds = (await s.execute(select(Withdrawal).where(Withdrawal.user_id == user.id).order_by(Withdrawal.created_at.desc()).limit(50))).scalars()
    return {
        "user": {
            **user_row(user),
            "last_name": user.last_name,
            "language_code": user.language_code,
            "referrer_id": user.referrer_id,
            "block_reason": user.block_reason,
            "is_suspicious": user.is_suspicious,
            "withdrawing": milli_to_str(user.balance_withdrawing),
            "earned": milli_to_str(await analytics.user_earned(s, user.id)),
            "onboarded": user.onboarded_at is not None,
            "bot_blocked": user.bot_blocked,
        },
        "referrer": referrer,
        "cases": await analytics.user_cases(s, user.id),
        "operations": [operation_view(op) for op in ops],
        "referrals": [
            {"id": r.id, "username": r.username, "first_name": r.first_name, "registered_at": r.registered_at, "confirmed_tasks": n} for r, n in refs
        ],
        "completions": [completion_view(x) for x in completions],
        "boosts": [boost_view(b) for b in boosts],
        "withdrawals": [withdrawals.view(w) for w in wds],
    }


class BlockIn(BaseModel):
    blocked: bool
    reason: str = Field(default="", max_length=500)
    suspicious: bool | None = None


@router.post("/users/{user_id}/block")
async def block(user_id: int, body: BlockIn, c: Ctx = Depends(admin_ctx)):
    await _user_or_404(c, user_id)
    user = await ledger.lock_user(c.session, user_id)
    if user.id in get_config().admin_ids and body.blocked:
        raise ApiError(422, "validation", "Нельзя заблокировать администратора")
    was_blocked = user.is_blocked
    if body.blocked and not body.reason.strip():
        raise ApiError(422, "validation", "Укажите причину блокировки")
    user.is_blocked = body.blocked
    user.block_reason = body.reason.strip() if body.blocked else None
    if body.suspicious is not None:
        user.is_suspicious = body.suspicious
    action = "user.block" if body.blocked else "user.unblock"
    if body.blocked == was_blocked and body.suspicious is not None:
        action = "user.suspicious" if body.suspicious else "user.trusted"
    await audit.record(c.session, c.user.id, action, user.id, reason=body.reason, suspicious=user.is_suspicious)
    await c.session.commit()
    return user_row(user)


class AdjustIn(BaseModel):
    amount: str
    reason: str = Field(min_length=3, max_length=500)


@router.post("/users/{user_id}/adjust")
async def adjust(user_id: int, body: AdjustIn, idempotency_key: str | None = Header(default=None), c: Ctx = Depends(admin_ctx)):
    if not idempotency_key or not IDEMPOTENCY_RE.match(idempotency_key):
        raise ApiError(422, "validation", "Отсутствует ключ идемпотентности")
    try:
        amount = stars_to_milli(body.amount)
    except AmountError as exc:
        raise ApiError(422, "validation", str(exc)) from None
    if amount == 0 or abs(amount) > 1_000_000_000:
        raise ApiError(422, "validation", "Некорректная сумма")
    await _user_or_404(c, user_id)
    user = await ledger.lock_user(c.session, user_id)
    key = f"adjust:{idempotency_key}"
    existing = await ledger.find(c.session, key)
    if existing is not None:
        return operation_view(existing)
    try:
        op = await ledger.adjust(c.session, user, amount, body.reason.strip(), key, c.user.id)
    except ledger.InsufficientFunds as exc:
        await c.session.rollback()
        raise ApiError(409, "insufficient_funds", str(exc)) from None
    await audit.record(c.session, c.user.id, "balance.adjust", user.id, amount=milli_to_str(amount), reason=body.reason.strip(), operation=str(op.id))
    await c.session.commit()
    return operation_view(op)


@router.get("/tasks")
async def task_stats(c: Ctx = Depends(admin_ctx)):
    s = c.session
    labels = {"channel": "Подписки", "bot": "Боты", "boost": "Бусты", "other": "Прочие"}
    stats = {
        t: {"type": t, "label": label, "completed": 0, "paid": 0, "waiting": 0, "cancelled": 0, "checks": 0, "checks_success": 0}
        for t, label in labels.items()
    }
    for task_type, status, n in (await s.execute(select(Completion.task_type, Completion.status, func.count()).group_by(Completion.task_type, Completion.status))).all():
        row = stats[task_type]
        row["completed"] += n
        if status == "confirmed":
            row["paid"] += n
        elif status in ("waiting_payment", "holding", "disputed"):
            row["waiting"] += n
        elif status == "cancelled":
            row["cancelled"] += n
    check_rows = await s.execute(
        select(
            FlyerTask.task_type,
            func.count(TaskCheck.id),
            func.sum(sql_case((TaskCheck.flyer_status.in_(("waiting", "complete")), 1), else_=0)),
        )
        .join(FlyerTask, FlyerTask.id == TaskCheck.task_id)
        .group_by(FlyerTask.task_type)
    )
    for task_type, total, success in check_rows.all():
        stats[task_type]["checks"] = total
        stats[task_type]["checks_success"] = int(success or 0)
    errors = (await s.execute(select(FlyerError).order_by(FlyerError.created_at.desc()).limit(50))).scalars()
    unpaid = (
        await s.execute(select(Completion).where(Completion.status.in_(("waiting_payment", "holding"))).order_by(Completion.completed_at).limit(100))
    ).scalars()
    disputed = (await s.execute(select(Completion).where(Completion.status == "disputed").order_by(Completion.completed_at).limit(100))).scalars()
    history = (
        await s.execute(
            select(TaskCheck, FlyerTask.signature).join(FlyerTask, FlyerTask.id == TaskCheck.task_id).order_by(TaskCheck.created_at.desc()).limit(100)
        )
    ).all()
    return {
        "by_type": list(stats.values()),
        "flyer_errors": [{"created_at": e.created_at, "method": e.method, "error": e.error} for e in errors],
        "unpaid": [completion_view(x) for x in unpaid],
        "disputed": [completion_view(x) for x in disputed],
        "history": [
            {"created_at": ch.created_at, "user_id": ch.user_id, "signature": sig, "flyer_status": ch.flyer_status or "ошибка", "source": ch.source}
            for ch, sig in history
        ],
    }


class ResolveIn(BaseModel):
    action: str = Field(pattern="^(confirm|cancel)$")
    note: str = Field(default="", max_length=500)


@router.post("/completions/{completion_id}/resolve")
async def resolve(completion_id: int, body: ResolveIn, c: Ctx = Depends(admin_ctx)):
    try:
        completion = await tasks.resolve(c.session, completion_id, body.action, body.note.strip(), c.user.id, c.settings)
    except ValueError as exc:
        await c.session.rollback()
        raise ApiError(409, "conflict", str(exc)) from None
    if completion is None:
        raise ApiError(404, "not_found", "Задание не найдено")
    await audit.record(c.session, c.user.id, f"completion.{body.action}", completion.id, note=body.note.strip(), user_id=completion.user_id)
    await c.session.commit()
    return completion_view(completion)


@router.get("/finance")
async def finance(request: Request, c: Ctx = Depends(admin_ctx)):
    data = await economics.compute(c.session, c.settings)
    rows = (
        await c.session.execute(
            select(Withdrawal, User.username).join(User, User.id == Withdrawal.user_id).order_by(
                sql_case((Withdrawal.status.in_(("pending", "approved")), 0), else_=1), Withdrawal.created_at.desc()
            ).limit(100)
        )
    ).all()
    adjustments = (
        await c.session.execute(select(Operation).where(Operation.kind.in_(("adjustment", "reversal"))).order_by(Operation.created_at.desc()).limit(100))
    ).scalars()
    star_balance = None
    try:
        balance = await request.app.state.bot.get_my_star_balance()
        star_balance = balance.amount
    except Exception as exc:
        log.info("star balance unavailable: %s", exc)
    return {
        **data,
        "bot_star_balance": star_balance,
        "withdrawals": [{**withdrawals.view(w), "user_id": w.user_id, "username": username} for w, username in rows],
        "adjustments": [{**operation_view(op), "user_id": op.user_id, "admin_id": op.admin_id} for op in adjustments],
    }


class CommentIn(BaseModel):
    comment: str = Field(default="", max_length=500)


@router.post("/withdrawals/{withdrawal_id}/approve")
async def approve_withdrawal(withdrawal_id: int, request: Request, body: CommentIn | None = None, c: Ctx = Depends(admin_ctx)):
    comment = body.comment.strip() if body and body.comment.strip() else None
    try:
        withdrawal = await withdrawals.send_gift(c.session, request.app.state.bot, withdrawal_id, c.user.id, comment)
    except withdrawals.WithdrawalError as exc:
        await c.session.rollback()
        if exc.code == "uncertain":
            await audit.record(c.session, c.user.id, "withdrawal.uncertain", withdrawal_id)
            await c.session.commit()
            raise ApiError(502, "telegram_unavailable", str(exc)) from None
        raise ApiError(409 if exc.code == "conflict" else 404, exc.code, str(exc)) from None
    await audit.record(c.session, c.user.id, "withdrawal.approve", withdrawal.id, stars=withdrawal.stars, user_id=withdrawal.user_id)
    await audit.record(c.session, c.user.id, f"withdrawal.{withdrawal.status}", withdrawal.id, error=withdrawal.error)
    await c.session.commit()
    return withdrawals.view(withdrawal)


@router.post("/withdrawals/{withdrawal_id}/reject")
async def reject_withdrawal(withdrawal_id: int, body: CommentIn, c: Ctx = Depends(admin_ctx)):
    if not body.comment.strip():
        raise ApiError(422, "validation", "Укажите причину")
    try:
        withdrawal = await withdrawals.finish(c.session, withdrawal_id, False, None, body.comment.strip())
    except withdrawals.WithdrawalError as exc:
        await c.session.rollback()
        raise ApiError(409 if exc.code == "conflict" else 404, exc.code, str(exc)) from None
    await audit.record(c.session, c.user.id, "withdrawal.reject", withdrawal.id, comment=body.comment.strip())
    await c.session.commit()
    return withdrawals.view(withdrawal)


@router.post("/withdrawals/{withdrawal_id}/complete")
async def complete_withdrawal(withdrawal_id: int, body: CommentIn, c: Ctx = Depends(admin_ctx)):
    withdrawal = (await c.session.execute(select(Withdrawal).where(Withdrawal.id == withdrawal_id))).scalar_one_or_none()
    if withdrawal is None or withdrawal.status not in ("pending", "approved"):
        raise ApiError(409, "conflict", "Заявка уже обработана")
    comment = body.comment.strip() or None
    withdrawal = await withdrawals.finish(c.session, withdrawal_id, True, None, comment)
    withdrawal.admin_id = c.user.id
    await audit.record(c.session, c.user.id, "withdrawal.manual_complete", withdrawal.id, comment=comment or "")
    await c.session.commit()
    return withdrawals.view(withdrawal)


SETTING_HINTS = {
    "case_prizes": "Сумма приза и её вес. Шанс = вес / сумма всех весов. Пример: 0.1:40,0.5:10.",
    "reward_boost": "Начисляется за каждый период буста, подтверждённый Flyer.",
    "hold_hours_channel": "Сколько часов пользователь должен оставаться подписанным до зачисления награды.",
    "hold_hours_bot": "Обычно 0: Flyer подтверждает запуск бота сразу.",
    "recheck_hours": "Как часто перепроверять задания, ожидающие оплаты Flyer.",
    "waiting_max_hours": "После этого срока неоплаченное задание уходит на ручную проверку.",
    "boost_recurring_enabled": "Включайте, только если Flyer подтверждает посуточную оплату бустов.",
    "referral_threshold": "Сколько подтверждённых кейсов друга дают пригласившему один подарочный кейс.",
    "withdrawals_enabled": "Подарки отправляются со Stars-баланса бота. Следите за балансом в разделе «Выводы».",
    "withdraw_auto": "Подарки уходят без ручного одобрения, если на балансе бота хватает Stars.",
    "withdraw_gift_stars": "Какие номиналы подарков Telegram доступны пользователям.",
    "star_cost_rub": "Расчётная стоимость одной звезды для экономики.",
    "flyer_withdraw_threshold_rub": "Используется для оценки числа выводов из Flyer и комиссий.",
    "maintenance": "Пользователи видят экран технических работ. Администраторы работают как обычно.",
    "support_url": "Ссылка открывается по кнопке «Поддержка» и в ответе на /paysupport.",
}


def settings_items(current) -> list[dict]:
    return [
        {**item, "default": settings_store.BY_KEY[item["key"]].default, "hint": SETTING_HINTS.get(item["key"], "")}
        for item in current.items()
    ]


@router.get("/settings")
async def get_settings(c: Ctx = Depends(admin_ctx)):
    current = await settings_store.load(c.session, fresh=True)
    return {"items": settings_items(current)}


class SettingsIn(BaseModel):
    values: dict[str, str | bool | int | float]


@router.patch("/settings")
async def patch_settings(body: SettingsIn, c: Ctx = Depends(admin_ctx)):
    try:
        changes = await settings_store.update(c.session, body.values, c.user.id)
    except settings_store.SettingErrors as exc:
        await c.session.rollback()
        raise ApiError(422, "validation", "Проверьте значения", {"fields": exc.errors}) from None
    for key, (old, new) in changes.items():
        await audit.record(c.session, c.user.id, "settings.update", key, old=old, new=new)
    await c.session.commit()
    current = await settings_store.load(c.session, fresh=True)
    return {"items": settings_items(current)}


def broadcast_view(b: Broadcast) -> dict:
    return {
        "id": b.id,
        "text": b.text,
        "image_url": f"/api/admin/broadcasts/{b.id}/image" if b.image_path else None,
        "buttons": b.buttons,
        "audience": b.audience or "all",
        "audience_label": analytics.AUDIENCES.get(b.audience or "all", analytics.AUDIENCES["all"]),
        "status": b.status,
        "total": b.total,
        "sent": b.sent,
        "failed": b.failed,
        "created_at": b.created_at,
        "finished_at": b.finished_at,
    }


def _parse_buttons(raw: str) -> list[list[dict]]:
    try:
        data = json.loads(raw or "[]")
    except ValueError:
        raise ApiError(422, "validation", "Некорректные кнопки") from None
    if not isinstance(data, list) or len(data) > 8:
        raise ApiError(422, "validation", "Не более 8 рядов кнопок")
    rows = []
    for row in data:
        if not isinstance(row, list) or not 1 <= len(row) <= 4:
            raise ApiError(422, "validation", "В ряду от 1 до 4 кнопок")
        items = []
        for button in row:
            text = str((button or {}).get("text", "")).strip()
            url = str((button or {}).get("url", "")).strip()
            if not text or len(text) > 64:
                raise ApiError(422, "validation", "Текст кнопки — от 1 до 64 символов")
            if not re.match(r"^(https://|tg://)\S+$", url) or len(url) > 512:
                raise ApiError(422, "validation", f"Некорректная ссылка кнопки «{text}»")
            items.append({"text": text, "url": url})
        rows.append(items)
    return rows


@router.get("/broadcasts")
async def broadcast_list(c: Ctx = Depends(admin_ctx)):
    rows = (await c.session.execute(select(Broadcast).order_by(Broadcast.created_at.desc()).limit(50))).scalars()
    return {"items": [broadcast_view(b) for b in rows]}


@router.post("/broadcasts")
async def broadcast_create(
    text: str = Form(default=""),
    buttons: str = Form(default="[]"),
    audience: str = Form(default="all"),
    image: UploadFile | None = File(default=None),
    c: Ctx = Depends(admin_ctx),
):
    if audience not in analytics.AUDIENCES:
        raise ApiError(422, "validation", "Неизвестная аудитория")
    text = text.strip()
    if len(text) > 4096:
        raise ApiError(422, "validation", "Текст длиннее 4096 символов")
    rows = _parse_buttons(buttons)
    image_path = None
    if image is not None and image.filename:
        suffix = IMAGE_TYPES.get(image.content_type or "")
        if suffix is None:
            raise ApiError(422, "validation", "Поддерживаются JPEG, PNG и WebP")
        content = await image.read(MAX_IMAGE + 1)
        if len(content) > MAX_IMAGE:
            raise ApiError(422, "validation", "Изображение больше 5 МБ")
        directory = Path(get_config().media_dir) / "broadcasts"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{uuid.uuid4().hex}{suffix}"
        path.write_bytes(content)
        image_path = str(path)
    if not text and image_path is None:
        raise ApiError(422, "validation", "Добавьте текст или изображение")
    broadcast = Broadcast(admin_id=c.user.id, text=text, buttons=rows, image_path=image_path, audience=audience)
    c.session.add(broadcast)
    await c.session.flush()
    await audit.record(c.session, c.user.id, "broadcast.create", broadcast.id)
    await c.session.commit()
    await c.session.refresh(broadcast)
    return broadcast_view(broadcast)


async def _broadcast(c: Ctx, broadcast_id: int, lock: bool = False) -> Broadcast:
    stmt = select(Broadcast).where(Broadcast.id == broadcast_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    broadcast = (await c.session.execute(stmt)).scalar_one_or_none()
    if broadcast is None:
        raise ApiError(404, "not_found", "Рассылка не найдена")
    return broadcast


@router.get("/broadcasts/{broadcast_id}/image")
async def broadcast_image(broadcast_id: int, c: Ctx = Depends(admin_ctx)):
    broadcast = await _broadcast(c, broadcast_id)
    if not broadcast.image_path or not Path(broadcast.image_path).exists():
        raise ApiError(404, "not_found", "Изображение не найдено")
    return FileResponse(broadcast.image_path)


@router.post("/broadcasts/{broadcast_id}/preview")
async def broadcast_preview(broadcast_id: int, request: Request, c: Ctx = Depends(admin_ctx)):
    broadcast = await _broadcast(c, broadcast_id)
    try:
        await send_broadcast(request.app.state.bot, c.user.id, broadcast)
    except TelegramForbiddenError:
        raise ApiError(409, "conflict", "Начните диалог с ботом, чтобы получить предпросмотр") from None
    except TelegramBadRequest as exc:
        raise ApiError(422, "validation", f"Telegram отклонил сообщение: {exc.message}") from None
    except TelegramAPIError:
        raise ApiError(502, "telegram_unavailable", "Telegram недоступен, попробуйте позже") from None
    return {"ok": True}


@router.post("/broadcasts/{broadcast_id}/send")
async def broadcast_send(broadcast_id: int, c: Ctx = Depends(admin_ctx)):
    broadcast = await _broadcast(c, broadcast_id, lock=True)
    if broadcast.status != "draft":
        raise ApiError(409, "conflict", "Рассылка уже запущена")
    broadcast.total = (await c.session.execute(select(func.count(User.id)).where(analytics.recipients_condition(broadcast.audience)))).scalar_one()
    broadcast.status = "queued"
    await audit.record(c.session, c.user.id, "broadcast.send", broadcast.id, total=broadcast.total)
    await c.session.commit()
    return broadcast_view(broadcast)


@router.post("/broadcasts/{broadcast_id}/cancel")
async def broadcast_cancel(broadcast_id: int, c: Ctx = Depends(admin_ctx)):
    broadcast = await _broadcast(c, broadcast_id, lock=True)
    if broadcast.status not in ("draft", "queued", "sending"):
        raise ApiError(409, "conflict", "Рассылка уже завершена")
    broadcast.status = "cancelled"
    broadcast.finished_at = utcnow()
    await audit.record(c.session, c.user.id, "broadcast.cancel", broadcast.id)
    await c.session.commit()
    await c.session.refresh(broadcast)
    return broadcast_view(broadcast)


@router.get("/audience")
async def audience_sizes(c: Ctx = Depends(admin_ctx)):
    sizes = {}
    for key in analytics.AUDIENCES:
        sizes[key] = (await c.session.execute(select(func.count(User.id)).where(analytics.recipients_condition(key)))).scalar_one()
    return {"items": [{"key": key, "label": label, "count": sizes[key]} for key, label in analytics.AUDIENCES.items()]}


@router.get("/audit")
async def audit_log(
    cursor: str | None = None,
    action: str = "",
    admin_id: int | None = None,
    q: str = Query("", max_length=100),
    c: Ctx = Depends(admin_ctx),
):
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    if admin_id is not None:
        stmt = stmt.where(AuditLog.admin_id == admin_id)
    if q.strip():
        pattern = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(AuditLog.target).like(pattern), func.lower(cast(AuditLog.details, String)).like(pattern)))
    if cursor:
        try:
            created, row_id = cursor.split("|", 1)
            stmt = stmt.where(tuple_(AuditLog.created_at, AuditLog.id) < tuple_(datetime.fromisoformat(created), int(row_id)))
        except ValueError:
            raise ApiError(422, "validation", "Некорректный курсор") from None
    rows = list((await c.session.execute(stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(51))).scalars())
    next_cursor = None
    if len(rows) > 50:
        rows = rows[:50]
        next_cursor = f"{rows[-1].created_at.isoformat()}|{rows[-1].id}"
    return {
        "items": [
            {"id": r.id, "admin_id": r.admin_id, "action": r.action, "target": r.target, "details": r.details, "created_at": r.created_at}
            for r in rows
        ],
        "next_cursor": next_cursor,
        "actions": [row[0] for row in (await c.session.execute(select(AuditLog.action).distinct().order_by(AuditLog.action))).all()],
        "admins": [row[0] for row in (await c.session.execute(select(AuditLog.admin_id).distinct().order_by(AuditLog.admin_id))).all()],
    }


WITHDRAWAL_TABS = {"pending": ("pending",), "processing": ("approved",), "done": ("completed", "rejected", "failed")}


async def _star_balance(request: Request) -> int | None:
    try:
        return (await request.app.state.bot.get_my_star_balance()).amount
    except Exception as exc:
        log.info("star balance unavailable: %s", exc)
        return None


@router.get("/withdrawals")
async def withdrawal_queue(
    request: Request,
    tab: str = "pending",
    page: int = Query(1, ge=1, le=100000),
    c: Ctx = Depends(admin_ctx),
):
    if tab not in WITHDRAWAL_TABS:
        raise ApiError(422, "validation", "Неизвестная вкладка")
    per_page = 50
    statuses = WITHDRAWAL_TABS[tab]
    base = select(Withdrawal).where(Withdrawal.status.in_(statuses))
    total = (await c.session.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (
        await c.session.execute(
            select(Withdrawal, User.username, User.first_name)
            .join(User, User.id == Withdrawal.user_id)
            .where(Withdrawal.status.in_(statuses))
            .order_by(Withdrawal.created_at.asc() if tab != "done" else Withdrawal.updated_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).all()
    counts = dict((await c.session.execute(select(Withdrawal.status, func.count()).group_by(Withdrawal.status))).all())
    pending_stars = (
        await c.session.execute(select(func.coalesce(func.sum(Withdrawal.stars), 0)).where(Withdrawal.status.in_(("pending", "approved"))))
    ).scalar_one()
    return {
        "items": [
            {**withdrawals.view(w), "user_id": w.user_id, "username": username, "first_name": first_name, "error": w.error}
            for w, username, first_name in rows
        ],
        "total": total,
        "pages": max(1, -(-total // per_page)),
        "counts": {name: sum(counts.get(status, 0) for status in statuses) for name, statuses in WITHDRAWAL_TABS.items()},
        "pending_stars": int(pending_stars),
        "bot_star_balance": await _star_balance(request),
        "auto": c.settings.bool("withdraw_auto"),
    }


@router.get("/stars")
async def stars_overview(request: Request, c: Ctx = Depends(admin_ctx)):
    rows = (await c.session.execute(select(StarTopup).order_by(StarTopup.created_at.desc()).limit(30))).scalars()
    paid_total = (await c.session.execute(select(func.coalesce(func.sum(StarTopup.amount), 0)).where(StarTopup.status == "paid"))).scalar_one()
    gifted = (await c.session.execute(select(func.coalesce(func.sum(Withdrawal.stars), 0)).where(Withdrawal.status == "completed"))).scalar_one()
    pending = (
        await c.session.execute(select(func.coalesce(func.sum(Withdrawal.stars), 0)).where(Withdrawal.status.in_(("pending", "approved"))))
    ).scalar_one()
    return {
        "balance": await _star_balance(request),
        "topped_up": int(paid_total),
        "gifted": int(gifted),
        "pending_withdrawals": int(pending),
        "topups": [topups.view(t) for t in rows],
    }


class TopupIn(BaseModel):
    amount: int = Field(ge=topups.MIN_AMOUNT, le=topups.MAX_AMOUNT)


@router.post("/stars/topup")
async def stars_topup(body: TopupIn, request: Request, c: Ctx = Depends(admin_ctx)):
    try:
        topup, url = await topups.create(c.session, request.app.state.bot, c.user.id, body.amount)
    except topups.TopupError as exc:
        await c.session.rollback()
        raise ApiError(422, "validation", str(exc)) from None
    except TelegramAPIError as exc:
        await c.session.rollback()
        log.warning("create_invoice_link failed: %s", exc)
        raise ApiError(502, "telegram_unavailable", "Telegram не создал счёт. Попробуйте позже.") from None
    await audit.record(c.session, c.user.id, "stars.topup_created", str(topup.id), amount=body.amount)
    await c.session.commit()
    return {"id": str(topup.id), "url": url, "amount": body.amount}


@router.post("/export/{kind}/link")
async def export_link(kind: str, user_id: int | None = None, c: Ctx = Depends(admin_ctx)):
    if kind not in analytics.EXPORT_KINDS:
        raise ApiError(404, "not_found", "Неизвестная выгрузка")
    config = get_config()
    token = analytics.make_export_token(analytics.export_secret(config.bot_token), c.user.id, kind, user_id)
    suffix = f"-{user_id}" if user_id else ""
    return {
        "url": f"{config.app_url.rstrip('/')}/api/admin/export/{kind}.csv?token={token}",
        "file_name": f"zuba-{kind}{suffix}-{utcnow():%Y%m%d-%H%M}.csv",
        "expires_in": analytics.EXPORT_TTL,
    }


@router.get("/export/{kind}.csv")
async def export_csv(kind: str, token: str = Query(..., max_length=300)):
    config = get_config()
    if kind not in analytics.EXPORT_KINDS:
        raise ApiError(404, "not_found", "Неизвестная выгрузка")
    parsed = analytics.read_export_token(analytics.export_secret(config.bot_token), token, kind)
    if parsed is None or not config.is_admin(parsed[0]):
        raise ApiError(403, "forbidden", "Ссылка на выгрузку недействительна или устарела")
    _, user_id = parsed
    name = f"zuba-{kind}-{utcnow():%Y%m%d-%H%M}.csv"
    return StreamingResponse(
        analytics.export_rows(sessionmaker(), kind, user_id),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )
