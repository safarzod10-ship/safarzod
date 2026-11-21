"""Sharing an executor's profile inside Telegram: a picture card with a t.me link to the bot.
The server's own address never shows: the card goes as a photo, the link is t.me/<bot>?startapp=dev_<id>."""
import asyncio
import logging
import time
from html import escape

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, InlineQueryResultPhoto

from . import notify
from .config import settings

log = logging.getLogger("trusty.share")


def bot_name() -> str:
    return notify.bot_username or settings.bot_username


def base() -> str:
    """t.me link prefix: with a Main Mini App the link opens the profile at once, otherwise the bot's /start shows a button."""
    return f"https://t.me/{bot_name()}?{'startapp' if notify.main_app else 'start'}=dev_"


def link(uid: int | str) -> str:
    return f"{base()}{uid}"


def card_path(uid: int | str) -> str:
    # the version changes every 10 minutes, so Telegram does not keep an old picture with old numbers
    return f"/api/share/dev/{uid}.jpg?v={int(time.time()) // 600}"


def caption(d: dict) -> str:
    stats = f"{d['rating']:.1f} ★ · {d['deals']} сделок · " if d["deals"] else ""
    stack = ", ".join(d["stack"][:4])
    return (f"<b>{escape(d['name'])}</b>{' · PRO' if d.get('pro') else ''}\n{escape(d['title'])}\n{stats}{escape(stack)}\n\n"
            f"Сделка через гаранта IT Trusty: оплата в USDT после приёмки работы.")


async def prepare(user_id: int, d: dict) -> str | None:
    """A message ready to be sent by WebApp.shareMessage: the card, a caption and a button into the profile."""
    if notify.bot is None or not settings.public_url:
        return None
    img = settings.public_url + card_path(d["id"])
    result = InlineQueryResultPhoto(
        id=f"dev{d['id']}-{int(time.time())}", photo_url=img, thumbnail_url=img, photo_width=1200, photo_height=630,
        caption=caption(d), parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Открыть профиль", url=link(d["id"]))]]))
    try:
        msg = await notify.bot.save_prepared_inline_message(user_id=user_id, result=result, allow_user_chats=True,
                                                            allow_bot_chats=False, allow_group_chats=True, allow_channel_chats=True)
        return msg.id
    except Exception as e:  # noqa: BLE001 - the Mini App falls back to a plain t.me link
        log.warning("prepared message failed: %s", e)
        return None


async def watch_bot(bot, every: int = 600) -> None:
    """Notices a Main Mini App turned on in @BotFather later on, without a restart."""
    while True:
        await asyncio.sleep(every)
        try:
            me = await bot.get_me()
            if bool(me.has_main_web_app) != notify.main_app:
                log.info("Main Mini App for @%s: %s", me.username, "on" if me.has_main_web_app else "off")
            notify.bot_username, notify.main_app = me.username, bool(me.has_main_web_app)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - Telegram unavailable: keep what we know
            pass
