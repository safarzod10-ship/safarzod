import time
import uuid
from types import SimpleNamespace

from conftest import ADMIN_ID, BOT_TOKEN, auth, register, set_settings
from sqlalchemy import select, update
from test_tasks_cases import check

from app.bot import handlers
from app.clock import utcnow
from app.db import sessionmaker
from app.models import AuditLog, StarTopup, User
from app.services import analytics, topups

ADMIN_ROUTES = [
    ("GET", "/api/admin/analytics?days=7"),
    ("GET", "/api/admin/users?sort=earned&page=1"),
    ("GET", "/api/admin/withdrawals?tab=pending"),
    ("GET", "/api/admin/stars"),
    ("GET", "/api/admin/audience"),
    ("POST", "/api/admin/stars/topup"),
    ("POST", "/api/admin/export/users/link"),
]


async def test_new_admin_routes_require_admin(env):
    await register(env.client, 1)
    for method, path in ADMIN_ROUTES:
        response = await env.client.request(method, path, headers=auth(1), json={"amount": 10} if method == "POST" else None)
        assert response.status_code == 403, path


async def fund(env, user_id: int, stars: str) -> None:
    response = await env.client.post(
        f"/api/admin/users/{user_id}/adjust", headers={**auth(ADMIN_ID), "Idempotency-Key": str(uuid.uuid4())}, json={"amount": stars, "reason": "тест"}
    )
    assert response.status_code == 200, response.text


async def test_analytics_series_funnel_and_tops(env):
    await register(env.client, ADMIN_ID)
    inviter = await register(env.client, 10)
    await register(env.client, 11, start_param=inviter["ref_link"].split("start=")[1])
    await env.client.post("/api/me/onboarding", headers=auth(11))
    signature = env.flyer.add_task(11, "start bot", status="complete")
    await env.client.get("/api/tasks", headers=auth(11))
    case_id = (await check(env.client, 11, signature))["case_id"]
    await env.client.post(f"/api/cases/{case_id}/open", headers=auth(11))
    assert (await env.client.get("/api/admin/analytics?days=5", headers=auth(ADMIN_ID))).status_code == 422
    data = (await env.client.get("/api/admin/analytics?days=7", headers=auth(ADMIN_ID))).json()
    assert len(data["dates"]) == 7 and data["dates"][-1] == utcnow().date().isoformat()
    series = data["series"]
    assert series["new_users"]["total"] == 3 and series["new_users"]["points"][-1] == 3
    assert series["task_checks"]["total"] == 1 and series["completions"]["total"] == 1 and series["cases_opened"]["total"] == 1
    assert series["active_users"]["points"][-1] == 1
    assert float(series["rewards"]["total"]) > 0
    funnel = {step["key"]: step["count"] for step in data["funnel"]}
    assert funnel == {"registered": 3, "onboarded": 1, "checked": 1, "completed": 1, "opened": 1, "withdrew": 0}
    assert data["top_referrers"][0]["id"] == 10 and data["top_referrers"][0]["invited"] == 1
    assert data["top_earners"][0]["id"] == 11


async def test_users_pagination_sort_filters(env):
    await register(env.client, ADMIN_ID)
    for uid in range(1, 6):
        await register(env.client, uid)
    await fund(env, 3, "2")
    await fund(env, 4, "1")
    await env.client.post("/api/admin/users/5/block", headers=auth(ADMIN_ID), json={"blocked": True, "reason": "спам"})
    page = (await env.client.get("/api/admin/users?sort=available&order=desc&per_page=2", headers=auth(ADMIN_ID))).json()
    assert [u["id"] for u in page["items"]] == [3, 4] and page["total"] == 6 and page["pages"] == 3
    second = (await env.client.get("/api/admin/users?sort=available&order=desc&per_page=2&page=2", headers=auth(ADMIN_ID))).json()
    assert len(second["items"]) == 2 and {u["id"] for u in second["items"]}.isdisjoint({3, 4})
    blocked = (await env.client.get("/api/admin/users?status=blocked", headers=auth(ADMIN_ID))).json()
    assert [u["id"] for u in blocked["items"]] == [5]
    found = (await env.client.get("/api/admin/users?q=user2", headers=auth(ADMIN_ID))).json()
    assert [u["id"] for u in found["items"]] == [2]
    assert (await env.client.get("/api/admin/users?sort=hacker", headers=auth(ADMIN_ID))).status_code == 422
    card = (await env.client.get("/api/admin/users/3", headers=auth(ADMIN_ID))).json()
    assert card["user"]["earned"] == "0" and card["cases"] == [] and card["referrer"] is None


async def test_csv_export_signed_link(env):
    await register(env.client, ADMIN_ID)
    await register(env.client, 7, username="csv_user")
    await fund(env, 7, "1.5")
    link = (await env.client.post("/api/admin/export/users/link", headers=auth(ADMIN_ID))).json()
    assert link["url"].startswith("https://zuba.example.com/api/admin/export/users.csv?token=")
    path = link["url"].split("zuba.example.com", 1)[1]
    response = await env.client.get(path)
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    text = response.content.decode("utf-8")
    assert text.startswith("﻿id;username") and "7;csv_user" in text and ";1.5;" in text
    ops = (await env.client.post("/api/admin/export/operations/link?user_id=7", headers=auth(ADMIN_ID))).json()
    body = (await env.client.get(ops["url"].split("zuba.example.com", 1)[1])).content.decode("utf-8")
    assert body.count("\n") == 2 and "adjustment" in body
    token = path.split("token=")[1]
    assert (await env.client.get(f"/api/admin/export/operations.csv?token={token}")).status_code == 403
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    assert (await env.client.get(f"/api/admin/export/users.csv?token={tampered}")).status_code == 403
    secret = analytics.export_secret(BOT_TOKEN)
    expired = analytics.make_export_token(secret, ADMIN_ID, "users", None, now=time.time() - 600)
    assert (await env.client.get(f"/api/admin/export/users.csv?token={expired}")).status_code == 403
    outsider = analytics.make_export_token(secret, 7, "users", None)
    assert (await env.client.get(f"/api/admin/export/users.csv?token={outsider}")).status_code == 403
    forged = analytics.make_export_token(b"other-secret", ADMIN_ID, "users", None)
    assert (await env.client.get(f"/api/admin/export/users.csv?token={forged}")).status_code == 403


class FakeQuery:
    def __init__(self, payload: str, amount: int, currency: str = "XTR"):
        self.invoice_payload = payload
        self.total_amount = amount
        self.currency = currency
        self.answers: list[tuple[bool, str | None]] = []

    async def answer(self, ok: bool, error_message: str | None = None):
        self.answers.append((ok, error_message))


class FakeMessage:
    def __init__(self, payload: str, amount: int, charge: str):
        self.successful_payment = SimpleNamespace(invoice_payload=payload, total_amount=amount, telegram_payment_charge_id=charge)
        self.from_user = SimpleNamespace(id=ADMIN_ID)
        self.replies: list[str] = []

    async def answer(self, text: str, **kwargs):
        self.replies.append(text)


async def test_star_topup_invoice_checkout_and_payment(env):
    await register(env.client, ADMIN_ID)
    invoices = []

    async def create_invoice_link(**kwargs):
        invoices.append(kwargs)
        return "https://t.me/$invoice-test"

    env.bot.create_invoice_link = create_invoice_link
    assert (await env.client.post("/api/admin/stars/topup", headers=auth(ADMIN_ID), json={"amount": 0})).status_code == 422
    created = (await env.client.post("/api/admin/stars/topup", headers=auth(ADMIN_ID), json={"amount": 250})).json()
    assert created["url"] == "https://t.me/$invoice-test" and invoices[0]["currency"] == "XTR"
    assert invoices[0]["prices"][0].amount == 250
    payload = invoices[0]["payload"]
    assert payload == f"topup:{created['id']}"

    for query, expected in [
        (FakeQuery(payload, 250), (True, None)),
        (FakeQuery(payload, 100), (False, "Сумма счёта не совпадает")),
        (FakeQuery(payload, 250, "USD"), (False, "Сумма счёта не совпадает")),
        (FakeQuery(f"topup:{uuid.uuid4()}", 250), (False, "Счёт не найден")),
        (FakeQuery("garbage", 250), (False, "Счёт не найден")),
    ]:
        await handlers.pre_checkout(query)
        assert query.answers == [expected]

    message = FakeMessage(payload, 250, "charge-1")
    await handlers.successful_payment(message)
    await handlers.successful_payment(FakeMessage(payload, 250, "charge-1"))
    assert message.replies == ["Баланс бота пополнен на 250 ⭐."]
    async with sessionmaker()() as session:
        topup = (await session.execute(select(StarTopup))).scalar_one()
        paid_logs = (await session.execute(select(AuditLog).where(AuditLog.action == "stars.topup_paid"))).scalars().all()
    assert topup.status == "paid" and topup.telegram_payment_charge_id == "charge-1" and len(paid_logs) == 1
    repeat = FakeQuery(payload, 250)
    await handlers.pre_checkout(repeat)
    assert repeat.answers == [(False, "Счёт уже оплачен")]
    stars = (await env.client.get("/api/admin/stars", headers=auth(ADMIN_ID))).json()
    assert stars["balance"] == 500 and stars["topped_up"] == 250 and stars["topups"][0]["status"] == "paid"


async def test_withdrawal_queue_tabs(env):
    await register(env.client, ADMIN_ID)
    await register(env.client, 1)
    await set_settings(withdrawals_enabled=True, withdrawals_per_day=5)
    await fund(env, 1, "40")
    for _ in range(2):
        response = await env.client.post("/api/withdrawals", headers={**auth(1), "Idempotency-Key": str(uuid.uuid4())}, json={"gift_id": "15"})
        assert response.status_code == 200, response.text
    queue = (await env.client.get("/api/admin/withdrawals?tab=pending", headers=auth(ADMIN_ID))).json()
    assert queue["counts"] == {"pending": 2, "processing": 0, "done": 0}
    assert queue["pending_stars"] == 30 and queue["bot_star_balance"] == 500
    first = queue["items"][0]
    assert first["user_id"] == 1 and first["gift_id"] == "15" and first["stars"] == 15
    await env.client.post(f"/api/admin/withdrawals/{first['id']}/approve", headers=auth(ADMIN_ID), json={})
    done = (await env.client.get("/api/admin/withdrawals?tab=done", headers=auth(ADMIN_ID))).json()
    assert [w["status"] for w in done["items"]] == ["completed"]
    assert (await env.client.get("/api/admin/withdrawals?tab=x", headers=auth(ADMIN_ID))).status_code == 422


async def test_broadcast_audience_and_audit_filters(env):
    await register(env.client, ADMIN_ID)
    async with sessionmaker()() as session:
        session.add(User(id=1, first_name="A", ref_code="a1", bot_started_at=utcnow(), balance_available=1000))
        session.add(User(id=2, first_name="B", ref_code="b2", bot_started_at=utcnow()))
        await session.execute(update(User).where(User.id == ADMIN_ID).values(bot_started_at=utcnow()))
        await session.commit()
    sizes = {i["key"]: i["count"] for i in (await env.client.get("/api/admin/audience", headers=auth(ADMIN_ID))).json()["items"]}
    assert sizes == {"all": 3, "active7": 3, "balance": 1, "no_tasks": 3}
    bad = await env.client.post("/api/admin/broadcasts", headers=auth(ADMIN_ID), data={"text": "x", "audience": "vip"})
    assert bad.status_code == 422
    created = (await env.client.post("/api/admin/broadcasts", headers=auth(ADMIN_ID), data={"text": "Бонус", "audience": "balance"})).json()
    assert created["audience"] == "balance" and created["audience_label"] == "С доступным балансом"
    sent = (await env.client.post(f"/api/admin/broadcasts/{created['id']}/send", headers=auth(ADMIN_ID))).json()
    assert sent["total"] == 1
    await env.client.patch("/api/admin/settings", headers=auth(ADMIN_ID), json={"values": {"recheck_hours": "8"}})
    filtered = (await env.client.get("/api/admin/audit?action=broadcast", headers=auth(ADMIN_ID))).json()
    assert {a["action"] for a in filtered["items"]} == {"broadcast.create", "broadcast.send"}
    assert "settings.update" in filtered["actions"] and filtered["admins"] == [ADMIN_ID]
    searched = (await env.client.get("/api/admin/audit?q=recheck", headers=auth(ADMIN_ID))).json()
    assert [a["target"] for a in searched["items"]] == ["recheck_hours"]


def test_topup_payload_parsing():
    assert topups.parse_payload("topup:not-a-uuid") is None
    assert topups.parse_payload(None) is None
    value = uuid.uuid4()
    assert topups.parse_payload(f"topup:{value}") == value
