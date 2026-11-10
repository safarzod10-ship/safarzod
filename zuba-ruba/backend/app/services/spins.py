from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import Completion, DailySpin
from app.money import milli_to_str
from app.services import ledger, prizes
from app.settings_store import RuntimeSettings

MSK = ZoneInfo("Europe/Moscow")
PRIZES_KEY = "daily_spin_prizes"


class SpinError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Day:
    day: date
    start: datetime
    end: datetime


def current_day(now: datetime | None = None) -> Day:
    local = (now or utcnow()).astimezone(MSK)
    start = datetime.combine(local.date(), time.min, tzinfo=MSK)
    return Day(day=local.date(), start=start, end=start + timedelta(days=1))


async def tasks_done(session: AsyncSession, user_id: int, day: Day) -> int:
    return (
        await session.execute(
            select(func.count(Completion.id)).where(
                Completion.user_id == user_id,
                Completion.completed_at >= day.start,
                Completion.completed_at < day.end,
                Completion.status != "cancelled",
            )
        )
    ).scalar_one()


async def status(session: AsyncSession, user_id: int, settings: RuntimeSettings, is_admin: bool = False) -> dict:
    day = current_day()
    required = settings.int("daily_spin_tasks")
    done = await tasks_done(session, user_id, day)
    spin = (await session.execute(select(DailySpin).where(DailySpin.user_id == user_id, DailySpin.day == day.day))).scalar_one_or_none()
    enabled = settings.bool("daily_spin_enabled")
    available = enabled and spin is None and done >= required
    return {
        "enabled": enabled,
        "tasks_done": min(done, required),
        "tasks_required": required,
        "available": available,
        "test_available": is_admin and not available,
        "spun": spin is not None,
        "amount": milli_to_str(spin.amount_milli) if spin else None,
        "next_at": day.end,
        "prizes": prizes.table_view(settings, PRIZES_KEY),
    }


def test_draw(settings: RuntimeSettings) -> int:
    return prizes.draw_from(settings, PRIZES_KEY)


async def spin(session: AsyncSession, user_id: int, settings: RuntimeSettings) -> DailySpin:
    if not settings.bool("daily_spin_enabled"):
        raise SpinError("feature_disabled", "Рулетка сейчас выключена")
    user = await ledger.lock_user(session, user_id)
    day = current_day()
    existing = (await session.execute(select(DailySpin).where(DailySpin.user_id == user.id, DailySpin.day == day.day))).scalar_one_or_none()
    if existing is not None:
        raise SpinError("conflict", "Сегодня ты уже крутил. Следующая попытка — завтра")
    required = settings.int("daily_spin_tasks")
    if await tasks_done(session, user.id, day) < required:
        raise SpinError("conflict", f"Выполни {required} заданий за сегодня, чтобы крутить")
    amount = prizes.draw_from(settings, PRIZES_KEY)
    record = DailySpin(user_id=user.id, day=day.day, amount_milli=amount)
    session.add(record)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise SpinError("conflict", "Сегодня ты уже крутил. Следующая попытка — завтра") from exc
    operation = await ledger.credit(
        session,
        user,
        kind="daily_spin",
        amount_milli=amount,
        pending=False,
        reason=f"Прокрутка за {day.day.strftime('%d.%m.%Y')}",
        key=f"spin:{user.id}:{day.day.isoformat()}",
    )
    record.operation_id = operation.id
    await session.flush()
    return record
