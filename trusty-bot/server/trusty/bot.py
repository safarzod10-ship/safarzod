"""Telegram bot: entry point to the Mini App, admin access, activity tracking."""
import hmac
import logging

from aiogram import BaseMiddleware, Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import BotCommand, MenuButtonWebApp, Message, TelegramObject, WebAppInfo
from sqlalchemy import func, select

from . import notify
from .auth import upsert_user
from .config import settings
from .db import Session
from .models import User
from .serial import short_date

log = logging.getLogger("trusty.bot")
router = Router()

COMMANDS = [
    ("start", "Открыть Trusty"),
    ("developers", "Найти разработчика"),
    ("projects", "Проекты и отклики"),
    ("deals", "Мои сделки"),
    ("profile", "Мой профиль"),
    ("help", "Как работает гарант"),
]

HELP = (
    "<b>Как работает гарант</b>\n\n"
    "1. Вы договариваетесь об условиях: сумма, срок и ТЗ фиксируются в сделке.\n"
    "2. Заказчик вносит USDT, деньги хранятся у гаранта.\n"
    "3. Разработчик сдаёт работу в чате сделки.\n"
    "4. Заказчик принимает работу, и гарант переводит деньги разработчику. "
    "Если заказчик молчит 3 дня, работа принимается автоматически.\n\n"
    "Если что-то пошло не так, откройте спор: арбитр решит по переписке и доказательствам.\n"
    "Оплата в обход гаранта не защищена, а за попытку увести сделку блокируют аккаунт."
)


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
        if banned and isinstance(event, Message):
            await event.answer("Ваш аккаунт в Trusty заблокирован " + (f"до {until}." if until else "навсегда.")
                               + "\nЕсли считаете это ошибкой, напишите администратору.")
            return None
        return await handler(event, data)


@router.message(CommandStart())
async def start(m: Message, command: CommandObject):
    async with Session() as s:
        u = await s.get(User, m.from_user.id)
        u.bot_started = True
        await s.commit()
    params = {}
    if command.args and command.args.startswith("dev_") and command.args[4:].isdigit():
        params = {"screen": "dev", "id": command.args[4:]}
    await m.answer(
        "<b>Trusty</b> — гарант сделок с разработчиками.\n\n"
        "Найдите исполнителя по отзывам и реальным сделкам или опубликуйте проект и выберите из откликов. "
        "Оплата в USDT хранится у гаранта, пока вы не примете работу.",
        reply_markup=notify.open_button("Открыть Trusty", **params))


@router.message(Command("help"))
async def help_(m: Message):
    await m.answer(HELP, reply_markup=notify.open_button("Открыть Trusty"))


SCREENS = {"developers": ("devs", "Найти разработчика"), "projects": ("projects", "Открыть проекты"),
           "deals": ("chats", "Мои сделки"), "profile": ("profile", "Мой профиль")}


@router.message(Command(*SCREENS.keys()))
async def screen(m: Message, command: CommandObject):
    tab, label = SCREENS[command.command]
    await m.answer(label + ":", reply_markup=notify.open_button(label, screen=tab))


@router.message(Command("admin"))
async def admin(m: Message, command: CommandObject):
    async with Session() as s:
        u = await s.get(User, m.from_user.id)
        if u.is_admin:
            await m.answer("Вы администратор Trusty.", reply_markup=notify.open_button("Админ-панель", screen="admin"))
            return
        code = (command.args or "").strip()
        if not settings.admin_code or not code or not hmac.compare_digest(code, settings.admin_code):
            await m.answer("Неизвестная команда.")  # do not reveal that the command exists
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


@router.message(F.text)
async def other(m: Message):
    await m.answer("Всё происходит в приложении Trusty:", reply_markup=notify.open_button("Открыть Trusty"))


def build() -> tuple[Bot, Dispatcher]:
    bot = Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.message.outer_middleware(Activity())
    dp.callback_query.outer_middleware(Activity())
    dp.include_router(router)
    return bot, dp


async def configure(bot: Bot) -> bool:
    """Command menu and the Mini App menu button. Returns False (and is retried later) if Telegram is unavailable."""
    try:
        await bot.set_my_commands([BotCommand(command=c, description=d) for c, d in COMMANDS])
        if settings.public_url:
            await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Открыть", web_app=WebAppInfo(url=settings.public_url + "/")))
        log.info("bot configured")
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("bot configuration skipped: %s", e)
        return False
