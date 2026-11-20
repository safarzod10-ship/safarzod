"""Best-effort Telegram notifications. Failures (user blocked the bot, Telegram 5xx) never break an API call."""
import asyncio
import logging
from urllib.parse import urlencode

from aiogram import Bot
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from .config import settings

log = logging.getLogger("trusty.notify")
bot: Bot | None = None
_tasks: set[asyncio.Task] = set()


def app_url(**params) -> str:
    q = urlencode({k: v for k, v in params.items() if v is not None})
    return f"{settings.public_url}/" + (f"?{q}" if q else "")


def open_button(text: str = "Открыть Trusty", **params) -> InlineKeyboardMarkup | None:
    if not settings.public_url:
        return None
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=text, web_app=WebAppInfo(url=app_url(**params)))]])


async def _send(chat_id: int, text: str, markup) -> None:
    if bot is None:
        return
    try:
        await bot.send_message(chat_id, text, reply_markup=markup)
    except Exception as e:  # noqa: BLE001 - delivery is optional
        log.info("notify %s failed: %s", chat_id, e)


def send(chat_id: int, text: str, button: str | None = None, **params) -> None:
    """Schedules a message without waiting for it."""
    markup = open_button(button, **params) if button else None
    t = asyncio.create_task(_send(chat_id, text, markup))
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)
