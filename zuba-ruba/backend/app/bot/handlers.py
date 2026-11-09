import logging

from aiogram import F, Router
from aiogram.filters import KICKED, MEMBER, ChatMemberUpdatedFilter, CommandObject, CommandStart
from aiogram.types import ChatMemberUpdated, Message
from sqlalchemy import update

from app.bot.messages import WELCOME, open_app_markup
from app.db import sessionmaker
from app.models import User
from app.services import users as users_service
from app.telegram_auth import TelegramUser

log = logging.getLogger(__name__)
router = Router()


def to_tg_user(user) -> TelegramUser:
    return TelegramUser(
        id=user.id,
        first_name=user.first_name or "",
        last_name=user.last_name,
        username=user.username,
        language_code=user.language_code,
        is_premium=bool(user.is_premium),
        photo_url=None,
        is_bot=user.is_bot,
    )


@router.message(CommandStart(), F.chat.type == "private")
async def start(message: Message, command: CommandObject) -> None:
    if message.from_user is None or message.from_user.is_bot:
        return
    async with sessionmaker()() as session:
        user, created = await users_service.upsert(session, to_tg_user(message.from_user), command.args, from_bot=True)
        await session.commit()
        if user.is_blocked:
            await message.answer("Аккаунт заблокирован. Обратитесь в поддержку.")
            return
    await message.answer(WELCOME, reply_markup=open_app_markup())


@router.message(F.chat.type == "private")
async def fallback(message: Message) -> None:
    await message.answer("Все функции доступны в приложении.", reply_markup=open_app_markup())


@router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=KICKED))
async def blocked(event: ChatMemberUpdated) -> None:
    async with sessionmaker()() as session:
        await session.execute(update(User).where(User.id == event.from_user.id).values(bot_blocked=True))
        await session.commit()


@router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=MEMBER))
async def unblocked(event: ChatMemberUpdated) -> None:
    async with sessionmaker()() as session:
        await session.execute(update(User).where(User.id == event.from_user.id).values(bot_blocked=False))
        await session.commit()
