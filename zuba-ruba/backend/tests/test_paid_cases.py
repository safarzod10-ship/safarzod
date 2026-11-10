import asyncio
import uuid

from conftest import ADMIN_ID, auth, register, set_settings
from sqlalchemy import func, select
from test_rewards import fund
from test_tasks_cases import balances

from app.db import sessionmaker
from app.models import Deposit, Operation, PaidCaseOpen, PrizeFund
from app.services import deposits
from app.settings_store import SettingError, normalize


def key() -> dict:
    return {"Idempotency-Key": str(uuid.uuid4())}


async def test_paid_cases_disabled_by_default(env):
    await register(env.client, 1)
    catalog = (await env.client.get("/api/paid-cases", headers=auth(1))).json()
    assert catalog["enabled"] is False and [t["price"] for t in catalog["tiers"]] == [1, 5, 25, 100]
    assert (await env.client.post("/api/paid-cases/1/open", headers={**auth(1), **key()})).status_code == 403
    assert (await env.client.post("/api/deposits", headers=auth(1), json={"stars": 10})).status_code == 403


async def test_house_always_keeps_twenty_percent(env):
    await register(env.client, 1)
    await set_settings(paid_cases_enabled=True)
    await fund(env, 1, "2000")
    for price in [1] * 60 + [5] * 40 + [25] * 20 + [100] * 6:
        await env.redis.flushdb()
        response = await env.client.post(f"/api/paid-cases/{price}/open", headers={**auth(1), **key()})
        assert response.status_code == 200, response.text
        async with sessionmaker()() as session:
            pool = (await session.execute(select(PrizeFund))).scalar_one()
        assert pool.paid_out_milli <= pool.paid_in_milli * 0.8 + 1
        assert pool.fund_milli >= 0
    async with sessionmaker()() as session:
        opens = (await session.execute(select(func.count(PaidCaseOpen.id)))).scalar_one()
    assert opens == 126
    await balances(1)
    finance = (await env.client.get("/api/admin/finance", headers=auth(ADMIN_ID))).json()
    assert float(finance["paid_cases_margin_percent"]) >= 20


async def test_first_open_cannot_pay_more_than_fund(env, monkeypatch):
    await register(env.client, 1)
    await set_settings(paid_cases_enabled=True)
    await fund(env, 1, "100")
    monkeypatch.setattr("app.services.paid_cases._random.choices", lambda amounts, weights, k: [max(amounts)])
    result = (await env.client.post("/api/paid-cases/100/open", headers={**auth(1), **key()})).json()
    assert result["prize"] == "50"
    assert (await balances(1))["available"] == 50000


async def test_insufficient_balance_idempotency_and_concurrency(env):
    await register(env.client, 1)
    await set_settings(paid_cases_enabled=True)
    assert (await env.client.post("/api/paid-cases/5/open", headers={**auth(1), **key()})).status_code == 409
    await fund(env, 1, "3")
    headers = {**auth(1), **key()}
    first = (await env.client.post("/api/paid-cases/1/open", headers=headers)).json()
    second = (await env.client.post("/api/paid-cases/1/open", headers=headers)).json()
    assert first["id"] == second["id"]
    async with sessionmaker()() as session:
        purchases = (await session.execute(select(func.count(Operation.id)).where(Operation.kind == "case_purchase"))).scalar_one()
    assert purchases == 1
    await env.redis.flushdb()
    available = (await balances(1))["available"]
    responses = await asyncio.gather(*[env.client.post("/api/paid-cases/1/open", headers={**auth(1), **key()}) for _ in range(8)])
    ok = [r for r in responses if r.status_code == 200]
    assert len(ok) <= available // 1000 + 4
    assert all(r.status_code in (200, 409) for r in responses)
    assert (await balances(1))["available"] >= 0


async def test_deposit_invoice_and_payment(env):
    await register(env.client, 1)
    await register(env.client, 2)
    await set_settings(paid_cases_enabled=True)
    invoices = []

    async def create_invoice_link(**kwargs):
        invoices.append(kwargs)
        return "https://t.me/$invoice"

    env.bot.create_invoice_link = create_invoice_link
    created = (await env.client.post("/api/deposits", headers=auth(1), json={"stars": 50})).json()
    assert created["url"] == "https://t.me/$invoice" and invoices[0]["currency"] == "XTR" and invoices[0]["prices"][0].amount == 50
    payload = invoices[0]["payload"]
    async with sessionmaker()() as session:
        assert await deposits.validate_checkout(session, payload, "XTR", 50, 1) is None
        assert await deposits.validate_checkout(session, payload, "XTR", 49, 1) == "Сумма счёта не совпадает"
        assert await deposits.validate_checkout(session, payload, "XTR", 50, 2) == "Счёт выставлен другому пользователю"
        await deposits.mark_paid(session, payload, "charge-1", 1, 50)
        await deposits.mark_paid(session, payload, "charge-1", 1, 50)
        await session.commit()
    assert (await balances(1))["available"] == 50000
    async with sessionmaker()() as session:
        deposit = (await session.execute(select(Deposit))).scalar_one()
        assert deposit.status == "paid"
        assert await deposits.validate_checkout(session, payload, "XTR", 50, 1) == "Счёт уже оплачен"
    ops = (await env.client.get("/api/operations", headers=auth(1))).json()["items"]
    assert ops[0]["title"] == "Пополнение" and ops[0]["amount"] == "50"


def test_paid_tables_cannot_exceed_eighty_percent():
    assert normalize("paid_case_5_prizes", "1:50,4:50") == "1:50,4:50"
    for value in ["1:10,10:10", "5:1,6:1"]:
        try:
            normalize("paid_case_5_prizes", value)
        except SettingError:
            continue
        raise AssertionError(value)
