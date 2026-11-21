"""Best-effort Telegram notifications. Failures (user blocked the bot, Telegram 5xx) never break an API call."""
import asyncio
import logging
from html import escape
from urllib.parse import urlencode

from aiogram import Bot
from aiogram.types import BufferedInputFile, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from .config import settings

log = logging.getLogger("trusty.notify")
bot: Bot | None = None
_tasks: set[asyncio.Task] = set()

# Bot API button colours: green for "yes", red for "no", blue for "open the app". Everything else stays neutral.
OK, NO, OPEN = "success", "danger", "primary"


def app_url(**params) -> str:
    q = urlencode({k: v for k, v in params.items() if v is not None})
    return f"{settings.public_url}/" + (f"?{q}" if q else "")


def app_button(text: str, style: str | None = None, **params) -> InlineKeyboardButton | None:
    if not settings.public_url:
        return None
    return InlineKeyboardButton(text=text, web_app=WebAppInfo(url=app_url(**params)), style=style)


def cb(text: str, data: str, style: str | None = None) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data, style=style)


def keyboard(*rows) -> InlineKeyboardMarkup | None:
    rows = [[b for b in row if b is not None] for row in rows]
    rows = [r for r in rows if r]
    return InlineKeyboardMarkup(inline_keyboard=rows) if rows else None


def open_button(text: str = "Открыть IT Trusty", style: str | None = OPEN, **params) -> InlineKeyboardMarkup | None:
    return keyboard([app_button(text, style, **params)])


def _spawn(coro) -> None:
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


async def _send(chat_id: int, text: str, markup, photo: bytes | None = None) -> None:
    if bot is None:
        return
    try:
        if photo:
            await bot.send_photo(chat_id, BufferedInputFile(photo, "it-trusty.jpg"), caption=text[:1024], reply_markup=markup)
        else:
            await bot.send_message(chat_id, text, reply_markup=markup)
    except Exception as e:  # noqa: BLE001 - delivery is optional
        log.info("notify %s failed: %s", chat_id, e)


def send(chat_id: int, text: str, button: str | None = None, **params) -> None:
    """Schedules a plain-text message (with an optional Mini App button) without waiting for it."""
    _spawn(_send(chat_id, escape(text), open_button(button, **params) if button else None))


def send_url(chat_id: int, text: str, button: str, url: str | None) -> None:
    markup = keyboard([InlineKeyboardButton(text=button, url=url, style=OK)]) if url else None
    _spawn(_send(chat_id, escape(text), markup))


def send_deal(chat_id: int, deal, text: str, button: str = "Открыть сделку") -> None:
    """A deal event as a picture card with the deal's state and a button into the Mini App."""
    from .cards import deal_card
    try:
        photo = deal_card(deal.id, deal.title, deal.amount, deal.total, deal.status, settings.asset)
    except Exception as e:  # noqa: BLE001 - a card is decoration, the message still goes out
        log.warning("deal card failed: %s", e)
        photo = None
    style = OK if button in ("Оплатить", "Принять работу", "Получить") else OPEN
    _spawn(_send(chat_id, escape(text), open_button(button, style, screen="deal", id=deal.id), photo))


def send_rate(chat_id: int, deal, text: str) -> None:
    """End of a deal: five star buttons right in the bot, a comment can be added in the Mini App."""
    stars = [cb("★" * n, f"r:{deal.id}:{n}", OK if n == 5 else None) for n in (1, 2, 3, 4, 5)]
    markup = keyboard(stars[:3], stars[3:], [app_button("Отзыв с комментарием", screen="deal", id=deal.id)])
    _spawn(_send(chat_id, escape(text), markup))


def offer_markup(offer_id: int, chat_id: int) -> InlineKeyboardMarkup | None:
    return keyboard([cb("Отклонить", f"o:dec:{offer_id}", NO), cb("Принять", f"o:acc:{offer_id}", OK)],
                    [app_button("Своя цена", screen="chat", id=chat_id), app_button("Открыть чат", screen="chat", id=chat_id)])


def send_offer(chat_id: int, offer, sender_name: str, prev_amount: int | None, left: str) -> None:
    """A new offer (or counter-offer) as a card with Accept / Decline right in the bot."""
    from .cards import offer_card
    try:
        photo = offer_card(offer.amount, prev_amount, offer.title, sender_name, offer.days, left, settings.asset)
    except Exception as e:  # noqa: BLE001
        log.warning("offer card failed: %s", e)
        photo = None
    verb = "отвечает своей ценой" if prev_amount else "предлагает"
    text = (f"<b>{escape(sender_name)}</b> {verb}: <b>{offer.amount} {settings.asset}</b> за «{escape(offer.title)}». "
            f"Срок {offer.days} дн.\nПредложение действует ещё {left}.")
    _spawn(_send(chat_id, text, offer_markup(offer.id, offer.chat_id), photo))
