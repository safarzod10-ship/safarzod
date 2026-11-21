"""Offers in chats: propose, counter from both sides, accept (creates the deal), decline, withdraw, expiry, typing.

Run:  TRUSTY_DB_URL=postgresql+asyncpg://... python -m tests.test_offers
"""
import asyncio
import os
import time
from datetime import timedelta

os.environ.setdefault("TRUSTY_BOT_TOKEN", "123456:TEST_TOKEN_for_signing_only")
os.environ["TRUSTY_BOT_MODE"] = "off"

import httpx  # noqa: E402

from trusty import offers  # noqa: E402
from trusty.auth import sign_init_data  # noqa: E402
from trusty.config import settings  # noqa: E402
from trusty.db import Session, engine  # noqa: E402
from trusty.main import app  # noqa: E402
from trusty.models import Base, Offer, User, utcnow  # noqa: E402


def auth(uid: int, name: str) -> dict:
    init = sign_init_data({"auth_date": int(time.time()), "query_id": "AA1",
                           "user": {"id": uid, "first_name": name, "username": name.lower()}}, settings.bot_token)
    return {"Authorization": f"tma {init}"}


A, B, C, ADM = auth(2001, "Anna"), auth(2002, "Boris"), auth(2003, "Clara"), auth(2004, "Admin")


def offer_cards(chat: dict) -> list[dict]:
    return [m["offer"] for m in chat["messages"] if m.get("offer")]


async def main() -> None:
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)
        await c.run_sync(Base.metadata.create_all)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as h:
        def ok(r, code=200):
            assert r.status_code == code, f"{r.status_code} {r.text}"
            return r.json()

        for who in (A, B, C, ADM):
            ok(await h.get("/api/bootstrap", headers=who))
        async with Session() as s:
            (await s.get(User, 2004)).is_admin = True
            await s.commit()
        form = {"categories": ["web"], "years": 3, "stack": ["React", "TypeScript"], "rate": 20, "status": "free",
                "about": "Делаю лендинги и Mini App на React, адаптив, анимации, формы заявок с интеграцией в CRM."}
        ok(await h.put("/api/dev-profile", json=form, headers=B))

        chat = ok(await h.post("/api/chats/open", json={"userId": 2002}, headers=A))
        cid = chat["id"]
        offer = {"title": "Лендинг для кофейни", "amount": 90, "days": 7, "ttlHours": 48, "asRole": "client"}
        r = ok(await h.post(f"/api/chats/{cid}/offers", json=offer, headers=A), 400)
        assert "проверку анкеты" in r["detail"], r  # the developer is not verified yet
        ok(await h.post("/api/admin/profiles/2002/approve", headers=ADM))

        # 1. Anna offers 90, Boris answers 70, Anna answers 80, Boris accepts
        chat = ok(await h.post(f"/api/chats/{cid}/offers", json=offer, headers=A))
        o1 = offer_cards(chat)[-1]
        assert o1["mine"] and o1["status"] == "pending" and o1["myRole"] == "client" and o1["total"] == "94.50", o1
        assert chat["messages"][-1]["from"] == "me" and chat["unread"] == 0
        b_chat = ok(await h.get(f"/api/chats/{cid}", headers=B))
        assert b_chat["offersWaiting"] == 1 and not offer_cards(b_chat)[-1]["mine"] and b_chat["unread"] == 1
        assert offer_cards(b_chat)[-1]["myRole"] == "dev"
        ok(await h.post(f"/api/offers/{o1['id']}/accept", headers=A), 400)  # not to yourself

        chat = ok(await h.post(f"/api/offers/{o1['id']}/counter", json={"amount": 70, "days": 6}, headers=B))
        cards = offer_cards(chat)
        assert cards[0]["status"] == "countered" and cards[1]["amount"] == 70 and cards[1]["prevAmount"] == 90 and cards[1]["mine"]
        o2 = cards[1]
        ok(await h.post(f"/api/offers/{o1['id']}/accept", headers=B), 400)  # already answered
        chat = ok(await h.post(f"/api/offers/{o2['id']}/counter", json={"amount": 80, "days": 6}, headers=A))
        o3 = offer_cards(chat)[-1]
        assert o3["amount"] == 80 and o3["prevAmount"] == 70 and o3["myRole"] == "client"
        r = ok(await h.post(f"/api/offers/{o3['id']}/accept", headers=B))
        deal = r["deal"]
        assert deal["amount"] == 80 and deal["status"] == "awaiting_payment" and deal["role"] == "dev", deal
        assert deal["client"]["id"] == "2001" and deal["dev"]["id"] == "2002" and deal["total"] == "84.00"
        cards = offer_cards(r["chat"])
        assert [c["status"] for c in cards] == ["countered", "countered", "accepted"] and cards[-1]["dealId"] == deal["id"]
        assert r["chat"]["deal"]["id"] == deal["id"] and r["chat"]["offersWaiting"] == 0
        assert any(m["from"] == "system" and f"Сделка #{deal['id']} создана" in m["text"] for m in r["chat"]["messages"])
        ok(await h.post(f"/api/offers/{o3['id']}/accept", headers=B), 400)

        # 2. limits: a new developer cannot take more than the new-dev limit
        big = {**offer, "amount": settings.new_dev_limit + 1}
        r = ok(await h.post(f"/api/chats/{cid}/offers", json=big, headers=A), 400)
        assert "ограничена" in r["detail"]

        # 3. decline and withdraw
        chat = ok(await h.post(f"/api/chats/{cid}/offers", json={**offer, "title": "Правки по лендингу", "amount": 30}, headers=A))
        o4 = offer_cards(chat)[-1]
        chat = ok(await h.post(f"/api/offers/{o4['id']}/decline", headers=B))
        assert offer_cards(chat)[-1]["status"] == "declined"
        chat = ok(await h.post(f"/api/chats/{cid}/offers", json={**offer, "title": "Ещё правки", "amount": 40}, headers=A))
        o5 = offer_cards(chat)[-1]
        ok(await h.post(f"/api/offers/{o5['id']}/withdraw", headers=B), 400)  # not his
        chat = ok(await h.post(f"/api/offers/{o5['id']}/withdraw", headers=A))
        assert offer_cards(chat)[-1]["status"] == "withdrawn"
        ok(await h.post(f"/api/offers/{o5['id']}/accept", headers=B), 400)

        # 4. a developer offers to a client (sender is the dev), and expiry
        chat = ok(await h.post(f"/api/chats/{cid}/offers", json={**offer, "title": "Поддержка сайта", "amount": 25, "asRole": "dev", "ttlHours": 24}, headers=B))
        o6 = offer_cards(chat)[-1]
        assert o6["myRole"] == "dev" and o6["mine"]
        async with Session() as s:
            (await s.get(Offer, o6["id"])).expires_at = utcnow() - timedelta(minutes=1)
            await s.commit()
        a_chat = ok(await h.get(f"/api/chats/{cid}", headers=A))
        assert offer_cards(a_chat)[-1]["status"] == "expired" and a_chat["offersWaiting"] == 0
        r = ok(await h.post(f"/api/offers/{o6['id']}/accept", headers=A), 400)
        assert "истёк" in r["detail"]
        async with Session() as s:
            await offers.expire_due(s)
            assert (await s.get(Offer, o6["id"])).status == "expired"

        # 5. strangers cannot touch offers; typing indicator
        c_chat = ok(await h.post("/api/chats/open", json={"userId": 2001}, headers=C))
        ok(await h.post(f"/api/offers/{o1['id']}/decline", headers=C), 404)
        r = ok(await h.post(f"/api/chats/{c_chat['id']}/offers", json=offer, headers=C), 400)  # Anna has no dev profile
        ok(await h.post(f"/api/chats/{cid}/typing", headers=A))
        assert ok(await h.get(f"/api/chats/{cid}", headers=B))["peerTyping"] is True
        assert ok(await h.get(f"/api/chats/{cid}", headers=A))["peerTyping"] is False

        # 6. a banned peer cannot receive offers
        ok(await h.post("/api/admin/users/2002/ban", headers=ADM))
        r = ok(await h.post(f"/api/chats/{cid}/offers", json={**offer, "amount": 20}, headers=A), 400)
        assert "заблокирован" in r["detail"]
    print("offers OK: counter x2, accept -> deal, decline, withdraw, expiry, limits, typing")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
