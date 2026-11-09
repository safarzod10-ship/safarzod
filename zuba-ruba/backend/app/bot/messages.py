from pathlib import Path

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from app.config import get_config
from app.models import Broadcast, Notification

CAPTION_LIMIT = 1024
WELCOME_VIDEO = Path(__file__).parent / "assets" / "welcome.mp4"
BOT_NAME = "ZUBA RUBA"
SHORT_DESCRIPTION = "Задания за кейсы со звёздами. Открывай кейсы и выводи звёзды подарками Telegram."
DESCRIPTION = (
    "ZUBA RUBA — задания, кейсы и подарки Telegram.\n\n"
    "• Подписывайся на каналы, запускай ботов и поддерживай проекты бустами.\n"
    "• За каждое выполненное задание — кейс со звёздами.\n"
    "• Копи звёзды и выводи их подарками Telegram.\n\n"
    "Нажми «Запустить», чтобы начать."
)
OPEN_BUTTON = "Открыть ZUBA RUBA"

_welcome_file_id: str | None = None


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
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=OPEN_BUTTON, web_app=WebAppInfo(url=webapp_url()))]])


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




def welcome_text(prize_min: str, prize_max: str, withdraw_min: int) -> str:
    return (
        "<b>Добро пожаловать в ZUBA RUBA!</b>\n\n"
        "Здесь звёзды получают за простые задания:\n\n"
        "1. Подпишись на канал, запусти бота или отдай буст.\n"
        f"2. Открой кейс — в нём от {prize_min} до {prize_max} ⭐.\n"
        f"3. Копи звёзды и выводи их подарками Telegram от {withdraw_min} ⭐.\n\n"
        "Приглашай друзей — за их задания ты получаешь подарочные кейсы.\n\n"
        "Нажми «Открыть ZUBA RUBA», чтобы начать."
    )


async def send_welcome(bot: Bot, chat_id: int, text: str) -> None:
    global _welcome_file_id
    markup = open_app_markup()
    if WELCOME_VIDEO.exists():
        try:
            media = _welcome_file_id or FSInputFile(WELCOME_VIDEO, filename="zuba-ruba.mp4")
            message = await bot.send_animation(chat_id, media, caption=text, parse_mode="HTML", reply_markup=markup, width=1280, height=720)
            if message.animation is not None:
                _welcome_file_id = message.animation.file_id
            return
        except TelegramBadRequest:
            _welcome_file_id = None
    await bot.send_message(chat_id, text, parse_mode="HTML", reply_markup=markup)
