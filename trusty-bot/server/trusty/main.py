"""ASGI entry point: API + Telegram bot (long polling) in one process. Run with a single worker."""
import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from . import notify
from .api import admin, router
from .config import settings
from .db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("trusty")


async def run_bot() -> None:
    from .bot import build, configure
    bot, dp = build()
    notify.bot = bot
    configured = False
    while True:  # aiogram retries network errors itself; this guards against anything else (e.g. Telegram 5xx on start)
        try:
            if not configured:
                configured = await configure(bot)
            await dp.start_polling(bot, handle_signals=False, allowed_updates=dp.resolve_used_update_types())
            return
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.error("polling stopped: %s; restarting in 15 s", e)
            await asyncio.sleep(15)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    task = None
    if settings.bot_token and settings.bot_mode == "polling":
        task = asyncio.create_task(run_bot())
    elif not settings.bot_token:
        log.warning("TRUSTY_BOT_TOKEN is empty: Mini App auth and the bot are disabled")
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    if notify.bot:
        await notify.bot.session.close()


app = FastAPI(title="Trusty", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)
app.include_router(admin)


@app.get("/api/health")
async def health():
    return {"ok": True}
