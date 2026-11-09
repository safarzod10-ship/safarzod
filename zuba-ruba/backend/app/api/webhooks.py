import hmac
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Config, get_config
from app.db import get_session
from app.services import tasks

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health(request: Request, session: AsyncSession = Depends(get_session)):
    checks = {"database": False, "redis": False}
    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception as exc:
        log.error("health database: %s", exc)
    redis = request.app.state.redis
    if redis is not None:
        try:
            checks["redis"] = bool(await redis.ping())
        except Exception as exc:
            log.error("health redis: %s", exc)
    ok = all(checks.values())
    return JSONResponse(status_code=200 if ok else 503, content={"status": "ok" if ok else "degraded", **checks})


@router.post("/flyer/webhook/{secret}")
async def flyer_webhook(secret: str, request: Request, session: AsyncSession = Depends(get_session), config: Config = Depends(get_config)):
    if not config.flyer_webhook_secret or not hmac.compare_digest(secret, config.flyer_webhook_secret):
        return JSONResponse(status_code=404, content={"status": False})
    try:
        payload = await request.json()
    except ValueError:
        return JSONResponse(status_code=400, content={"status": False})
    event = payload.get("type") if isinstance(payload, dict) else None
    data = payload.get("data") if isinstance(payload, dict) else None
    if event == "new_status" and isinstance(data, dict) and data.get("status") == "abort" and isinstance(data.get("signature"), str):
        await tasks.handle_webhook_abort(session, data["signature"][:512])
        await session.commit()
    elif event not in ("test", "sub_completed", "new_status"):
        log.info("flyer webhook: unknown event %r", event)
    return {"status": True}
