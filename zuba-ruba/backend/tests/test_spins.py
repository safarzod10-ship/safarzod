import asyncio
from datetime import timedelta

from conftest import auth, register, set_settings
from sqlalchemy import func, select, update
from test_tasks_cases import balances, check

from app.db import sessionmaker
from app.models import Completion, DailySpin, Operation
from app.services.spins import current_day


async def complete_tasks(env, user_id: int, count: int) -> None:
    for _ in range(count):
        signature = env.flyer.add_task(user_id, "start bot", status="complete")
        await env.redis.flushdb()
        await env.client.get("/api/tasks", headers=auth(user_id))
        await check(env.client, user_id, signature)


async def test_spin_requires_five_tasks_today(env, monkeypatch):
    monkeypatch.setattr("app.services.prizes.draw_from", lambda settings, key: 700)
    await register(env.client, 1)
    home = (await env.client.get("/api/home", headers=auth(1))).json()
    assert home["spin"]["available"] is False and home["spin"]["tasks_done"] == 0 and home["spin"]["tasks_required"] == 5
    assert [row["amount"] for row in home["spin"]["prizes"]] == ["0.5", "0.6", "0.7", "0.8", "0.9", "1"]
    await complete_tasks(env, 1, 4)
    response = await env.client.post("/api/spin", headers=auth(1))
    assert response.status_code == 409
    await complete_tasks(env, 1, 1)
    status = (await env.client.get("/api/spin", headers=auth(1))).json()
    assert status["available"] is True and status["tasks_done"] == 5
    spun = (await env.client.post("/api/spin", headers=auth(1))).json()
    assert spun["amount"] == "0.7" and spun["spin"]["spun"] is True and spun["spin"]["available"] is False
    assert (await balances(1))["available"] == 700
    again = await env.client.post("/api/spin", headers=auth(1))
    assert again.status_code == 409
    ops = (await env.client.get("/api/operations", headers=auth(1))).json()["items"]
    assert any(op["title"] == "Ежедневная рулетка" and op["amount"] == "0.7" for op in ops)


async def test_spin_ignores_cancelled_and_yesterday_tasks(env, monkeypatch):
    monkeypatch.setattr("app.services.prizes.draw_from", lambda settings, key: 500)
    await register(env.client, 1)
    await set_settings(daily_spin_tasks=2)
    await complete_tasks(env, 1, 3)
    day = current_day()
    async with sessionmaker()() as session:
        ids = [row[0] for row in (await session.execute(select(Completion.id).order_by(Completion.id))).all()]
        await session.execute(update(Completion).where(Completion.id == ids[0]).values(status="cancelled"))
        await session.execute(update(Completion).where(Completion.id == ids[1]).values(completed_at=day.start - timedelta(minutes=1)))
        await session.commit()
    assert (await env.client.get("/api/spin", headers=auth(1))).json()["tasks_done"] == 1
    assert (await env.client.post("/api/spin", headers=auth(1))).status_code == 409


async def test_concurrent_spins_pay_once(env, monkeypatch):
    monkeypatch.setattr("app.services.prizes.draw_from", lambda settings, key: 1000)
    await register(env.client, 1)
    await set_settings(daily_spin_tasks=1)
    await complete_tasks(env, 1, 1)
    responses = await asyncio.gather(*[env.client.post("/api/spin", headers=auth(1)) for _ in range(6)])
    assert sorted(r.status_code for r in responses).count(200) == 1
    async with sessionmaker()() as session:
        assert (await session.execute(select(func.count(DailySpin.id)))).scalar_one() == 1
        assert (await session.execute(select(func.count(Operation.id)).where(Operation.kind == "daily_spin"))).scalar_one() == 1
    await balances(1)


async def test_spin_can_be_disabled(env):
    await register(env.client, 1)
    await set_settings(daily_spin_enabled=False)
    assert (await env.client.post("/api/spin", headers=auth(1))).status_code == 403
    assert (await env.client.get("/api/spin", headers=auth(1))).json()["enabled"] is False
