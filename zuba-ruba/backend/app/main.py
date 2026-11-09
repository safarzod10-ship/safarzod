import logging
from contextlib import asynccontextmanager

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from app.api import admin, user, webhooks
from app.api.common import ApiError, RateLimiter, api_error_handler
from app.config import get_config
from app.db import dispose_engine, init_engine
from app.flyer import FlyerClient
from app.logging_setup import setup_logging

log = logging.getLogger(__name__)


def create_app(flyer: FlyerClient | None = None, bot: Bot | None = None, redis: Redis | None = None, init_db: bool = True) -> FastAPI:
    config = get_config()
    setup_logging(config.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if init_db:
            init_engine()
        app.state.flyer = flyer or FlyerClient(config.flyer_api_key, config.flyer_base_url)
        app.state.bot = bot or Bot(config.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
        app.state.redis = redis if redis is not None else Redis.from_url(config.redis_url, decode_responses=True)
        app.state.limiter = RateLimiter(app.state.redis)
        yield
        if flyer is None:
            await app.state.flyer.close()
        if bot is None:
            await app.state.bot.session.close()
        if redis is None:
            await app.state.redis.aclose()
        if init_db:
            await dispose_engine()

    app = FastAPI(title="ZUBA RUBA", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.app_url.rstrip("/")],
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )
    app.add_exception_handler(ApiError, api_error_handler)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"error": {"code": "validation", "message": "Проверьте введённые данные"}})

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content={"error": {"code": "internal", "message": "Что-то пошло не так. Попробуйте позже."}})

    app.include_router(webhooks.router)
    app.include_router(user.router)
    app.include_router(admin.router)
    return app
