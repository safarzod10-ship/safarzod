import asyncio
import uuid
from datetime import timedelta

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import SendGift
from conftest import ADMIN_ID, auth, register, set_settings
from sqlalchemy import func, select, update
from test_tasks_cases import balances, check

from app.db import sessionmaker
from app.models import Boost, BoostPeriod, Case, Notification, Operation, ReferralReward
from app.services.tasks import utcnow
from app.worker import process_due_boosts


async def complete_bot_task(env, user_id: int, open_case: bool = True) -> int:
    signature = env.flyer.add_task(user_id, "start bot", status="complete")
    await env.redis.flushdb()
    await env.client.get("/api/tasks", headers=auth(user_id))
    case_id = (await check(env.client, user_id, signature))["case_id"]
    if open_case:
        assert (await env.client.post(f"/api/cases/{case_id}/open", headers=auth(user_id))).status_code == 200
    return case_id


async def test_referral_case_every_three_confirmed(env):
    inviter = await register(env.client, 10)
    code = inviter["ref_link"].split("start=")[1]
    await register(env.client, 11, start_param=code)
    for _ in range(2):
        await complete_bot_task(env, 11)
    summary = (await env.client.get("/api/referrals", headers=auth(10))).json()
    assert summary == {**summary, "invited": 1, "progress": 2, "threshold": 3, "cases_received": 0}
    unopened = await complete_bot_task(env, 11, open_case=False)
    assert (await env.client.get("/api/cases", headers=auth(10))).json()["ready"] == []
    await env.client.post(f"/api/cases/{unopened}/open", headers=auth(11))
    ready = (await env.client.get("/api/cases", headers=auth(10))).json()["ready"]
    assert len(ready) == 1 and ready[0]["source"] == "referral"
    opened = (await env.client.post(f"/api/cases/{ready[0]['id']}/open", headers=auth(10))).json()
    assert opened["amount"] == "0.3" and opened["reward_status"] == "completed"
    assert (await balances(10))["available"] == 300
    ops = (await env.client.get("/api/operations", headers=auth(10))).json()["items"]
    assert ops[0]["title"] == "Реферальная награда"
    async with sessionmaker()() as session:
        note = (await session.execute(select(Notification).where(Notification.user_id == 10))).scalar_one()
    assert note.title == "Новый кейс" and note.buttons[0][0]["text"] == "Открыть кейс"
    for _ in range(3):
        await complete_bot_task(env, 11)
    summary = (await env.client.get("/api/referrals", headers=auth(10))).json()
    assert summary["cases_received"] == 2 and summary["progress"] == 0
    for _ in range(2):
        await complete_bot_task(env, 10)
    async with sessionmaker()() as session:
        assert (await session.execute(select(func.count(ReferralReward.id)))).scalar_one() == 2


async def test_referral_ignores_pending_cancelled_and_suspicious(env):
    inviter = await register(env.client, 10)
    await register(env.client, ADMIN_ID)
    code = inviter["ref_link"].split("start=")[1]
    await register(env.client, 11, start_param=code)
    for _ in range(3):
        signature = env.flyer.add_task(11, "subscribe channel", status="waiting")
        await env.redis.flushdb()
        await env.client.get("/api/tasks", headers=auth(11))
        case_id = (await check(env.client, 11, signature))["case_id"]
        await env.client.post(f"/api/cases/{case_id}/open", headers=auth(11))
    async with sessionmaker()() as session:
        assert (await session.execute(select(func.count(Case.id)).where(Case.source == "referral"))).scalar_one() == 0
    await env.client.post("/api/admin/users/11/block", headers=auth(ADMIN_ID), json={"blocked": False, "suspicious": True})
    for _ in range(3):
        await complete_bot_task(env, 11)
    async with sessionmaker()() as session:
        assert (await session.execute(select(func.count(Case.id)).where(Case.source == "referral"))).scalar_one() == 0


async def test_boost_first_accrual_and_recurring(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "give boost", status="complete", name="Канал")
    await env.client.get("/api/tasks", headers=auth(1))
    result = await check(env.client, 1, signature)
    assert result["result"] == "completed" and result["case_id"] is None
    assert (await balances(1))["available"] == 200
    ops = (await env.client.get("/api/operations", headers=auth(1))).json()["items"]
    assert ops[0]["title"] == "Награда за буст"
    async with sessionmaker()() as session:
        boost = (await session.execute(select(Boost))).scalar_one()
        assert boost.status == "active" and boost.periods_paid == 1
        assert boost.next_check_at - boost.last_check_at == timedelta(hours=48)
        await session.execute(update(Boost).values(next_check_at=utcnow() - timedelta(seconds=1)))
        await session.commit()
    await process_due_boosts(env.flyer_client)
    assert (await balances(1))["available"] == 200
    await set_settings(boost_recurring_enabled=True)
    async with sessionmaker()() as session:
        await session.execute(update(Boost).values(next_check_at=utcnow() - timedelta(seconds=1)))
        await session.commit()
    await process_due_boosts(env.flyer_client)
    await process_due_boosts(env.flyer_client)
    assert (await balances(1))["available"] == 400
    async with sessionmaker()() as session:
        boost = (await session.execute(select(Boost))).scalar_one()
        assert boost.periods_paid == 2 and boost.next_check_at - boost.last_check_at == timedelta(hours=24)
        assert (await session.execute(select(func.count(BoostPeriod.id)))).scalar_one() == 2
        await session.execute(update(Boost).values(next_check_at=utcnow() - timedelta(seconds=1)))
        await session.commit()
    env.flyer.statuses[signature] = "abort"
    await process_due_boosts(env.flyer_client)
    async with sessionmaker()() as session:
        boost = (await session.execute(select(Boost))).scalar_one()
    assert boost.status == "ended" and boost.next_check_at is None
    assert (await balances(1))["available"] == 400


async def fund(env, user_id: int, stars: str) -> None:
    await register(env.client, ADMIN_ID)
    response = await env.client.post(
        f"/api/admin/users/{user_id}/adjust", headers={**auth(ADMIN_ID), "Idempotency-Key": str(uuid.uuid4())}, json={"amount": stars, "reason": "тестовое пополнение"}
    )
    assert response.status_code == 200, response.text


async def test_withdrawal_can_be_disabled(env):
    await register(env.client, 1)
    await set_settings(withdrawals_enabled=False)
    data = (await env.client.get("/api/withdrawals", headers=auth(1))).json()
    assert data["enabled"] is False and data["disabled_reason"] and data["options"] == []
    response = await env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": str(uuid.uuid4())}, json={"gift_id": "15"})
    assert response.status_code == 403


async def test_withdrawal_flow_and_concurrency(env):
    await register(env.client, 1)
    await fund(env, 1, "20")
    await set_settings(withdrawals_per_day=5)
    data = (await env.client.get("/api/withdrawals", headers=auth(1))).json()
    assert data["enabled"] is True
    assert [(o["gift_id"], o["stars"], o["name"]) for o in data["options"]] == [("15", 15, "Мишка"), ("25", 25, "Роза"), ("50", 50, "Ракета"), ("100", 100, "Алмаз")]
    responses = await asyncio.gather(
        *[env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": str(uuid.uuid4())}, json={"gift_id": "15"}) for _ in range(5)]
    )
    codes = sorted(r.status_code for r in responses)
    assert codes.count(200) == 1 and all(c == 409 for c in codes if c != 200)
    assert await balances(1) == {"available": 5000, "pending": 0, "withdrawing": 15000}
    key = str(uuid.uuid4())
    await fund(env, 1, "15")
    await env.redis.flushdb()
    first = await env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": key}, json={"gift_id": "15"})
    second = await env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": key}, json={"gift_id": "15"})
    assert first.json()["id"] == second.json()["id"]
    ids = sorted(w["id"] for w in (await env.client.get("/api/withdrawals", headers=auth(1))).json()["items"])
    approved = await env.client.post(f"/api/admin/withdrawals/{ids[0]}/approve", headers=auth(ADMIN_ID), json={})
    assert approved.json()["status"] == "completed" and env.bot.gifts_sent == [("15", 1)]
    env.bot.gift_error = TelegramBadRequest(method=SendGift(gift_id="15", user_id=1), message="BALANCE_TOO_LOW")
    failed = await env.client.post(f"/api/admin/withdrawals/{ids[1]}/approve", headers=auth(ADMIN_ID), json={})
    assert failed.json()["status"] == "failed"
    assert await balances(1) == {"available": 20000, "pending": 0, "withdrawing": 0}
    again = await env.client.post(f"/api/admin/withdrawals/{ids[0]}/approve", headers=auth(ADMIN_ID), json={})
    assert again.status_code == 409
    statuses = {w["status"] for w in (await env.client.get("/api/withdrawals", headers=auth(1))).json()["items"]}
    assert statuses == {"completed", "failed"}


async def test_withdrawal_reject_returns_funds(env):
    await register(env.client, 1)
    await fund(env, 1, "15")
    created = (await env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": str(uuid.uuid4())}, json={"gift_id": "15"})).json()
    assert (await env.client.post(f"/api/admin/withdrawals/{created['id']}/reject", headers=auth(ADMIN_ID), json={"comment": ""})).status_code == 422
    rejected = await env.client.post(f"/api/admin/withdrawals/{created['id']}/reject", headers=auth(ADMIN_ID), json={"comment": "проверка"})
    assert rejected.json()["status"] == "rejected"
    assert await balances(1) == {"available": 15000, "pending": 0, "withdrawing": 0}
    async with sessionmaker()() as session:
        wd = (await session.execute(select(Operation).where(Operation.kind == "withdrawal"))).scalar_one()
    assert wd.status == "failed"


async def test_withdrawal_rejects_gift_outside_allowed_list(env):
    await register(env.client, 1)
    await fund(env, 1, "600")
    response = await env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": str(uuid.uuid4())}, json={"gift_id": "500"})
    assert response.status_code == 422
    response = await env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": str(uuid.uuid4())}, json={"gift_id": "100"})
    assert response.status_code == 200 and response.json()["gift_name"] == "Алмаз" and response.json()["stars"] == 100


async def test_auto_withdrawals_send_gifts(env):
    from app.worker import process_auto_withdrawals

    await register(env.client, 1)
    await fund(env, 1, "30")
    created = (await env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": str(uuid.uuid4())}, json={"gift_id": "25"})).json()
    assert await process_auto_withdrawals(env.bot) == 0
    await set_settings(withdraw_auto=True)
    assert await process_auto_withdrawals(env.bot) == 1
    assert env.bot.gifts_sent == [("25", 1)]
    items = (await env.client.get("/api/withdrawals", headers=auth(1))).json()["items"]
    assert items[0]["id"] == created["id"] and items[0]["status"] == "completed"
    assert await balances(1) == {"available": 5000, "pending": 0, "withdrawing": 0}
