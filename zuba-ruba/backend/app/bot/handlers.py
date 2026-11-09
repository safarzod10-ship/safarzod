import logging

from aiogram import F, Router
from aiogram.filters import KICKED, MEMBER, ChatMemberUpdatedFilter, Command, CommandObject, CommandStart
from aiogram.types import ChatMemberUpdated, Message, PreCheckoutQuery
from sqlalchemy import update

from app import settings_store
from app.bot.messages import WELCOME, open_app_markup
from app.db import sessionmaker
from app.models import User
from app.services import topups
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


@router.message(Command("paysupport"), F.chat.type == "private")
async def paysupport(message: Message) -> None:
    async with sessionmaker()() as session:
        settings = await settings_store.load(session)
    support = settings.raw("support_url")
    text = "Вопросы по оплате и выводу: напишите в поддержку."
    if support:
        text += f"\n\n{support}"
    await message.answer(text, disable_web_page_preview=True)


@router.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery) -> None:
    async with sessionmaker()() as session:
        error = await topups.validate_checkout(session, query.invoice_payload, query.currency, query.total_amount)
    if error:
        await query.answer(ok=False, error_message=error)
    else:
        await query.answer(ok=True)


@router.message(F.successful_payment)
async def successful_payment(message: Message) -> None:
    payment = message.successful_payment
    async with sessionmaker()() as session:
        topup = await topups.mark_paid(
            session, payment.invoice_payload, payment.telegram_payment_charge_id, message.from_user.id, payment.total_amount
        )
        await session.commit()
    if topup is not None:
        await message.answer(f"Баланс бота пополнен на {payment.total_amount} ⭐.")


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
