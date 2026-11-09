import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BOT_TOKEN = "123456:TEST-token"
ADMIN_ID = 1000
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://zr:zr@localhost/zuba_pytest")
TEST_REDIS = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")

os.environ.update(
    {
        "BOT_TOKEN": BOT_TOKEN,
        "ADMIN_IDS": str(ADMIN_ID),
        "DATABASE_URL": TEST_DB,
        "REDIS_URL": TEST_REDIS,
        "FLYER_API_KEY": "FL-test",
        "FLYER_WEBHOOK_SECRET": "hook-secret",
        "DOMAIN": "zuba.example.com",
        "MEDIA_DIR": "/tmp/zuba-test-media",
    }
)

from app import settings_store  # noqa: E402
from app.db import dispose_engine, init_engine, sessionmaker  # noqa: E402
from app.flyer import FlyerClient  # noqa: E402
from app.main import create_app  # noqa: E402
from app.telegram_auth import sign  # noqa: E402

TABLES = [
    "audit_log", "broadcasts", "notifications", "referral_rewards", "boost_periods", "boosts", "withdrawals",
    "operations", "cases", "completions", "task_checks", "flyer_errors", "flyer_tasks", "settings", "users",
]


class FakeFlyer:
    def __init__(self):
        self.tasks: dict[int, list[dict]] = {}
        self.statuses: dict[str, str] = {}
        self.fail = False
        self.calls: list[tuple[str, dict]] = []

    def add_task(self, user_id: int, kind: str = "start bot", status: str = "incomplete", name: str | None = None) -> str:
        signature = f"sig-{uuid.uuid4().hex[:12]}"
        self.tasks.setdefault(user_id, []).append(
            {
                "signature": signature,
                "task": kind,
                "price": 1.0,
                "links": [f"https://t.me/res_{signature[-6:]}"],
                "photo": None,
                "name": name or f"Ресурс {signature[-4:]}",
                "status": "incomplete",
                "resource_id": -100123,
                "is_ios_ban": False,
                "attached_at": None,
            }
        )
        self.statuses[signature] = status
        return signature

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        method = request.url.path.strip("/")
        self.calls.append((method, body))
        if body.get("key") != "FL-test":
            return httpx.Response(200, json={"error": "Invalid key"})
        if self.fail:
            return httpx.Response(502, text="bad gateway")
        if method == "get_tasks":
            return httpx.Response(200, json={"result": self.tasks.get(body["user_id"], [])[: body.get("limit", 5)]})
        if method == "check_task":
            status = self.statuses.get(body["signature"])
            if status is None:
                return httpx.Response(200, json={"result": None, "error": "Task not found"})
            return httpx.Response(200, json={"result": status})
        return httpx.Response(200, json={"error": "Unknown method"})


class FakeBot:
    def __init__(self):
        self.messages: list[tuple[int, str]] = []
        self.gifts_sent: list[tuple[str, int]] = []
        self.fail_with: Exception | None = None
        self.gift_error: Exception | None = None
        self.session = SimpleNamespace(close=self._noop)

    async def _noop(self):
        return None

    async def send_message(self, chat_id, text, **kwargs):
        if self.fail_with is not None:
            raise self.fail_with
        self.messages.append((chat_id, text))
        return SimpleNamespace(message_id=len(self.messages))

    async def send_photo(self, chat_id, photo, caption=None, **kwargs):
        self.messages.append((chat_id, caption or ""))
        return SimpleNamespace(message_id=len(self.messages))

    async def get_available_gifts(self):
        def gift(gid, stars, emoji):
            return SimpleNamespace(id=gid, star_count=stars, remaining_count=None, personal_remaining_count=None, sticker=SimpleNamespace(emoji=emoji))

        return SimpleNamespace(gifts=[gift("15", 15, "🧸"), gift("25", 25, "🌹"), gift("50", 50, "🚀"), gift("100", 100, "💎"), gift("500", 500, "🗿")])

    async def send_gift(self, gift_id, user_id, text=None):
        if self.gift_error is not None:
            raise self.gift_error
        self.gifts_sent.append((gift_id, user_id))
        return True

    async def get_my_star_balance(self):
        return SimpleNamespace(amount=500)


def init_data_for(user_id: int, username: str | None = None, start_param: str | None = None, auth_date: int | None = None, token: str = BOT_TOKEN) -> str:
    fields = {
        "auth_date": str(auth_date or int(time.time())),
        "query_id": "AAH",
        "user": json.dumps({"id": user_id, "first_name": f"User{user_id}", "username": username or f"user{user_id}", "language_code": "ru"}, separators=(",", ":")),
    }
    if start_param:
        fields["start_param"] = start_param
    fields["hash"] = sign(fields, token)
    return urlencode(fields)


def auth(user_id: int, **kwargs) -> dict:
    return {"Authorization": f"tma {init_data_for(user_id, **kwargs)}"}


@pytest.fixture(scope="session", autouse=True)
def database():
    admin_url = TEST_DB.rsplit("/", 1)[0] + "/postgres"
    db_name = TEST_DB.rsplit("/", 1)[1]
    import asyncio

    async def recreate():
        engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
        async with engine.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)'))
            await conn.execute(text(f'CREATE DATABASE "{db_name}"'))
        await engine.dispose()

    asyncio.run(recreate())
    backend = Path(__file__).resolve().parents[1]
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=backend, check=True, env={**os.environ})
    yield


@pytest.fixture
async def redis():
    from redis.asyncio import Redis

    client = Redis.from_url(TEST_REDIS, decode_responses=True)
    await client.flushdb()
    yield client
    await client.aclose()


@pytest.fixture
async def env(redis, monkeypatch):
    monkeypatch.setattr("app.services.prizes.draw", lambda settings: 300)
    init_engine(TEST_DB)
    async with sessionmaker()() as session:
        await session.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
        await session.commit()
    settings_store.invalidate_cache()
    fake_flyer = FakeFlyer()
    flyer = FlyerClient("FL-test", "https://flyer.test", transport=httpx.MockTransport(fake_flyer.handler))
    bot = FakeBot()
    app = create_app(flyer=flyer, bot=bot, redis=redis, init_db=False)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://zuba.example.com") as client:
            yield SimpleNamespace(client=client, flyer=fake_flyer, flyer_client=flyer, bot=bot, app=app, redis=redis)
    await flyer.close()
    await dispose_engine()


async def set_settings(**values) -> None:
    async with sessionmaker()() as session:
        await settings_store.update(session, {k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in values.items()}, ADMIN_ID)
        await session.commit()
    settings_store.invalidate_cache()


async def register(client, user_id: int, **kwargs) -> dict:
    response = await client.post("/api/session", headers=auth(user_id, **kwargs))
    assert response.status_code == 200, response.text
    return response.json()
