"""Mini App authentication: every API call carries Telegram initData, signed with the bot token."""
import hashlib
import hmac
import json
import time
from datetime import timedelta
from urllib.parse import parse_qsl

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .models import User, utcnow

MAX_AGE = 24 * 3600


class AuthError(Exception):
    pass


def check_init_data(init_data: str, token: str, max_age: int = MAX_AGE) -> dict:
    """Validates Telegram WebApp initData (HMAC-SHA256 with key HMAC("WebAppData", token)). Returns parsed fields."""
    if not init_data or not token:
        raise AuthError("no init data")
    fields = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=False))
    received = fields.pop("hash", None)
    if not received:
        raise AuthError("no hash")
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise AuthError("bad signature")
    try:
        auth_date = int(fields.get("auth_date", "0"))
    except ValueError as e:
        raise AuthError("bad auth_date") from e
    if max_age and time.time() - auth_date > max_age:
        raise AuthError("init data expired")
    if "user" in fields:
        fields["user"] = json.loads(fields["user"])
    return fields


def sign_init_data(fields: dict, token: str) -> str:
    """Builds a valid initData string (used by tests and local tools)."""
    from urllib.parse import urlencode
    data = {k: (json.dumps(v, separators=(",", ":"), ensure_ascii=False) if isinstance(v, dict) else str(v)) for k, v in fields.items()}
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(data)


async def upsert_user(s: AsyncSession, tg: dict) -> User:
    u = await s.get(User, int(tg["id"]))
    now = utcnow()
    if u is None:
        u = User(id=int(tg["id"]), first_name=tg.get("first_name", "")[:128], last_name=(tg.get("last_name") or None),
                 username=tg.get("username"), created_at=now, last_seen_at=now)
        s.add(u)
    else:
        u.first_name = tg.get("first_name", u.first_name)[:128]
        u.last_name = tg.get("last_name") or None
        u.username = tg.get("username") or u.username
        last = u.last_seen_at if u.last_seen_at.tzinfo else u.last_seen_at.replace(tzinfo=now.tzinfo)
        if now - last > timedelta(seconds=30):
            u.last_seen_at = now
    await s.commit()
    return u


async def current_user(authorization: str = Header(default=""), s: AsyncSession = Depends(get_session)) -> User:
    scheme, _, value = authorization.partition(" ")
    if settings.dev_auth and scheme == "dev" and value.isdigit():
        tg = {"id": int(value), "first_name": f"Dev {value}", "username": f"dev{value}"}
    elif scheme == "tma":
        try:
            tg = check_init_data(value, settings.bot_token).get("user")
        except AuthError as e:
            raise HTTPException(401, f"Telegram auth failed: {e}") from e
        if not tg:
            raise HTTPException(401, "no user in init data")
    else:
        raise HTTPException(401, "Open IT Trusty from Telegram")
    u = await upsert_user(s, tg)
    if u.banned():
        until = None if u.ban_permanent else u.ban_until.isoformat()
        raise HTTPException(403, {"banned": True, "until": until})
    return u


async def admin_user(u: User = Depends(current_user)) -> User:
    if not u.is_admin:
        raise HTTPException(403, "admins only")
    return u
