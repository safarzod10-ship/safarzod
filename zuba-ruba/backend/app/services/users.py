import re
import secrets

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import User
from app.telegram_auth import TelegramUser

REF_PATTERN = re.compile(r"^ref_([a-z0-9]{6,16})$")


def parse_ref(payload: str | None) -> str | None:
    if not payload:
        return None
    match = REF_PATTERN.match(payload.strip())
    return match.group(1) if match else None


async def _resolve_referrer(session: AsyncSession, code: str | None, user_id: int) -> int | None:
    if code is None:
        return None
    inviter = (await session.execute(select(User).where(User.ref_code == code))).scalar_one_or_none()
    if inviter is None or inviter.id == user_id or inviter.is_blocked:
        return None
    return inviter.id


async def upsert(session: AsyncSession, tg: TelegramUser, start_payload: str | None, from_bot: bool = False) -> tuple[User, bool]:
    referrer_id = None if tg.is_bot else await _resolve_referrer(session, parse_ref(start_payload), tg.id)
    values = {
        "id": tg.id,
        "first_name": tg.first_name,
        "last_name": tg.last_name,
        "username": tg.username,
        "language_code": tg.language_code,
        "is_premium": tg.is_premium,
        "referrer_id": referrer_id,
    }
    if tg.photo_url:
        values["photo_url"] = tg.photo_url
    if from_bot:
        values["bot_started_at"] = func.now()
    for _ in range(5):
        values["ref_code"] = secrets.token_hex(5)
        stmt = insert(User).values(**values).on_conflict_do_nothing(index_elements=[User.id]).returning(User.id)
        try:
            async with session.begin_nested():
                created = (await session.execute(stmt)).scalar_one_or_none()
            break
        except Exception as exc:
            if "ref_code" not in str(exc):
                raise
    else:
        raise RuntimeError("ref code collision")
    user = (await session.execute(select(User).where(User.id == tg.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
    if created is None:
        user.first_name = tg.first_name
        user.last_name = tg.last_name
        user.username = tg.username
        user.language_code = tg.language_code
        user.is_premium = tg.is_premium
        if tg.photo_url:
            user.photo_url = tg.photo_url
        if from_bot:
            user.bot_blocked = False
            if user.bot_started_at is None:
                user.bot_started_at = utcnow()
    user.last_seen_at = utcnow()
    await session.flush()
    await session.refresh(user)
    return user, created is not None
