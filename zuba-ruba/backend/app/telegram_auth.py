import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl


class InitDataError(ValueError):
    pass


@dataclass(frozen=True)
class TelegramUser:
    id: int
    first_name: str
    last_name: str | None
    username: str | None
    language_code: str | None
    is_premium: bool
    photo_url: str | None
    is_bot: bool


@dataclass(frozen=True)
class InitData:
    user: TelegramUser
    auth_date: int
    start_param: str | None
    query_id: str | None


def _secret_key(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()


def sign(fields: dict[str, str], bot_token: str) -> str:
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    return hmac.new(_secret_key(bot_token), data_check_string.encode(), hashlib.sha256).hexdigest()


def validate(init_data: str, bot_token: str, max_age_seconds: int, now: float | None = None) -> InitData:
    if not init_data or len(init_data) > 8192:
        raise InitDataError("empty")
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise InitDataError("malformed") from exc
    fields: dict[str, str] = {}
    for key, value in pairs:
        if key in fields:
            raise InitDataError("duplicate field")
        fields[key] = value
    received_hash = fields.pop("hash", None)
    if not received_hash:
        raise InitDataError("hash missing")
    expected = sign(fields, bot_token)
    if not hmac.compare_digest(expected, received_hash):
        raise InitDataError("bad signature")
    try:
        auth_date = int(fields.get("auth_date", "0"))
    except ValueError as exc:
        raise InitDataError("bad auth_date") from exc
    current = now if now is not None else time.time()
    if auth_date <= 0 or current - auth_date > max_age_seconds or auth_date - current > 300:
        raise InitDataError("expired")
    try:
        raw_user = json.loads(fields["user"])
        user = TelegramUser(
            id=int(raw_user["id"]),
            first_name=str(raw_user.get("first_name") or "")[:256],
            last_name=(str(raw_user["last_name"])[:256] if raw_user.get("last_name") else None),
            username=(str(raw_user["username"])[:64] if raw_user.get("username") else None),
            language_code=(str(raw_user["language_code"])[:16] if raw_user.get("language_code") else None),
            is_premium=bool(raw_user.get("is_premium", False)),
            photo_url=(str(raw_user["photo_url"]) if raw_user.get("photo_url") else None),
            is_bot=bool(raw_user.get("is_bot", False)),
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise InitDataError("bad user") from exc
    if user.id <= 0:
        raise InitDataError("bad user id")
    return InitData(user=user, auth_date=auth_date, start_param=fields.get("start_param"), query_id=fields.get("query_id"))
