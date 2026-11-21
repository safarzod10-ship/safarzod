import asyncio
import logging
import time
from html import escape

import re

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, InlineQueryResultPhoto, InlineQueryResultsButton, WebAppInfo
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import notify
from .config import settings
from .models import DevProfile, User

log = logging.getLogger("trusty.share")


def bot_name() -> str:
    return notify.bot_username or settings.bot_username


def base() -> str:
    return f"https://t.me/{bot_name()}?{'startapp' if notify.main_app else 'start'}=dev_"


def link(uid: int | str) -> str:
    return f"{base()}{uid}"


def card_path(uid: int | str, width: int | None = None) -> str:
    return f"/api/share/dev/{uid}.jpg?v={int(time.time()) // 600}" + (f"&w={width}" if width else "")


def caption(d: dict) -> str:
    stats = f"{d['rating']:.1f} ★ · {d['deals']} сделок · " if d["deals"] else ""
    stack = ", ".join(d["stack"][:4])
    return f"<b>{escape(d['name'])}</b>{' · PRO' if d.get('pro') else ''}\n{escape(d['title'])}\n{stats}{escape(stack)}"


def card_result(d: dict, rid: str | None = None) -> InlineQueryResultPhoto:
    return InlineQueryResultPhoto(
        id=rid or f"dev{d['id']}", photo_url=settings.public_url + card_path(d["id"]),
        thumbnail_url=settings.public_url + card_path(d["id"], 320), photo_width=1200, photo_height=630,
        title=d["name"], description=d["title"], caption=caption(d), parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Открыть профиль", url=link(d["id"]))]]))


async def prepare(user_id: int, d: dict) -> str | None:
    if notify.bot is None or not settings.public_url:
        return None
    result = card_result(d, f"dev{d['id']}-{int(time.time())}")
    try:
        msg = await notify.bot.save_prepared_inline_message(user_id=user_id, result=result, allow_user_chats=True,
                                                            allow_bot_chats=False, allow_group_chats=True, allow_channel_chats=True)
        return msg.id
    except Exception as e:
        log.warning("prepared message failed: %s", e)
        return None


async def watch_bot(bot, every: int = 600) -> None:
    while True:
        await asyncio.sleep(every)
        try:
            me = await bot.get_me()
            if bool(me.has_main_web_app) != notify.main_app:
                log.info("Main Mini App for @%s: %s", me.username, "on" if me.has_main_web_app else "off")
            notify.bot_username, notify.main_app = me.username, bool(me.has_main_web_app)
            notify.inline = bool(me.supports_inline_queries)
        except asyncio.CancelledError:
            raise
        except Exception:
            pass


def _words(p: DevProfile, u: User) -> str:
    return " ".join([u.username or "", u.name, p.title or "", *(p.stack or []), *(p.categories or [])]).lower()


async def search(s: AsyncSession, query: str, me_id: int, limit: int = 20) -> list[dict]:
    from .serial import dev_payloads
    q = query.strip().lstrip("@").lower()
    rows = [(p, u) for p, u in (await s.execute(
        select(DevProfile, User).join(User, User.id == DevProfile.user_id).where(DevProfile.moderation == "published"))).all()
        if not u.banned()]
    by_id = re.fullmatch(r"dev_(\d+)", q)
    if by_id:
        rows = [(p, u) for p, u in rows if u.id == int(by_id.group(1))]
    elif q:
        terms = q.split()
        rows = [(p, u) for p, u in rows if all(t in _words(p, u) for t in terms)]
    devs = await dev_payloads(s, rows)
    exact = {str(u.id) for p, u in rows if q and (u.username or "").lower() == q}
    devs.sort(key=lambda d: (d["id"] not in exact, d["id"] != str(me_id), not d["pro"], -d["rating"], -d["deals"]))
    return devs[:limit]


async def inline_answer(s: AsyncSession, query: str, me_id: int) -> tuple[list[InlineQueryResultPhoto], InlineQueryResultsButton | None]:
    if not settings.public_url:
        return [], None
    devs = await search(s, query, me_id)
    button = InlineQueryResultsButton(text="Никого не нашли · открыть каталог" if query.strip() and not devs else "Каталог исполнителей",
                                      web_app=WebAppInfo(url=settings.public_url + "/?screen=devs"))
    return [card_result(d) for d in devs], button
