"""Best-effort Telegram notifications. Failures (user blocked the bot, Telegram 5xx) never break an API call."""
import asyncio
import logging
from urllib.parse import urlencode

from aiogram import Bot
from aiogram.types import BufferedInputFile, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from .config import settings

log = logging.getLogger("trusty.notify")
bot: Bot | None = None
_tasks: set[asyncio.Task] = set()


def app_url(**params) -> str:
    q = urlencode({k: v for k, v in params.items() if v is not None})
    return f"{settings.public_url}/" + (f"?{q}" if q else "")


def app_button(text: str, **params) -> InlineKeyboardButton | None:
    if not settings.public_url:
        return None
    return InlineKeyboardButton(text=text, web_app=WebAppInfo(url=app_url(**params)))


def keyboard(*rows) -> InlineKeyboardMarkup | None:
    rows = [[b for b in row if b is not None] for row in rows]
    rows = [r for r in rows if r]
    return InlineKeyboardMarkup(inline_keyboard=rows) if rows else None


def open_button(text: str = "Открыть Trusty", **params) -> InlineKeyboardMarkup | None:
    return keyboard([app_button(text, **params)])


def _spawn(coro) -> None:
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


async def _send(chat_id: int, text: str, markup, photo: bytes | None = None) -> None:
    if bot is None:
        return
    try:
        if photo:
            await bot.send_photo(chat_id, BufferedInputFile(photo, "trusty.jpg"), caption=text[:1024], reply_markup=markup)
        else:
            await bot.send_message(chat_id, text, reply_markup=markup)
    except Exception as e:  # noqa: BLE001 - delivery is optional
        log.info("notify %s failed: %s", chat_id, e)


def send(chat_id: int, text: str, button: str | None = None, **params) -> None:
    """Schedules a text message (with an optional Mini App button) without waiting for it."""
    _spawn(_send(chat_id, text, open_button(button, **params) if button else None))


def send_url(chat_id: int, text: str, button: str, url: str | None) -> None:
    markup = keyboard([InlineKeyboardButton(text=button, url=url)]) if url else None
    _spawn(_send(chat_id, text, markup))


def send_deal(chat_id: int, deal, text: str, button: str = "Открыть сделку") -> None:
    """A deal event as a picture card with the deal's state and a button into the Mini App."""
    from .cards import deal_card
    from .serial import short_date
    try:
        photo = deal_card(deal.id, deal.title, deal.amount, deal.total, deal.status, short_date(deal.due_at), settings.asset)
    except Exception as e:  # noqa: BLE001 - a card is decoration, the message still goes out
        log.warning("deal card failed: %s", e)
        photo = None
    _spawn(_send(chat_id, text, open_button(button, screen="deal", id=deal.id), photo))
