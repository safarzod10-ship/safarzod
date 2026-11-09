import uuid
from datetime import timedelta

from aiogram.exceptions import TelegramForbiddenError, TelegramNetworkError
from aiogram.methods import SendMessage
from conftest import ADMIN_ID, TEST_DB, auth, register, set_settings
from sqlalchemy import select, update
from test_tasks_cases import balances, check

from app.db import dispose_engine, init_engine, sessionmaker
from app.models import AuditLog, Broadcast, Notification, User
from app.services import notifications
from app.services.tasks import utcnow
from app.worker import process_broadcasts, process_notifications

ADMIN_GET = ["/api/admin/overview", "/api/admin/users", "/api/admin/users/1", "/api/admin/tasks", "/api/admin/finance", "/api/admin/settings", "/api/admin/broadcasts", "/api/admin/audit"]


async def test_admin_routes_require_admin(env):
    await register(env.client, 1)
    for path in ADMIN_GET:
        response = await env.client.get(path, headers=auth(1))
        assert response.status_code == 403, path
    for path in ["/api/admin/users/1/adjust", "/api/admin/users/1/block", "/api/admin/broadcasts", "/api/admin/withdrawals/1/approve"]:
        assert (await env.client.post(path, headers=auth(1), json={})).status_code == 403, path
    assert (await env.client.patch("/api/admin/settings", headers=auth(1), json={"values": {"maintenance": True}})).status_code == 403
    await register(env.client, ADMIN_ID)
    for path in ADMIN_GET:
        assert (await env.client.get(path, headers=auth(ADMIN_ID))).status_code == 200, path


async def test_admin_settings_and_audit(env):
    await register(env.client, ADMIN_ID)
    response = await env.client.patch("/api/admin/settings", headers=auth(ADMIN_ID), json={"values": {"reward_boost": "-1", "hold_hours_channel": "x"}})
    assert response.status_code == 422 and set(response.json()["error"]["fields"]) == {"reward_boost", "hold_hours_channel"}
    response = await env.client.patch("/api/admin/settings", headers=auth(ADMIN_ID), json={"values": {"reward_boost": "0.5", "boost_recurring_enabled": True}})
    items = {i["key"]: i for i in response.json()["items"]}
    assert items["reward_boost"]["value"] == "0.5" and items["reward_boost"]["default"] == "0.2"
    assert items["boost_recurring_enabled"]["value"] == "true" and items["boost_recurring_enabled"]["hint"]
    config = (await env.client.get("/api/config", headers=auth(ADMIN_ID))).json()
    assert config["boost"]["recurring"] is True
    audit = (await env.client.get("/api/admin/audit", headers=auth(ADMIN_ID))).json()["items"]
    assert {a["target"] for a in audit} == {"reward_boost", "boost_recurring_enabled"}
    assert any(a["details"] == {"old": "0.2", "new": "0.5"} for a in audit)


async def test_adjustment_idempotent_and_audited(env):
    await register(env.client, 1)
    await register(env.client, ADMIN_ID)
    headers = {**auth(ADMIN_ID), "Idempotency-Key": str(uuid.uuid4())}
    first = await env.client.post("/api/admin/users/1/adjust", headers=headers, json={"amount": "1.5", "reason": "компенсация"})
    second = await env.client.post("/api/admin/users/1/adjust", headers=headers, json={"amount": "1.5", "reason": "компенсация"})
    assert first.json()["id"] == second.json()["id"]
    assert (await balances(1))["available"] == 1500
    overdraft = await env.client.post(
        "/api/admin/users/1/adjust", headers={**auth(ADMIN_ID), "Idempotency-Key": str(uuid.uuid4())}, json={"amount": "-5", "reason": "списание"}
    )
    assert overdraft.status_code == 409
    no_key = await env.client.post("/api/admin/users/1/adjust", headers=auth(ADMIN_ID), json={"amount": "1", "reason": "без ключа"})
    assert no_key.status_code == 422
    card = (await env.client.get("/api/admin/users/1", headers=auth(ADMIN_ID))).json()
    assert card["operations"][0]["title"] == "Корректировка баланса"
    async with sessionmaker()() as session:
        actions = [a.action for a in (await session.execute(select(AuditLog))).scalars()]
    assert actions == ["balance.adjust"]


async def test_admin_resolves_disputed_task(env):
    await register(env.client, 1)
    await register(env.client, ADMIN_ID)
    signature = env.flyer.add_task(1, "subscribe channel", status="waiting")
    await env.client.get("/api/tasks", headers=auth(1))
    case_id = (await check(env.client, 1, signature))["case_id"]
    await env.client.post(f"/api/cases/{case_id}/open", headers=auth(1))
    tasks = (await env.client.get("/api/admin/tasks", headers=auth(ADMIN_ID))).json()
    completion_id = tasks["unpaid"][0]["id"]
    assert tasks["by_type"][0]["checks"] == 1
    response = await env.client.post(f"/api/admin/completions/{completion_id}/resolve", headers=auth(ADMIN_ID), json={"action": "confirm", "note": "оплата видна в кабинете"})
    assert response.json()["status"] == "confirmed"
    assert await balances(1) == {"available": 300, "pending": 0, "withdrawing": 0}
    again = await env.client.post(f"/api/admin/completions/{completion_id}/resolve", headers=auth(ADMIN_ID), json={"action": "cancel"})
    assert again.status_code == 409
    finance = (await env.client.get("/api/admin/finance", headers=auth(ADMIN_ID))).json()
    assert finance["income_confirmed"] == "1.00" and finance["reward_expenses"] == "0.45"
    assert finance["bot_star_balance"] == 500
    overview = (await env.client.get("/api/admin/overview", headers=auth(ADMIN_ID))).json()
    assert overview["tasks_paid"] == 1 and overview["users_total"] == 2


async def test_notification_queue_delivery_retry_and_dedup(env):
    await register(env.client, 1)
    await register(env.client, 2)
    async with sessionmaker()() as session:
        await notifications.reward_confirmed(session, 1, 77, 300)
        await notifications.reward_confirmed(session, 1, 77, 300)
        await notifications.reward_confirmed(session, 2, 78, 300)
        await session.commit()
    env.bot.fail_with = TelegramNetworkError(method=SendMessage(chat_id=1, text="x"), message="timeout")
    await process_notifications(env.bot)
    async with sessionmaker()() as session:
        rows = list((await session.execute(select(Notification).order_by(Notification.id))).scalars())
        assert len(rows) == 2 and all(n.status == "queued" and n.attempts == 1 for n in rows)
        await session.execute(update(Notification).values(next_attempt_at=utcnow() - timedelta(seconds=1)))
        await session.commit()
    env.bot.fail_with = None
    await process_notifications(env.bot)
    await process_notifications(env.bot)
    assert [m[0] for m in env.bot.messages] == [1, 2]
    assert "<b>Награда подтверждена</b>" in env.bot.messages[0][1] and "+0,3 ⭐" in env.bot.messages[0][1]
    async with sessionmaker()() as session:
        await notifications.reward_confirmed(session, 2, 79, 300)
        await session.commit()
    env.bot.fail_with = TelegramForbiddenError(method=SendMessage(chat_id=2, text="x"), message="bot was blocked by the user")
    await process_notifications(env.bot)
    async with sessionmaker()() as session:
        last = (await session.execute(select(Notification).order_by(Notification.id.desc()).limit(1))).scalar_one()
        user = (await session.execute(select(User).where(User.id == 2))).scalar_one()
    assert last.status == "failed" and user.bot_blocked is True
    listed = (await env.client.get("/api/notifications", headers=auth(1))).json()["items"]
    assert len(listed) == 1 and listed[0]["read"] is False
    await env.client.post("/api/notifications/read", headers=auth(1))
    assert (await env.client.get("/api/home", headers=auth(1))).json()["unread_notifications"] == 0


async def test_broadcast_preview_confirm_and_stats(env):
    await register(env.client, ADMIN_ID)
    async with sessionmaker()() as session:
        for uid in (1, 2, 3):
            session.add(User(id=uid, first_name=f"U{uid}", ref_code=f"code{uid}", bot_started_at=utcnow()))
        session.add(User(id=4, first_name="NoBot", ref_code="code4"))
        await session.execute(update(User).where(User.id == ADMIN_ID).values(bot_started_at=utcnow()))
        await session.commit()
    bad = await env.client.post("/api/admin/broadcasts", headers=auth(ADMIN_ID), data={"text": "Привет", "buttons": '[[{"text":"Сайт","url":"http://x"}]]'})
    assert bad.status_code == 422
    created = await env.client.post(
        "/api/admin/broadcasts",
        headers=auth(ADMIN_ID),
        data={"text": "<b>Новости</b>", "buttons": '[[{"text":"Канал","url":"https://t.me/zuba"}]]'},
        files={"image": ("pic.png", b"\x89PNG\r\n\x1a\n" + b"0" * 32, "image/png")},
    )
    assert created.status_code == 200, created.text
    broadcast = created.json()
    assert broadcast["status"] == "draft" and broadcast["image_url"]
    image = await env.client.get(broadcast["image_url"], headers=auth(ADMIN_ID))
    assert image.status_code == 200
    assert (await env.client.post(f"/api/admin/broadcasts/{broadcast['id']}/preview", headers=auth(ADMIN_ID))).json() == {"ok": True}
    assert env.bot.messages == [(ADMIN_ID, "<b>Новости</b>")]
    sent = (await env.client.post(f"/api/admin/broadcasts/{broadcast['id']}/send", headers=auth(ADMIN_ID))).json()
    assert sent["status"] == "queued" and sent["total"] == 4
    assert (await env.client.post(f"/api/admin/broadcasts/{broadcast['id']}/send", headers=auth(ADMIN_ID))).status_code == 409
    while await process_broadcasts(env.bot, batch=2):
        pass
    await process_broadcasts(env.bot)
    final = (await env.client.get("/api/admin/broadcasts", headers=auth(ADMIN_ID))).json()["items"][0]
    assert final["status"] == "done" and final["sent"] == 4 and final["failed"] == 0
    assert sorted(m[0] for m in env.bot.messages[1:]) == [1, 2, 3, ADMIN_ID]


async def test_state_survives_restart(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "subscribe channel", status="waiting")
    await env.client.get("/api/tasks", headers=auth(1))
    case_id = (await check(env.client, 1, signature))["case_id"]
    await dispose_engine()
    init_engine(TEST_DB)
    cases = (await env.client.get("/api/cases", headers=auth(1))).json()
    assert [c["id"] for c in cases["ready"]] == [case_id]
    opened = (await env.client.post(f"/api/cases/{case_id}/open", headers=auth(1))).json()
    assert opened["reward_status"] == "pending"
    async with sessionmaker()() as session:
        assert (await session.execute(select(Broadcast))).first() is None


async def test_settings_disable_feature(env):
    await register(env.client, 1)
    env.flyer.add_task(1, "give boost")
    await set_settings(boosts_enabled=False)
    assert (await env.client.get("/api/tasks", headers=auth(1))).json()["items"] == []
    await set_settings(tasks_enabled=False)
    data = (await env.client.get("/api/tasks", headers=auth(1))).json()
    assert data["items"] == [] and data["flyer_error"]


async def test_broadcast_reaches_only_selected_audience(env):
    await register(env.client, ADMIN_ID)
    async with sessionmaker()() as session:
        session.add(User(id=1, first_name="Rich", ref_code="aud1", bot_started_at=utcnow(), balance_available=500))
        session.add(User(id=2, first_name="Empty", ref_code="aud2", bot_started_at=utcnow()))
        await session.commit()
    created = await env.client.post("/api/admin/broadcasts", headers=auth(ADMIN_ID), data={"text": "Для тех, у кого есть звёзды", "audience": "balance"})
    broadcast_id = created.json()["id"]
    sent = (await env.client.post(f"/api/admin/broadcasts/{broadcast_id}/send", headers=auth(ADMIN_ID))).json()
    assert sent["total"] == 1
    while await process_broadcasts(env.bot):
        pass
    await process_broadcasts(env.bot)
    assert [chat for chat, _ in env.bot.messages] == [1]


async def test_welcome_uses_video_and_caches_file_id():
    from types import SimpleNamespace

    from aiogram.types import FSInputFile

    from app.bot import messages

    sent = []

    class Bot:
        async def send_animation(self, chat_id, media, **kwargs):
            sent.append((chat_id, media, kwargs))
            return SimpleNamespace(animation=SimpleNamespace(file_id="cached-id"))

    messages._welcome_file_id = None
    text = messages.welcome_text("0,1", "2", 15)
    await messages.send_welcome(Bot(), 1, text)
    await messages.send_welcome(Bot(), 2, text)
    assert isinstance(sent[0][1], FSInputFile) and sent[1][1] == "cached-id"
    assert "от 0,1 до 2 ⭐" in sent[0][2]["caption"] and sent[0][2]["reply_markup"].inline_keyboard[0][0].text == "Открыть ZUBA RUBA"
    assert len(messages.SHORT_DESCRIPTION) <= 120 and len(messages.DESCRIPTION) <= 512
