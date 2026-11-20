"""Telegram bot: picture cards with inline buttons, no slash-command menu.

Everything goes through the main card (/start or any message): open the Mini App, find an executor, projects,
my deals, how the escrow works, rules and support. The hidden /admin <code> grants admin rights (max 2 admins).
"""
import hmac
import logging

from aiogram import BaseMiddleware, Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (BufferedInputFile, CallbackQuery, InlineKeyboardButton, InputMediaPhoto,
                           MenuButtonWebApp, Message, TelegramObject, WebAppInfo)
from sqlalchemy import desc, func, or_, select

from . import cards, notify
from .auth import upsert_user
from .config import settings
from .db import Session
from .escrow import STATUS_LABEL, fmt
from .models import Deal, User
from .notify import app_button, keyboard
from .serial import short_date

log = logging.getLogger("trusty.bot")
router = Router()
_file_ids: dict[str, str] = {}  # banner -> Telegram file_id, so each picture is uploaded once


def cb(text: str, data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=data)


BACK = cb("‹ Назад", "m:home")

WELCOME = ("<b>Trusty</b> — гарант сделок с разработчиками.\n\n"
           "Выберите исполнителя по отзывам и реальным сделкам или опубликуйте проект. "
           "Оплата в USDT хранится у гаранта, пока вы не примете работу.")
HOW = ("<b>Как работает гарант</b>\n\n"
       "1. Условия, сумма и срок фиксируются в сделке.\n"
       "2. Заказчик оплачивает счёт в @CryptoBot, деньги хранятся у гаранта.\n"
       "3. Исполнитель сдаёт работу в чате сделки.\n"
       f"4. Заказчик принимает работу, и исполнитель получает оплату. Без ответа работа принимается через {settings.review_days:g} дн.\n\n"
       f"Комиссия гаранта {settings.fee_percent:g}%, её платит заказчик. Если что-то пошло не так, спор решает арбитр.")
HELP = ("<b>Правила</b>\n\n"
        "• Договаривайтесь и платите только через Trusty: сделки мимо гаранта не защищены.\n"
        "• Спор открывается в сделке, арбитр решает по переписке и доказательствам.\n"
        "• За обман и попытку увести сделку: блокировка на 30 дней, при повторе навсегда.\n\n"
        "Вопрос или проблема? Напишите администратору.")


def main_keyboard(**first):
    return keyboard(
        [app_button(first.pop("label", "Открыть Trusty"), **first)],
        [app_button("Найти исполнителя", screen="devs"), app_button("Проекты", screen="projects")],
        [cb("Мои сделки", "m:deals"), cb("Как это работает", "m:how")],
        [cb("Правила и поддержка", "m:help")],
    )


def photo(kind: str, data: bytes | None = None):
    if data is None and kind in _file_ids:
        return _file_ids[kind]
    return BufferedInputFile(data or cards.banner(kind), f"{kind}.jpg")


def remember(kind: str, msg: Message | None) -> None:
    if msg is not None and msg.photo and kind != "deals":
        _file_ids[kind] = msg.photo[-1].file_id


class Activity(BaseMiddleware):
    """Records every interaction as activity ("был в сети") and stops banned users."""

    async def __call__(self, handler, event: TelegramObject, data: dict):
        user = data.get("event_from_user")
        if user is None or user.is_bot:
            return await handler(event, data)
        async with Session() as s:
            u = await upsert_user(s, {"id": user.id, "first_name": user.first_name, "last_name": user.last_name,
                                      "username": user.username})
            banned = u.banned()
            until = None if u.ban_permanent else (short_date(u.ban_until) if u.ban_until else None)
        if banned:
            text = ("Ваш аккаунт в Trusty заблокирован " + (f"до {until}." if until else "навсегда.")
                    + "\nЕсли считаете это ошибкой, напишите администратору.")
            if isinstance(event, Message):
                await event.answer(text)
            elif isinstance(event, CallbackQuery):
                await event.answer(text, show_alert=True)
            return None
        return await handler(event, data)


async def send_home(m: Message, **first) -> None:
    sent = await m.answer_photo(photo("welcome"), caption=WELCOME, reply_markup=main_keyboard(**first))
    remember("welcome", sent)


@router.message(CommandStart())
async def start(m: Message, command: CommandObject):
    async with Session() as s:
        u = await s.get(User, m.from_user.id)
        u.bot_started = True
        await s.commit()
    first = {}
    if command.args and command.args.startswith("dev_") and command.args[4:].isdigit():
        first = {"label": "Открыть профиль исполнителя", "screen": "dev", "id": command.args[4:]}
    await send_home(m, **first)


@router.message(Command("admin"))
async def admin(m: Message, command: CommandObject):
    async with Session() as s:
        u = await s.get(User, m.from_user.id)
        if u.is_admin:
            await m.answer("Вы администратор Trusty.", reply_markup=notify.open_button("Админ-панель", screen="admin"))
            return
        code = (command.args or "").strip()
        if not settings.admin_code or not code or not hmac.compare_digest(code, settings.admin_code):
            await send_home(m)  # do not reveal that the command exists
            return
        count = (await s.execute(select(func.count()).where(User.is_admin.is_(True)))).scalar_one()
        if count >= settings.max_admins:
            await m.answer(f"Мест для администраторов нет: {count} из {settings.max_admins}.")
            return
        u.is_admin = True
        await s.commit()
    log.warning("user %s became admin", m.from_user.id)
    await m.answer(f"Готово, вы администратор ({count + 1} из {settings.max_admins}).",
                   reply_markup=notify.open_button("Админ-панель", screen="admin"))
    try:
        await m.delete()  # remove the message with the code from the chat
    except Exception:  # noqa: BLE001
        pass


@router.message()
async def anything(m: Message):
    await send_home(m)


async def show(cq: CallbackQuery, kind: str, caption: str, markup, data: bytes | None = None) -> None:
    media = InputMediaPhoto(media=photo(kind, data), caption=caption, parse_mode=ParseMode.HTML)
    try:
        msg = await cq.message.edit_media(media, reply_markup=markup)
        remember(kind, msg if isinstance(msg, Message) else None)
    except Exception as e:  # noqa: BLE001 - e.g. the message is too old to edit: send a new card instead
        log.info("edit failed (%s), sending a new card", e)
        sent = await cq.message.answer_photo(photo(kind, data), caption=caption, reply_markup=markup)
        remember(kind, sent)
    await cq.answer()


@router.callback_query(F.data == "m:home")
async def cb_home(cq: CallbackQuery):
    await show(cq, "welcome", WELCOME, main_keyboard())


@router.callback_query(F.data == "m:how")
async def cb_how(cq: CallbackQuery):
    await show(cq, "how", HOW, keyboard([app_button("Открыть Trusty")], [BACK]))


@router.callback_query(F.data == "m:help")
async def cb_help(cq: CallbackQuery):
    async with Session() as s:
        admins = (await s.execute(select(User).where(User.is_admin.is_(True), User.username.is_not(None)))).scalars().all()
    contacts = [InlineKeyboardButton(text=f"Написать @{a.username}", url=f"https://t.me/{a.username}") for a in admins[:2]]
    await show(cq, "help", HELP, keyboard(contacts, [app_button("Пожаловаться на пользователя", screen="profile")], [BACK]))


@router.callback_query(F.data == "m:deals")
async def cb_deals(cq: CallbackQuery):
    uid = cq.from_user.id
    async with Session() as s:
        deals = (await s.execute(select(Deal).where(or_(Deal.client_id == uid, Deal.dev_id == uid))
                                 .order_by(desc(Deal.created_at)).limit(6))).scalars().all()
    if not deals:
        caption = ("<b>Мои сделки</b>\n\nСделок пока нет. Найдите исполнителя или опубликуйте проект, "
                   "а когда договоритесь, сделка появится здесь.")
        markup = keyboard([app_button("Найти исполнителя", screen="devs"), app_button("Проекты", screen="projects")], [BACK])
        await show(cq, "deals", caption, markup, cards.banner("deals"))
        return
    lines = ["<b>Мои сделки</b>\n"]
    rows = []
    for d in deals:
        role = "заказчик" if d.client_id == uid else "исполнитель"
        lines.append(f"<b>#{d.id}</b> {d.title[:40]}\n{fmt(d.amount)} {settings.asset} · {STATUS_LABEL.get(d.status, d.status)} · вы {role}")
        action = "Оплатить" if d.status == "awaiting_payment" and d.client_id == uid else "Открыть"
        rows.append([app_button(f"#{d.id} · {action}", screen="deal", id=d.id)])
    top = deals[0]
    card = cards.deal_card(top.id, top.title, top.amount, top.total, top.status, short_date(top.due_at), settings.asset)
    await show(cq, "deals", "\n\n".join(lines)[:1024], keyboard(*rows, [BACK]), card)


def build() -> tuple[Bot, Dispatcher]:
    bot = Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.message.outer_middleware(Activity())
    dp.callback_query.outer_middleware(Activity())
    dp.include_router(router)
    return bot, dp


async def configure(bot: Bot) -> bool:
    """No slash-command menu (everything is buttons); the menu button opens the Mini App.
    Returns False (and is retried later) if Telegram is unavailable."""
    try:
        await bot.delete_my_commands()
        if settings.public_url:
            await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Открыть", web_app=WebAppInfo(url=settings.public_url + "/")))
        log.info("bot configured")
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("bot configuration skipped: %s", e)
        return False
