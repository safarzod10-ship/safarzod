"""ASGI entry point: API + Telegram bot (long polling) in one process. Run with a single worker."""
import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from . import escrow, notify, offers, pro
from .api import admin, router
from .config import settings
from .cryptopay import pay
from .db import Session, init_db

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


async def escrow_jobs() -> None:
    """Payments safety net: invoices paid without a webhook, auto-acceptance, payout retries."""
    tick = 0
    while True:
        await asyncio.sleep(20)
        tick += 1
        for job, every in ((escrow.sync_invoices, 1), (escrow.auto_accept_due, 3), (offers.expire_due, 3), (pro.sync_crypto, 3),
                           (escrow.retry_failed_payouts, 15)):
            if tick % every:
                continue
            try:
                async with Session() as s:
                    await job(s)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - a failing job must not stop the others
                log.error("job %s: %s", job.__name__, e)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    tasks = [asyncio.create_task(escrow_jobs())]
    if settings.bot_token and settings.bot_mode == "polling":
        tasks.append(asyncio.create_task(run_bot()))
    elif not settings.bot_token:
        log.warning("TRUSTY_BOT_TOKEN is empty: Mini App auth and the bot are disabled")
    if pay.enabled:
        try:
            me = await pay.get_me()
            log.info("Crypto Pay app: %s (%s)", me.get("name"), me.get("app_id"))
        except Exception as e:  # noqa: BLE001
            log.error("Crypto Pay token check failed: %s", e)
    else:
        log.warning("TRUSTY_CRYPTOPAY_TOKEN is empty: payments are disabled")
    yield
    for t in tasks:
        t.cancel()
        with suppress(asyncio.CancelledError):
            await t
    await pay.close()
    if notify.bot:
        await notify.bot.session.close()


app = FastAPI(title="Trusty", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)
app.include_router(admin)


def _version() -> str:
    """Short git commit of the deployed code, read straight from .git (no git binary needed)."""
    git = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".git")
    try:
        head = open(os.path.join(git, "HEAD")).read().strip()
        if not head.startswith("ref: "):
            return head[:7]
        ref = head[5:]
        path = os.path.join(git, ref)
        if os.path.exists(path):
            return open(path).read().strip()[:7]
        for line in open(os.path.join(git, "packed-refs")):
            if line.strip().endswith(ref):
                return line[:7]
    except OSError:
        pass
    return "unknown"


VERSION = _version()


@app.get("/api/health")
async def health():
    return {"ok": True, "version": VERSION, "payments": pay.enabled}
