from pathlib import Path

from aiogram import Bot
from aiogram.types import FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from app.config import get_config
from app.models import Broadcast, Notification

CAPTION_LIMIT = 1024


def webapp_url(path: str = "") -> str:
    base = get_config().app_url.rstrip("/")
    return f"{base}/#{path}" if path else f"{base}/"


def markup(rows: list[list[dict]]) -> InlineKeyboardMarkup | None:
    keyboard = []
    for row in rows or []:
        buttons = []
        for item in row:
            if item.get("web_app") is not None:
                buttons.append(InlineKeyboardButton(text=item["text"], web_app=WebAppInfo(url=webapp_url(item["web_app"]))))
            elif item.get("url"):
                buttons.append(InlineKeyboardButton(text=item["text"], url=item["url"]))
        if buttons:
            keyboard.append(buttons)
    return InlineKeyboardMarkup(inline_keyboard=keyboard) if keyboard else None


def open_app_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Открыть ZUBA RUBA", web_app=WebAppInfo(url=webapp_url()))]])


async def send_notification(bot: Bot, notification: Notification) -> int:
    text = f"<b>{notification.title}</b>\n\n{notification.text}"
    message = await bot.send_message(notification.user_id, text, parse_mode="HTML", reply_markup=markup(notification.buttons), disable_web_page_preview=True)
    return message.message_id


async def send_broadcast(bot: Bot, chat_id: int, broadcast: Broadcast) -> int:
    keyboard = markup(broadcast.buttons)
    if broadcast.image_path and Path(broadcast.image_path).exists():
        if len(broadcast.text) <= CAPTION_LIMIT:
            message = await bot.send_photo(chat_id, FSInputFile(broadcast.image_path), caption=broadcast.text or None, parse_mode="HTML", reply_markup=keyboard)
            return message.message_id
        await bot.send_photo(chat_id, FSInputFile(broadcast.image_path))
    message = await bot.send_message(chat_id, broadcast.text, parse_mode="HTML", reply_markup=keyboard, disable_web_page_preview=True)
    return message.message_id


WELCOME = (
    "<b>Добро пожаловать в ZUBA RUBA!</b>\n\n"
    "Выполняй задания, открывай кейсы и собирай награды.\n\n"
    "Подписывайся на каналы, запускай ботов и следи за своими начислениями.\n\n"
    "Нажми кнопку ниже, чтобы открыть приложение."
)
