import logging
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.flyer import FlyerClient, FlyerError, FlyerTaskData
from app.models import Boost, BoostPeriod, Case, Completion, FlyerTask, TaskCheck, User
from app.models import FlyerError as FlyerErrorRow
from app.money import milli_to_str
from app.services import ledger, notifications, referrals
from app.settings_store import RuntimeSettings

log = logging.getLogger(__name__)

TYPE_LABELS = {"channel": "Подписка на канал", "bot": "Запуск бота", "boost": "Буст канала", "other": "Действие"}
STATUS_LABELS = {
    "new": "Новое",
    "incomplete": "Не выполнено",
    "waiting": "Ожидает подтверждения",
    "completed": "Выполнено",
    "cancelled": "Отменено",
    "unavailable": "Недоступно",
}
COMPLETION_LABELS = {
    "waiting_payment": "Ожидает оплаты Flyer",
    "holding": "Период удержания",
    "confirmed": "Подтверждено",
    "cancelled": "Отменено",
    "disputed": "На ручной проверке",
}
ACTIVE_COMPLETION = ("waiting_payment", "holding", "disputed")
CANCEL_REASON = {
    "channel": "подписка не подтверждена в обязательный период.",
    "bot": "запуск бота не подтверждён.",
    "boost": "буст не подтверждён.",
    "other": "выполнение не подтверждено.",
}



def reward_for(settings: RuntimeSettings, task_type: str) -> int:
    return settings.milli({"channel": "reward_channel", "bot": "reward_bot", "boost": "reward_boost"}.get(task_type, "reward_other"))


def income_for(settings: RuntimeSettings, task_type: str) -> int:
    key = {"channel": "income_channel_rub", "bot": "income_bot_rub", "boost": "income_boost_day_rub"}.get(task_type, "income_other_rub")
    return settings.kopecks(key)


def hold_hours(settings: RuntimeSettings, task_type: str) -> int:
    return settings.int("hold_hours_channel") if task_type == "channel" else settings.int("hold_hours_bot") if task_type == "bot" else 0


def is_type_enabled(settings: RuntimeSettings, task_type: str) -> bool:
    if task_type == "boost" and not settings.bool("boosts_enabled"):
        return False
    return reward_for(settings, task_type) > 0


def conditions(settings: RuntimeSettings, task_type: str) -> str:
    if task_type == "channel":
        hours = hold_hours(settings, "channel")
        return f"Подпишись и не отписывайся {hours} ч" if hours else "Подпишись на канал"
    if task_type == "bot":
        return "Запусти бота и отправь /start"
    if task_type == "boost":
        return "Отдай буст каналу и не отзывай его"
    return "Выполни действие по ссылке"


async def log_flyer_error(session: AsyncSession, method: str, user_id: int | None, error: str) -> None:
    session.add(FlyerErrorRow(method=method, user_id=user_id, error=error[:1000]))
    await session.flush()


async def _upsert_tasks(session: AsyncSession, user: User, items: list[FlyerTaskData]) -> None:
    signatures = [item.signature for item in items]
    existing = {
        task.signature: task
        for task in (await session.execute(select(FlyerTask).where(FlyerTask.signature.in_(signatures)))).scalars()
    } if signatures else {}
    now = utcnow()
    for item in items:
        task = existing.get(item.signature)
        if task is None:
            session.add(
                FlyerTask(
                    user_id=user.id,
                    signature=item.signature,
                    flyer_type=item.flyer_type,
                    task_type=item.task_type,
                    title=item.title,
                    links=item.links,
                    photo=item.photo,
                    resource_id=item.resource_id,
                    flyer_price_kopecks=item.price_kopecks,
                    is_offered=True,
                )
            )
        elif task.user_id == user.id:
            task.title = item.title or task.title
            task.links = item.links
            task.photo = item.photo
            task.flyer_price_kopecks = item.price_kopecks or task.flyer_price_kopecks
            task.is_offered = task.status in ("new", "incomplete")
            task.last_seen_at = now
    stale = update(FlyerTask).where(FlyerTask.user_id == user.id, FlyerTask.status.in_(("new", "incomplete")), FlyerTask.is_offered.is_(True))
    if signatures:
        stale = stale.where(FlyerTask.signature.notin_(signatures))
    await session.execute(stale.values(is_offered=False))
    await session.flush()


async def list_tasks(session: AsyncSession, flyer: FlyerClient, user: User, settings: RuntimeSettings, refresh: bool = True) -> tuple[list[FlyerTask], str | None]:
    error_text = None
    if not settings.bool("tasks_enabled"):
        return [], "Раздел заданий временно отключён."
    if refresh:
        try:
            items = await flyer.get_tasks(user.id, user.language_code, settings.int("tasks_limit"))
            await _upsert_tasks(session, user, items)
        except FlyerError as exc:
            log.warning("flyer get_tasks failed: %s", exc)
            await log_flyer_error(session, "get_tasks", user.id, str(exc))
            error_text = "Не удалось обновить задания. Попробуйте позже."
    recent = utcnow() - timedelta(hours=48)
    rows = (
        await session.execute(
            select(FlyerTask)
            .where(
                FlyerTask.user_id == user.id,
                (FlyerTask.is_offered.is_(True)) | ((FlyerTask.status.in_(("waiting", "completed", "cancelled"))) & (FlyerTask.last_check_at >= recent)),
            )
            .order_by(FlyerTask.is_offered.desc(), FlyerTask.first_seen_at.desc())
        )
    ).scalars().all()
    tasks = [task for task in rows if is_type_enabled(settings, task.task_type) or task.status in ("waiting", "completed")]
    return tasks, error_text


def task_view(task: FlyerTask, settings: RuntimeSettings, reward_milli: int | None = None) -> dict:
    return {
        "signature": task.signature,
        "type": task.task_type,
        "type_label": TYPE_LABELS[task.task_type],
        "title": task.title or TYPE_LABELS[task.task_type],
        "conditions": conditions(settings, task.task_type),
        "link": task.links[0] if task.links else None,
        "photo": task.photo,
        "reward": milli_to_str(reward_milli if reward_milli is not None else reward_for(settings, task.task_type)),
        "status": task.status,
        "status_label": STATUS_LABELS[task.status],
        "can_check": task.status in ("new", "incomplete") and task.is_offered,
    }


async def _record_check(session: AsyncSession, task: FlyerTask, source: str, status: str | None, error: str | None) -> None:
    session.add(TaskCheck(task_id=task.id, user_id=task.user_id, source=source, flyer_status=status, error=error))
    task.last_check_at = utcnow()
    task.checks_count += 1
    if status:
        task.flyer_status = status


def _label(task: FlyerTask | Completion) -> str:
    title = task.title or ""
    base = TYPE_LABELS.get(task.task_type, "Задание")
    return f"{base} «{title}»" if title else base


async def check_task(session: AsyncSession, flyer: FlyerClient, user: User, signature: str, settings: RuntimeSettings) -> dict:
    task = (
        await session.execute(select(FlyerTask).where(FlyerTask.signature == signature, FlyerTask.user_id == user.id).with_for_update().execution_options(populate_existing=True))
    ).scalar_one_or_none()
    if task is None:
        return {"task": None, "result": "not_found", "message": "Задание не найдено", "case_id": None}
    completion = (await session.execute(select(Completion).where(Completion.task_id == task.id))).scalar_one_or_none()
    if completion is not None:
        case_id = (await session.execute(select(Case.id).where(Case.completion_id == completion.id))).scalar_one_or_none()
        result = "cancelled" if completion.status == "cancelled" else "completed" if completion.status == "confirmed" else "waiting"
        return {"task": task, "result": result, "message": "Задание уже проверено", "case_id": case_id, "reward_milli": completion.reward_milli}
    if not is_type_enabled(settings, task.task_type):
        return {"task": task, "result": "unavailable", "message": "Этот тип заданий сейчас недоступен", "case_id": None}
    try:
        status = await flyer.check_task(signature)
    except FlyerError as exc:
        await _record_check(session, task, "user", None, str(exc))
        await log_flyer_error(session, "check_task", user.id, str(exc))
        return {"task": task, "result": "error", "message": "Сервис проверки недоступен. Попробуйте через минуту.", "case_id": None}
    await _record_check(session, task, "user", status, None)
    if status in ("incomplete", "abort"):
        task.status = "incomplete"
        await session.flush()
        return {"task": task, "result": "incomplete", "message": "Задание ещё не выполнено", "case_id": None}
    if status == "unavailable":
        task.status = "unavailable"
        task.is_offered = False
        await session.flush()
        return {"task": task, "result": "unavailable", "message": "Задание больше недоступно", "case_id": None}
    completion = await _create_completion(session, task, status, settings)
    case_id = None
    if task.task_type == "boost":
        await _create_boost(session, task, completion)
    else:
        case = Case(user_id=user.id, source="task", label=_label(task), completion_id=completion.id, amount_milli=completion.reward_milli)
        session.add(case)
        await session.flush()
        case_id = case.id
    if completion.status != "confirmed" and status == "complete" and completion.hold_until <= utcnow():
        await confirm_completion(session, completion, settings)
    task.status = "completed" if completion.status == "confirmed" else "waiting"
    task.is_offered = False
    await session.flush()
    if task.task_type == "boost":
        message = "Буст подтверждён, награда начислена" if completion.status == "confirmed" else "Буст засчитан и ожидает подтверждения Flyer"
    elif completion.status == "confirmed":
        message = "Задание подтверждено. Открой кейс"
    else:
        message = "Задание засчитано. Кейс доступен, награда в ожидании"
    return {"task": task, "result": "completed" if completion.status == "confirmed" else "waiting", "message": message, "case_id": case_id, "reward_milli": completion.reward_milli}


async def _create_completion(session: AsyncSession, task: FlyerTask, flyer_status: str, settings: RuntimeSettings) -> Completion:
    now = utcnow()
    hold_until = now + timedelta(hours=hold_hours(settings, task.task_type))
    paid = flyer_status == "complete"
    if paid:
        next_check = hold_until if hold_until > now else None
        status = "holding"
    else:
        next_check = now + timedelta(hours=settings.int("recheck_hours"))
        status = "waiting_payment"
    completion = Completion(
        task_id=task.id,
        user_id=task.user_id,
        signature=task.signature,
        task_type=task.task_type,
        title=task.title,
        reward_milli=reward_for(settings, task.task_type),
        income_kopecks=income_for(settings, task.task_type),
        flyer_price_kopecks=task.flyer_price_kopecks,
        status=status,
        flyer_status=flyer_status,
        hold_until=hold_until,
        paid_at=now if paid else None,
        next_check_at=next_check,
    )
    session.add(completion)
    await session.flush()
    return completion


async def _create_boost(session: AsyncSession, task: FlyerTask, completion: Completion) -> Boost:
    boost = Boost(
        user_id=task.user_id,
        task_id=task.id,
        signature=task.signature,
        channel=task.title,
        link=task.links[0] if task.links else None,
        status="pending",
    )
    session.add(boost)
    await session.flush()
    return boost


async def _case_for(session: AsyncSession, completion_id: int) -> Case | None:
    return (await session.execute(select(Case).where(Case.completion_id == completion_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()


async def confirm_completion(session: AsyncSession, completion: Completion, settings: RuntimeSettings, resolved_by: int | None = None) -> None:
    if completion.status in ("confirmed", "cancelled"):
        return
    user = await ledger.lock_user(session, completion.user_id)
    now = utcnow()
    completion.status = "confirmed"
    completion.confirmed_at = now
    completion.next_check_at = None
    if completion.paid_at is None:
        completion.paid_at = now
    if resolved_by is not None:
        completion.resolved_by = resolved_by
    await session.execute(update(FlyerTask).where(FlyerTask.id == completion.task_id).values(status="completed"))
    if completion.task_type == "boost":
        boost = (await session.execute(select(Boost).where(Boost.task_id == completion.task_id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        await accrue_boost_period(session, user, boost, settings, "complete", first=True)
        return
    case = await _case_for(session, completion.id)
    if case is not None and case.state == "opened" and case.operation_id is not None:
        operation = await ledger.lock_operation(session, case.operation_id)
        if await ledger.release(session, user, operation):
            await notifications.reward_confirmed(session, user.id, completion.id, operation.amount_milli)
            await referrals.evaluate(session, user.id, settings)
    await session.flush()


async def cancel_completion(session: AsyncSession, completion: Completion, reason: str, flyer_status: str | None = None, resolved_by: int | None = None) -> None:
    if completion.status in ("confirmed", "cancelled"):
        return
    user = await ledger.lock_user(session, completion.user_id)
    completion.status = "cancelled"
    completion.cancelled_at = utcnow()
    completion.next_check_at = None
    completion.note = reason
    if flyer_status:
        completion.flyer_status = flyer_status
    if resolved_by is not None:
        completion.resolved_by = resolved_by
    await session.execute(update(FlyerTask).where(FlyerTask.id == completion.task_id).values(status="cancelled"))
    if completion.task_type == "boost":
        await session.execute(
            update(Boost).where(Boost.task_id == completion.task_id).values(status="ended", ended_at=func.now(), end_reason=reason, next_check_at=None)
        )
    else:
        case = await _case_for(session, completion.id)
        if case is not None:
            if case.state == "ready":
                case.state = "cancelled"
            elif case.operation_id is not None:
                operation = await ledger.lock_operation(session, case.operation_id)
                await ledger.cancel_pending(session, user, operation, f"{case.label}: {reason}")
    await notifications.reward_cancelled(session, user.id, completion.id, completion.reward_milli, completion.task_type, reason)
    await session.flush()


async def accrue_boost_period(session: AsyncSession, user: User, boost: Boost, settings: RuntimeSettings, flyer_status: str, first: bool = False) -> bool:
    period = boost.periods_paid
    exists = (await session.execute(select(BoostPeriod.id).where(BoostPeriod.boost_id == boost.id, BoostPeriod.period_index == period))).scalar_one_or_none()
    if exists is not None:
        return False
    reward = settings.milli("reward_boost")
    income = settings.kopecks("income_boost_day_rub")
    now = utcnow()
    hours = settings.int("boost_first_check_hours") if first else settings.int("boost_interval_hours")
    boost.status = "active"
    boost.last_check_at = now
    boost.next_check_at = now + timedelta(hours=hours)
    boost.check_failures = 0
    operation = None
    if reward > 0:
        operation = await ledger.credit(
            session,
            user,
            kind="boost_reward",
            amount_milli=reward,
            pending=False,
            reason=f"Буст канала «{boost.channel}»" if boost.channel else "Буст канала",
            key=f"boost:{boost.id}:{period}",
            boost_id=boost.id,
        )
    session.add(BoostPeriod(boost_id=boost.id, period_index=period, flyer_status=flyer_status, reward_milli=reward, income_kopecks=income, operation_id=operation.id if operation else None))
    boost.periods_paid = period + 1
    boost.rewarded_milli += reward
    boost.income_kopecks += income
    await session.flush()
    if reward > 0:
        await notifications.boost_reward(session, user.id, boost.id, period, reward, boost.next_check_at if settings.bool("boost_recurring_enabled") else None)
    return True


async def recheck_completion(session: AsyncSession, flyer: FlyerClient, completion: Completion, settings: RuntimeSettings, source: str = "job") -> str | None:
    task = (await session.execute(select(FlyerTask).where(FlyerTask.id == completion.task_id).with_for_update().execution_options(populate_existing=True))).scalar_one()
    now = utcnow()
    completion.check_attempts += 1
    try:
        status = await flyer.check_task(completion.signature)
    except FlyerError as exc:
        await _record_check(session, task, source, None, str(exc))
        await log_flyer_error(session, "check_task", completion.user_id, str(exc))
        delay = min(timedelta(minutes=5 * 2 ** min(completion.check_attempts, 6)), timedelta(hours=settings.int("recheck_hours")))
        completion.next_check_at = now + delay
        await session.flush()
        return None
    await _record_check(session, task, source, status, None)
    completion.flyer_status = status
    if status == "complete":
        if completion.paid_at is None:
            completion.paid_at = now
        if now >= completion.hold_until:
            await confirm_completion(session, completion, settings)
        else:
            completion.status = "holding"
            completion.next_check_at = completion.hold_until
    elif status == "waiting":
        if now - completion.completed_at > timedelta(hours=settings.int("waiting_max_hours")):
            await _to_dispute(session, completion, "Flyer не подтвердил оплату в установленный срок")
        else:
            completion.status = "waiting_payment"
            completion.next_check_at = max(now + timedelta(hours=settings.int("recheck_hours")), completion.hold_until if completion.hold_until > now else now)
    elif status in ("abort", "incomplete"):
        await cancel_completion(session, completion, CANCEL_REASON.get(completion.task_type, CANCEL_REASON["other"]), status)
    elif status == "unavailable":
        await _to_dispute(session, completion, "Ресурс снят с размещения до завершения проверки")
    await session.flush()
    return status


async def _to_dispute(session: AsyncSession, completion: Completion, note: str) -> None:
    completion.status = "disputed"
    completion.next_check_at = None
    completion.note = note
    await notifications.under_review(session, completion.user_id, completion.id, completion.title or TYPE_LABELS.get(completion.task_type, "Задание"))


async def recheck_boost(session: AsyncSession, flyer: FlyerClient, boost: Boost, settings: RuntimeSettings) -> str | None:
    task = (await session.execute(select(FlyerTask).where(FlyerTask.id == boost.task_id))).scalar_one()
    now = utcnow()
    try:
        status = await flyer.check_task(boost.signature)
    except FlyerError as exc:
        await _record_check(session, task, "job", None, str(exc))
        await log_flyer_error(session, "check_task", boost.user_id, str(exc))
        boost.check_failures += 1
        boost.next_check_at = now + timedelta(minutes=30 * min(boost.check_failures, 12))
        await session.flush()
        return None
    await _record_check(session, task, "job", status, None)
    if status == "complete":
        if settings.bool("boost_recurring_enabled"):
            user = await ledger.lock_user(session, boost.user_id)
            await accrue_boost_period(session, user, boost, settings, status)
        else:
            boost.last_check_at = now
            boost.next_check_at = now + timedelta(hours=settings.int("boost_interval_hours"))
            boost.check_failures = 0
    else:
        boost.status = "ended"
        boost.ended_at = now
        boost.last_check_at = now
        boost.next_check_at = None
        boost.end_reason = "Буст не найден при проверке" if status in ("abort", "incomplete") else "Ресурс снят с размещения"
    await session.flush()
    return status


async def handle_webhook_abort(session: AsyncSession, signature: str) -> bool:
    completion = (await session.execute(select(Completion).where(Completion.signature == signature).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if completion is None:
        return False
    task = (await session.execute(select(FlyerTask).where(FlyerTask.id == completion.task_id))).scalar_one()
    await _record_check(session, task, "webhook", "abort", None)
    if completion.status in ("waiting_payment", "holding"):
        completion.next_check_at = utcnow()
    await session.flush()
    return True


async def resolve(session: AsyncSession, completion_id: int, action: str, note: str, admin_id: int, settings: RuntimeSettings) -> Completion | None:
    completion = (await session.execute(select(Completion).where(Completion.id == completion_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if completion is None:
        return None
    if completion.status not in ACTIVE_COMPLETION:
        raise ValueError("Задание уже обработано")
    if action == "confirm":
        await confirm_completion(session, completion, settings, resolved_by=admin_id)
        completion.note = note or completion.note
    else:
        await cancel_completion(session, completion, note or CANCEL_REASON.get(completion.task_type, CANCEL_REASON["other"]), resolved_by=admin_id)
    await session.flush()
    return completion


async def due_completion_ids(session: AsyncSession, limit: int = 50) -> list[int]:
    rows = await session.execute(
        select(Completion.id)
        .where(Completion.status.in_(("waiting_payment", "holding")), Completion.next_check_at <= func.now())
        .order_by(Completion.next_check_at)
        .limit(limit)
    )
    return [row[0] for row in rows]


async def due_boost_ids(session: AsyncSession, limit: int = 50) -> list[int]:
    rows = await session.execute(
        select(Boost.id).where(Boost.status == "active", Boost.next_check_at <= func.now()).order_by(Boost.next_check_at).limit(limit)
    )
    return [row[0] for row in rows]

