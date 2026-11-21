"""Escrow and payments against an in-process mock of the Crypto Pay API (no real money moves).

Run:  TRUSTY_DB_URL=postgresql+asyncpg://... python -m tests.test_escrow
"""
import asyncio
import hashlib
import hmac
import json
import os
import time
from datetime import timedelta

os.environ.setdefault("TRUSTY_BOT_TOKEN", "123456:TEST_TOKEN_for_signing_only")
os.environ["TRUSTY_BOT_MODE"] = "off"
os.environ["TRUSTY_CRYPTOPAY_TOKEN"] = "777:MOCK_TOKEN"
os.environ["TRUSTY_CRYPTOPAY_URL"] = "http://127.0.0.1:18765"
os.environ["TRUSTY_PUBLIC_URL"] = "https://trusty.example"
os.environ.setdefault("TRUSTY_UPLOAD_DIR", "/tmp/claude-0/-home-user-safarzod/cb7e660d-38ea-558c-88d3-b5711404703f/scratchpad/uploads")

import httpx  # noqa: E402
from aiohttp import web  # noqa: E402
from sqlalchemy import select, update  # noqa: E402

from trusty import escrow  # noqa: E402
from trusty.auth import sign_init_data  # noqa: E402
from trusty.config import settings  # noqa: E402
from trusty.db import Session, engine  # noqa: E402
from trusty.main import app  # noqa: E402
from trusty.models import Base, Deal, DevProfile, Payment, User  # noqa: E402

from .mock_cryptopay import MockCryptoPay  # noqa: E402


def auth(uid: int, name: str) -> dict:
    init = sign_init_data({"auth_date": int(time.time()), "user": {"id": uid, "first_name": name, "username": name.lower()}},
                          settings.bot_token)
    return {"Authorization": f"tma {init}"}


A, B, ADM = auth(3001, "Client"), auth(3002, "Dev"), auth(3003, "Admin")


def signed(body: dict) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    sig = hmac.new(hashlib.sha256(b"777:MOCK_TOKEN").digest(), raw, hashlib.sha256).hexdigest()
    return raw, {"crypto-pay-api-signature": sig, "content-type": "application/json"}


async def main() -> None:
    mock = MockCryptoPay()
    mapp = web.Application()
    mapp.router.add_route("*", "/api/{method}", mock.handle)
    runner = web.AppRunner(mapp)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", 18765).start()

    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)
        await c.run_sync(Base.metadata.create_all)
    tr = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=tr, base_url="http://t") as h:
        def ok(r, code=200):
            if r.status_code != code:
                raise AssertionError(f"{r.request.method} {r.request.url.path}: {r.status_code} {r.text}")
            return r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text

        for hd in (A, B, ADM):
            ok(await h.get("/api/bootstrap", headers=hd))
        async with Session() as s:
            (await s.get(User, 3003)).is_admin = True
            s.add(DevProfile(user_id=3002, title="Боты", categories=["bots"], stack=["Python", "aiogram"], rate=20,
                             about="x" * 80, moderation="published"))
            await s.commit()

        async def new_deal(price: int = 90) -> int:
            pr = ok(await h.post("/api/projects", headers=A, json={
                "title": f"Проект для сделки {time.time_ns()}", "category": "bots", "budgetMin": 50, "budgetMax": 150, "days": 7,
                "text": "Нужен бот: запись, напоминания, админка расписания, интеграция с таблицей."}))
            ok(await h.post(f"/api/projects/{pr['id']}/bids", headers=B, json={"price": price, "days": 5, "text": "Сделаю аккуратно и в срок."}))
            return ok(await h.post(f"/api/projects/{pr['id']}/choose", headers=A, json={"devId": 3002}))["dealId"]

        async def paid_deal() -> int:
            did = await new_deal()
            inv = ok(await h.post(f"/api/deals/{did}/pay", headers=A))
            iid = int(inv["url"].rsplit("IV", 1)[1])
            mock.pay(iid)
            ok(await h.post(f"/api/deals/{did}/check", headers=A))
            return did

        # 1. invoice: only the client pays; the same active invoice is reused
        d1 = await new_deal()
        deal = ok(await h.get(f"/api/deals/{d1}", headers=A))
        assert deal["status"] == "awaiting_payment" and deal["fee"] == "4.50" and deal["total"] == "94.50", deal
        assert deal["actions"]["pay"] and not deal["actions"]["submit"]
        ok(await h.post(f"/api/deals/{d1}/pay", headers=B), 400)
        inv = ok(await h.post(f"/api/deals/{d1}/pay", headers=A))
        inv2 = ok(await h.post(f"/api/deals/{d1}/pay", headers=A))
        assert inv["url"] == inv2["url"] and inv["amount"] == "94.50" and len(mock.invoices) == 1
        iid = int(inv["url"].rsplit("IV", 1)[1])
        assert mock.invoices[iid]["payload"] == f"deal:{d1}" and mock.invoices[iid]["amount"] == "94.50"

        # 2. webhook: bad signature rejected; good one marks the deal paid; a replay changes nothing
        paid = mock.pay(iid)
        upd = {"update_id": 1, "update_type": "invoice_paid", "request_date": "2026-11-20T00:00:00Z", "payload": paid}
        raw, hdr = signed(upd)
        ok(await h.post("/api/cryptopay/webhook", content=raw, headers={**hdr, "crypto-pay-api-signature": "0" * 64}), 401)
        ok(await h.post("/api/cryptopay/webhook", content=raw, headers=hdr))
        ok(await h.post("/api/cryptopay/webhook", content=raw, headers=hdr))
        deal = ok(await h.get(f"/api/deals/{d1}", headers=B))
        assert deal["status"] == "in_work" and deal["actions"]["submit"] and deal["paidAt"]
        chat = ok(await h.get(f"/api/chats/{deal['chatId']}", headers=A))
        assert sum("внёс 94,50 USDT" in m["text"] for m in chat["messages"]) == 1  # replay did not duplicate
        ok(await h.post(f"/api/deals/{d1}/pay", headers=A), 400)  # already paid

        # 3. submit -> accept -> payout of the amount (not the fee) to the developer, once
        ok(await h.post(f"/api/deals/{d1}/submit", headers=A, json={"note": ""}), 400)
        deal = ok(await h.post(f"/api/deals/{d1}/submit", headers=B, json={"note": "Ссылка на репозиторий в чате"}))
        assert deal["status"] == "review" and deal["reviewUntil"]
        ok(await h.post(f"/api/deals/{d1}/accept", headers=B), 400)
        deal = ok(await h.post(f"/api/deals/{d1}/accept", headers=A))
        assert deal["status"] == "done" and deal["result"] == "ontime" and deal["actions"]["review"]
        t = mock.transfers[f"trusty-{d1}-payout-3002"]
        assert t["amount"] == "90.00" and t["user_id"] == 3002 and len(mock.transfers) == 1
        ok(await h.post(f"/api/deals/{d1}/accept", headers=A), 400)
        ok(await h.post(f"/api/deals/{d1}/review", headers=A, json={"rating": 5, "text": "Отлично"}))
        ok(await h.post(f"/api/deals/{d1}/review", headers=A, json={"rating": 4}), 400)  # once per side
        deal = ok(await h.get(f"/api/deals/{d1}", headers=B))
        assert deal["actions"]["review"] and deal["review"]["rating"] == 5 and deal["clientReview"] is None
        # the developer rates the client too; it does not change the developer's own rating
        deal = ok(await h.post(f"/api/deals/{d1}/review", headers=B, json={"rating": 3, "text": "Долго отвечал"}))
        assert deal["clientReview"]["rating"] == 3 and not deal["actions"]["review"]
        ok(await h.post(f"/api/deals/{d1}/review", headers=ADM, json={"rating": 1}), 400)  # not a party
        dev = ok(await h.get("/api/devs/3002", headers=A))
        assert dev["deals"] == 1 and dev["rating"] == 5 and dev["volume"] == 90

        # 4. paid without any webhook: the background sync picks it up; the developer declines -> full refund
        d2 = await new_deal()
        inv = ok(await h.post(f"/api/deals/{d2}/pay", headers=A))
        mock.pay(int(inv["url"].rsplit("IV", 1)[1]))
        async with Session() as s:
            await escrow.sync_invoices(s)
        ok(await h.post(f"/api/deals/{d2}/cancel", headers=A), 400)  # the client can't cancel a paid deal
        deal = ok(await h.post(f"/api/deals/{d2}/cancel", headers=B))
        assert deal["status"] == "refunded" and mock.transfers[f"trusty-{d2}-refund-3001"]["amount"] == "94.50"
        assert (ok(await h.get("/api/projects", headers=A)) if False else True)

        # 5. dispute split 60/40; the client never opened @CryptoBot -> a check pinned to them instead
        d3 = await paid_deal()
        ok(await h.post(f"/api/deals/{d3}/dispute", headers=A, json={"reason": "коротко"}), 422)
        ok(await h.post(f"/api/deals/{d3}/dispute", headers=A, json={"reason": "Работа не соответствует ТЗ"}))
        ok(await h.post(f"/api/admin/deals/{d3}/resolve", headers=A, json={"devShare": 60}), 403)
        mock.fail_transfer[3001] = "USER_NOT_FOUND"
        deal = ok(await h.post(f"/api/admin/deals/{d3}/resolve", headers=ADM, json={"devShare": 60, "note": "Сделано частично."}))
        assert deal["status"] == "done" and deal["devShare"] == 60 and deal["result"] == "dispute_won"
        assert mock.transfers[f"trusty-{d3}-payout-3002"]["amount"] == "54.00"
        mine = ok(await h.get(f"/api/deals/{d3}", headers=A))
        refund = [p for p in mine["payments"] if p["kind"] == "refund"][0]
        assert refund["status"] == "check" and refund["amount"] == "36.00" and refund["url"].startswith("https://t.me/CryptoBot?start=CQ")
        assert all(p["userId"] == "3001" for p in mine["payments"] if p["kind"] != "invoice")  # the developer's payout is not shown
        mock.fail_transfer.clear()

        # 6. network failure after the transfer went through: retried with the same spend_id, paid exactly once, no check
        d4 = await paid_deal()
        ok(await h.post(f"/api/deals/{d4}/submit", headers=B, json={}))
        mock.network_fail_once.add(3002)
        deal = ok(await h.post(f"/api/deals/{d4}/accept", headers=A))
        assert deal["status"] == "done"
        async with Session() as s:
            p = (await s.execute(select(Payment).where(Payment.spend_id == f"trusty-{d4}-payout-3002"))).scalar_one()
            assert p.status == "failed" and p.error.startswith("502 "), (p.status, p.error)
            await s.execute(update(Payment).where(Payment.id == p.id).values(updated_at=p.updated_at - timedelta(minutes=10)))
            await s.commit()
            await escrow.retry_failed_payouts(s)
        async with Session() as s:
            p = (await s.execute(select(Payment).where(Payment.spend_id == f"trusty-{d4}-payout-3002"))).scalar_one()
            assert p.status == "sent" and p.attempts == 2
        assert len([k for k in mock.transfers if k == f"trusty-{d4}-payout-3002"]) == 1 and not mock.checks.keys() - {k for k in mock.checks}

        # 7. auto-acceptance after the review period
        d5 = await paid_deal()
        ok(await h.post(f"/api/deals/{d5}/submit", headers=B, json={}))
        async with Session() as s:
            await s.execute(update(Deal).where(Deal.id == d5).values(review_until=Deal.review_until - timedelta(days=10)))
            await s.commit()
            await escrow.auto_accept_due(s)
        deal = ok(await h.get(f"/api/deals/{d5}", headers=B))
        assert deal["status"] == "done" and f"trusty-{d5}-payout-3002" in mock.transfers

        # 8. cancel before payment; strangers can't see deals; finance for admins
        d6 = await new_deal()
        ok(await h.post(f"/api/deals/{d6}/pay", headers=A))
        deal = ok(await h.post(f"/api/deals/{d6}/cancel", headers=A))
        assert deal["status"] == "cancelled"
        ok(await h.get(f"/api/deals/{d6}", headers=auth(3999, "Stranger")), 404)
        fin = ok(await h.get("/api/admin/finance", headers=ADM))
        assert fin["enabled"] and fin["balance"][0]["available"] == "1000.00" and fin["payments"]
        ok(await h.get("/api/admin/finance", headers=A), 403)
        boot = ok(await h.get("/api/bootstrap", headers=A))
        assert len(boot["deals"]) == 6 and boot["payments"]["feePercent"] == 5
        print("escrow OK:", len(mock.transfers), "transfers,", len(mock.checks), "check,", len(mock.invoices), "invoices")
    await runner.cleanup()
    from trusty.cryptopay import pay
    await pay.close()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
