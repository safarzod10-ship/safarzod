import logging
import time
from dataclasses import dataclass

from fastapi import Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import settings_store
from app.config import Config, get_config
from app.db import get_session
from app.models import Operation, User
from app.money import milli_to_str
from app.services import users as users_service
from app.settings_store import RuntimeSettings
from app.telegram_auth import InitData, InitDataError, validate

log = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message, **exc.extra}})


class RateLimiter:
    def __init__(self, redis):
        self._redis = redis
        self._local: dict[str, tuple[int, float]] = {}

    async def hit(self, key: str, limit: int, window: int) -> bool:
        bucket = f"rl:{key}:{int(time.time() // window)}"
        if self._redis is not None:
            try:
                pipe = self._redis.pipeline()
                pipe.incr(bucket)
                pipe.expire(bucket, window + 1)
                count, _ = await pipe.execute()
                return int(count) <= limit
            except Exception as exc:
                log.warning("rate limiter redis error: %s", exc)
        now = time.monotonic()
        count, started = self._local.get(bucket, (0, now))
        if len(self._local) > 50000:
            self._local.clear()
        self._local[bucket] = (count + 1, started)
        return count + 1 <= limit


async def rate_limit(request: Request, key: str, limit: int, window: int = 60) -> None:
    limiter: RateLimiter = request.app.state.limiter
    if not await limiter.hit(key, limit, window):
        raise ApiError(429, "rate_limited", "Слишком много запросов. Подождите немного.")


def parse_authorization(authorization: str | None, config: Config) -> InitData:
    if not authorization or not authorization.startswith("tma "):
        raise ApiError(401, "unauthorized", "Откройте приложение через Telegram")
    try:
        return validate(authorization[4:], config.bot_token, config.init_data_ttl_seconds)
    except InitDataError:
        raise ApiError(401, "unauthorized", "Сессия устарела. Перезапустите приложение.") from None


async def init_data(authorization: str | None = Header(default=None), config: Config = Depends(get_config)) -> InitData:
    return parse_authorization(authorization, config)


async def runtime_settings(session: AsyncSession = Depends(get_session)) -> RuntimeSettings:
    return await settings_store.load(session)


@dataclass
class Ctx:
    session: AsyncSession
    user: User
    data: InitData
    settings: RuntimeSettings
    is_admin: bool


async def ctx(
    request: Request,
    data: InitData = Depends(init_data),
    session: AsyncSession = Depends(get_session),
    config: Config = Depends(get_config),
) -> Ctx:
    await rate_limit(request, f"user:{data.user.id}", 240)
    settings = await settings_store.load(session)
    user = (await session.execute(select(User).where(User.id == data.user.id))).scalar_one_or_none()
    if user is None:
        user, _ = await users_service.upsert(session, data.user, data.start_param)
        await session.commit()
    is_admin = config.is_admin(user.id)
    if user.is_blocked and not is_admin:
        raise ApiError(403, "blocked", "Аккаунт заблокирован. Обратитесь в поддержку.")
    if settings.bool("maintenance") and not is_admin:
        raise ApiError(503, "maintenance", "Идут технические работы. Загляните чуть позже.")
    return Ctx(session=session, user=user, data=data, settings=settings, is_admin=is_admin)


async def admin_ctx(c: Ctx = Depends(ctx)) -> Ctx:
    if not c.is_admin:
        raise ApiError(403, "forbidden", "Нет доступа")
    return c


OPERATION_TITLES = {
    "case_reward": "Награда за кейс",
    "daily_spin": "Ежедневная рулетка",
    "boost_reward": "Награда за буст",
    "referral_reward": "Реферальная награда",
    "reversal": "Отмена награды",
    "adjustment": "Корректировка баланса",
    "withdrawal": "Вывод",
}


def operation_view(op: Operation) -> dict:
    title = OPERATION_TITLES[op.kind]
    if op.status == "cancelled" and op.kind in ("case_reward", "boost_reward", "referral_reward"):
        title = "Отмена награды"
    return {
        "id": str(op.id),
        "kind": op.kind,
        "title": title,
        "amount": milli_to_str(abs(op.amount_milli)),
        "direction": "in" if op.amount_milli > 0 else "out",
        "status": op.status,
        "reason": op.reason,
        "created_at": op.created_at,
        "updated_at": op.updated_at,
    }


def balance_view(user: User) -> dict:
    return {
        "total": milli_to_str(user.balance_available + user.balance_pending + user.balance_withdrawing),
        "available": milli_to_str(user.balance_available),
        "pending": milli_to_str(user.balance_pending),
        "withdrawing": milli_to_str(user.balance_withdrawing),
    }


def me_view(user: User, config: Config, is_admin: bool) -> dict:
    return {
        "id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "username": user.username,
        "photo_url": user.photo_url,
        "registered_at": user.registered_at,
        "onboarded": user.onboarded_at is not None,
        "is_admin": is_admin,
        "ref_link": f"https://t.me/{config.bot_username}?start=ref_{user.ref_code}",
    }
