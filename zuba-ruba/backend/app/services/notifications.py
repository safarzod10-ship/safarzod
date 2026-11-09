from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification
from app.money import milli_to_display

MSK = ZoneInfo("Europe/Moscow")


def format_dt(value: datetime) -> str:
    return value.astimezone(MSK).strftime("%d.%m.%Y %H:%M МСК")


async def enqueue(
    session: AsyncSession,
    user_id: int,
    kind: str,
    dedup_key: str,
    title: str,
    text: str,
    buttons: list[list[dict]] | None = None,
) -> None:
    stmt = (
        insert(Notification)
        .values(user_id=user_id, kind=kind, dedup_key=dedup_key, title=title, text=text, buttons=buttons or [])
        .on_conflict_do_nothing(index_elements=[Notification.dedup_key])
    )
    await session.execute(stmt)


def _webapp_button(text: str, path: str) -> list[list[dict]]:
    return [[{"text": text, "web_app": path}]]


async def boost_reward(session: AsyncSession, user_id: int, boost_id: int, period: int, amount_milli: int, next_check: datetime | None) -> None:
    lines = [f"Начислено: +{milli_to_display(amount_milli)} ⭐", "", "Буст успешно прошёл проверку."]
    if next_check is not None:
        lines += ["", f"Следующая проверка: {format_dt(next_check)}"]
    await enqueue(session, user_id, "boost_reward", f"boost:{boost_id}:{period}", "Начисление за буст", "\n".join(lines), _webapp_button("История операций", "/history"))


async def reward_confirmed(session: AsyncSession, user_id: int, completion_id: int, amount_milli: int) -> None:
    text = f"Начислено: +{milli_to_display(amount_milli)} ⭐\n\nНаграда доступна на балансе."
    await enqueue(session, user_id, "reward_confirmed", f"confirmed:{completion_id}", "Награда подтверждена", text, _webapp_button("История операций", "/history"))


async def reward_cancelled(session: AsyncSession, user_id: int, completion_id: int, amount_milli: int, task_type: str, reason: str) -> None:
    title = "Подписка не прошла проверку" if task_type == "channel" else "Задание не прошло проверку"
    text = f"Отменено: {milli_to_display(amount_milli)} ⭐\n\nПричина: {escape(reason)}"
    await enqueue(session, user_id, "reward_cancelled", f"cancelled:{completion_id}", title, text, _webapp_button("История операций", "/history"))


async def referral_case(session: AsyncSession, user_id: int, case_id: int, threshold: int) -> None:
    text = f"Твой приглашённый друг выполнил {threshold} подтверждённых задания.\n\nТебе доступен подарочный кейс."
    await enqueue(session, user_id, "referral_case", f"refcase:{case_id}", "Новый кейс", text, _webapp_button("Открыть кейс", "/cases"))


async def under_review(session: AsyncSession, user_id: int, completion_id: int, title: str) -> None:
    text = f"Задание «{escape(title)}» передано на ручную проверку. Награда остаётся в ожидании до решения."
    await enqueue(session, user_id, "review", f"review:{completion_id}", "Задание на проверке", text, _webapp_button("История операций", "/history"))


async def withdrawal_status(session: AsyncSession, user_id: int, withdrawal_id: int, status: str, stars: int, comment: str | None) -> None:
    titles = {
        "pending": ("Заявка на вывод принята", f"Сумма: {stars} ⭐\n\nЗаявка ожидает рассмотрения."),
        "completed": ("Вывод выполнен", f"Отправлено: {stars} ⭐ в виде подарка Telegram."),
        "rejected": ("Заявка на вывод отклонена", f"Сумма {stars} ⭐ возвращена на доступный баланс."),
        "failed": ("Вывод не выполнен", f"Сумма {stars} ⭐ возвращена на доступный баланс."),
    }
    title, text = titles[status]
    if comment:
        text += f"\n\nКомментарий: {escape(comment)}"
    await enqueue(session, user_id, "withdrawal", f"withdrawal:{withdrawal_id}:{status}", title, text, _webapp_button("Открыть вывод", "/withdraw"))
