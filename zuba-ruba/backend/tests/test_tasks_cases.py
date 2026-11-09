import asyncio
from datetime import timedelta

from conftest import auth, register, set_settings
from sqlalchemy import func, select, update

from app.db import sessionmaker
from app.models import Case, Completion, Notification, Operation, TaskCheck, User
from app.services import ledger
from app.services.tasks import utcnow
from app.worker import process_due_completions


async def balances(user_id: int) -> dict:
    async with sessionmaker()() as session:
        user = (await session.execute(select(User).where(User.id == user_id))).scalar_one()
        recomputed = await ledger.recompute(session, user_id)
    cached = {"available": user.balance_available, "pending": user.balance_pending, "withdrawing": user.balance_withdrawing}
    assert cached == recomputed, (cached, recomputed)
    return cached


async def check(client, user_id, signature):
    response = await client.post(f"/api/tasks/{signature}/check", headers=auth(user_id))
    assert response.status_code == 200, response.text
    return response.json()


async def test_task_list_and_filters(env):
    await register(env.client, 1)
    env.flyer.add_task(1, "subscribe channel")
    env.flyer.add_task(1, "start bot")
    env.flyer.add_task(1, "give boost")
    env.flyer.add_task(1, "view posts")
    data = (await env.client.get("/api/tasks", headers=auth(1))).json()
    assert data["flyer_error"] is None
    assert sorted(t["type"] for t in data["items"]) == ["boost", "bot", "channel"]
    channel = next(t for t in data["items"] if t["type"] == "channel")
    assert channel["reward_kind"] == "case" and channel["reward"] == "2" and channel["status"] == "new" and channel["can_check"] is True
    boost = next(t for t in data["items"] if t["type"] == "boost")
    assert boost["reward_kind"] == "stars" and boost["reward"] == "0.2"
    assert "30 ч" in channel["conditions"]
    only_bots = (await env.client.get("/api/tasks?type=bot", headers=auth(1))).json()["items"]
    assert [t["type"] for t in only_bots] == ["bot"]
    get_calls = [c for c in env.flyer.calls if c[0] == "get_tasks"]
    assert get_calls[0][1]["user_id"] == 1 and get_calls[0][1]["language_code"] == "ru"


async def test_flyer_outage_keeps_saved_tasks(env):
    await register(env.client, 1)
    env.flyer.add_task(1, "start bot")
    assert len((await env.client.get("/api/tasks", headers=auth(1))).json()["items"]) == 1
    env.flyer.fail = True
    await env.redis.flushdb()
    data = (await env.client.get("/api/tasks", headers=auth(1))).json()
    assert data["flyer_error"] and len(data["items"]) == 1
    signature = data["items"][0]["signature"]
    result = await check(env.client, 1, signature)
    assert result["result"] == "error"
    async with sessionmaker()() as session:
        errors = (await session.execute(select(func.count(TaskCheck.id)).where(TaskCheck.error.is_not(None)))).scalar_one()
    assert errors == 1


async def test_bot_task_full_flow_and_repeat_check(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "start bot", status="incomplete")
    await env.client.get("/api/tasks", headers=auth(1))
    assert (await check(env.client, 1, signature))["result"] == "incomplete"
    env.flyer.statuses[signature] = "complete"
    result = await check(env.client, 1, signature)
    assert result["result"] == "completed" and result["case_id"]
    repeat = await check(env.client, 1, signature)
    assert repeat["case_id"] == result["case_id"] and repeat["message"] == "Задание уже проверено"
    cases = (await env.client.get("/api/cases", headers=auth(1))).json()
    assert len(cases["ready"]) == 1 and cases["ready"][0]["amount"] is None
    opened = (await env.client.post(f"/api/cases/{result['case_id']}/open", headers=auth(1))).json()
    assert opened["amount"] == "0.3" and opened["reward_status"] == "completed"
    again = (await env.client.post(f"/api/cases/{result['case_id']}/open", headers=auth(1))).json()
    assert again == opened
    assert await balances(1) == {"available": 300, "pending": 0, "withdrawing": 0}
    home = (await env.client.get("/api/home", headers=auth(1))).json()
    assert home["balance"]["available"] == "0.3" and home["cases_opened"] == 1
    assert home["recent_operations"][0]["title"] == "Награда за кейс"
    async with sessionmaker()() as session:
        assert (await session.execute(select(func.count(Completion.id)))).scalar_one() == 1


async def test_channel_hold_then_confirm(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "subscribe channel", status="waiting")
    await env.client.get("/api/tasks", headers=auth(1))
    result = await check(env.client, 1, signature)
    assert result["result"] == "waiting"
    opened = (await env.client.post(f"/api/cases/{result['case_id']}/open", headers=auth(1))).json()
    assert opened["reward_status"] == "pending"
    assert await balances(1) == {"available": 0, "pending": 300, "withdrawing": 0}
    async with sessionmaker()() as session:
        await session.execute(update(Completion).values(next_check_at=utcnow() - timedelta(seconds=1)))
        await session.commit()
    env.flyer.statuses[signature] = "complete"
    await process_due_completions(env.flyer_client)
    async with sessionmaker()() as session:
        completion = (await session.execute(select(Completion))).scalar_one()
    assert completion.status == "holding" and completion.paid_at is not None
    async with sessionmaker()() as session:
        await session.execute(update(Completion).values(hold_until=utcnow() - timedelta(seconds=1), next_check_at=utcnow() - timedelta(seconds=1)))
        await session.commit()
    await process_due_completions(env.flyer_client)
    assert await balances(1) == {"available": 300, "pending": 0, "withdrawing": 0}
    async with sessionmaker()() as session:
        kinds = [n.kind for n in (await session.execute(select(Notification))).scalars()]
    assert kinds == ["reward_confirmed"]
    await process_due_completions(env.flyer_client)
    assert await balances(1) == {"available": 300, "pending": 0, "withdrawing": 0}


async def test_channel_unsubscribe_cancels_without_penalty(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "subscribe channel", status="complete")
    await env.client.get("/api/tasks", headers=auth(1))
    result = await check(env.client, 1, signature)
    assert result["result"] == "waiting"
    await env.client.post(f"/api/cases/{result['case_id']}/open", headers=auth(1))
    env.flyer.statuses[signature] = "abort"
    response = await env.client.post(
        "/flyer/webhook/hook-secret", json={"type": "new_status", "key_number": 1, "data": {"status": "abort", "user_id": 1, "signature": signature, "link": "x"}}
    )
    assert response.json() == {"status": True}
    await process_due_completions(env.flyer_client)
    assert await balances(1) == {"available": 0, "pending": 0, "withdrawing": 0}
    ops = (await env.client.get("/api/operations", headers=auth(1))).json()["items"]
    assert ops[0]["title"] == "Отмена награды" and ops[0]["status"] == "cancelled"
    async with sessionmaker()() as session:
        notification = (await session.execute(select(Notification))).scalar_one()
    assert notification.title == "Подписка не прошла проверку"
    assert "Отменено: 0,3 ⭐" in notification.text
    assert notification.buttons[0][0]["text"] == "История операций"
    assert (await env.client.post("/flyer/webhook/wrong", json={})).status_code == 404


async def test_unopened_case_cancelled_after_abort(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "subscribe channel", status="waiting")
    await env.client.get("/api/tasks", headers=auth(1))
    result = await check(env.client, 1, signature)
    env.flyer.statuses[signature] = "incomplete"
    async with sessionmaker()() as session:
        await session.execute(update(Completion).values(next_check_at=utcnow() - timedelta(seconds=1)))
        await session.commit()
    await process_due_completions(env.flyer_client)
    response = await env.client.post(f"/api/cases/{result['case_id']}/open", headers=auth(1))
    assert response.status_code == 409
    cases = (await env.client.get("/api/cases", headers=auth(1))).json()
    assert cases["ready"] == [] and cases["opened"][0]["state"] == "cancelled"


async def test_waiting_too_long_goes_to_admin_review(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "subscribe channel", status="waiting")
    await env.client.get("/api/tasks", headers=auth(1))
    await check(env.client, 1, signature)
    async with sessionmaker()() as session:
        await session.execute(update(Completion).values(completed_at=utcnow() - timedelta(hours=100), next_check_at=utcnow() - timedelta(seconds=1)))
        await session.commit()
    await process_due_completions(env.flyer_client)
    async with sessionmaker()() as session:
        assert (await session.execute(select(Completion.status))).scalar_one() == "disputed"


async def test_concurrent_case_open_is_idempotent(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "start bot", status="complete")
    await env.client.get("/api/tasks", headers=auth(1))
    case_id = (await check(env.client, 1, signature))["case_id"]
    responses = await asyncio.gather(*[env.client.post(f"/api/cases/{case_id}/open", headers=auth(1)) for _ in range(10)])
    assert all(r.status_code == 200 for r in responses)
    assert await balances(1) == {"available": 300, "pending": 0, "withdrawing": 0}
    async with sessionmaker()() as session:
        assert (await session.execute(select(func.count(Operation.id)))).scalar_one() == 1


async def test_concurrent_checks_create_single_completion(env):
    await register(env.client, 1)
    signature = env.flyer.add_task(1, "start bot", status="complete")
    await env.client.get("/api/tasks", headers=auth(1))
    results = await asyncio.gather(*[env.client.post(f"/api/tasks/{signature}/check", headers=auth(1)) for _ in range(6)])
    assert all(r.status_code == 200 for r in results)
    async with sessionmaker()() as session:
        assert (await session.execute(select(func.count(Completion.id)))).scalar_one() == 1
        assert (await session.execute(select(func.count(Case.id)))).scalar_one() == 1


async def test_check_rate_limit(env):
    await register(env.client, 1)
    await set_settings(checks_per_minute=3)
    signature = env.flyer.add_task(1, "start bot")
    await env.client.get("/api/tasks", headers=auth(1))
    codes = [(await env.client.post(f"/api/tasks/{signature}/check", headers=auth(1))).status_code for _ in range(5)]
    assert codes.count(429) >= 1


async def test_foreign_task_is_not_checkable(env):
    await register(env.client, 1)
    await register(env.client, 2)
    signature = env.flyer.add_task(1, "start bot", status="complete")
    await env.client.get("/api/tasks", headers=auth(1))
    response = await env.client.post(f"/api/tasks/{signature}/check", headers=auth(2))
    assert response.status_code == 404
