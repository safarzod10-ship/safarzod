"""End-to-end API flow: auth, profile moderation, projects, bids, deal, chat, complaint, bans.

Run:  TRUSTY_DB_URL=postgresql+asyncpg://... python -m tests.test_flow
(uses a throwaway database; tables are dropped first)
"""
import asyncio
import os
import time

os.environ.setdefault("TRUSTY_BOT_TOKEN", "123456:TEST_TOKEN_for_signing_only")
os.environ["TRUSTY_BOT_MODE"] = "off"
os.environ.setdefault("TRUSTY_UPLOAD_DIR", "/tmp/claude-0/-home-user-safarzod/cb7e660d-38ea-558c-88d3-b5711404703f/scratchpad/uploads")

import httpx  # noqa: E402

from trusty.auth import sign_init_data  # noqa: E402
from trusty.config import settings  # noqa: E402
from trusty.db import Session, engine  # noqa: E402
from trusty.main import app  # noqa: E402
from trusty.models import Base, User  # noqa: E402

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


def auth(uid: int, name: str) -> dict:
    init = sign_init_data({"auth_date": int(time.time()), "query_id": "AA1",
                           "user": {"id": uid, "first_name": name, "username": name.lower()}}, settings.bot_token)
    return {"Authorization": f"tma {init}"}


A, B, ADM = auth(1001, "Anna"), auth(1002, "Boris"), auth(1003, "Admin")


async def main() -> None:
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)
        await c.run_sync(Base.metadata.create_all)
    tr = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=tr, base_url="http://t") as h:
        ok = lambda r, code=200: (r.status_code == code) or (_ for _ in ()).throw(AssertionError(f"{r.status_code} {r.text}"))  # noqa: E731

        r = await h.get("/api/bootstrap", headers={"Authorization": "tma user=%7B%7D&hash=00"})
        ok(r, 401)
        r = await h.get("/api/bootstrap", headers=A); ok(r)
        assert r.json()["me"]["devForm"] == "none" and r.json()["devs"] == [] and r.json()["me"]["onboarded"] is False
        r = await h.patch("/api/me", json={"role": "client", "onboarded": True}, headers=A); ok(r)
        assert r.json()["onboarded"] is True and r.json()["role"] == "client"
        ok(await h.patch("/api/me", json={"role": "boss"}, headers=A), 422)
        await h.get("/api/bootstrap", headers=B)
        await h.get("/api/bootstrap", headers=ADM)
        async with Session() as s:
            (await s.get(User, 1003)).is_admin = True
            await s.commit()

        form = {"categories": ["bots"], "years": 2, "stack": ["Python", "aiogram"], "rate": 20, "status": "free",
                "about": "Пишу ботов на aiogram три года, интеграции с CRM и оплатами, сдаю с инструкцией.",
                "github": "https://github.com/boris", "links": ["https://t.me/boris_bot"]}
        r = await h.put("/api/dev-profile", json=form, headers=B); ok(r)
        assert r.json()["devForm"] == "review" and r.json()["profile"]["github"] == "boris"

        r = await h.post("/api/projects", json={"title": "Бот", "category": "bots", "text": "x", "budgetMin": 1,
                                                "budgetMax": 2, "days": 1}, headers=A)
        ok(r, 422)
        proj = {"title": "Бот для записи в барбершоп", "category": "bots", "budgetMin": 50, "budgetMax": 150, "days": 7,
                "text": "Запись к мастеру, напоминания за два часа, админка расписания для двух филиалов.",
                "stack": ["Python"]}
        r = await h.post("/api/projects", json=proj, headers=A); ok(r)
        pid = r.json()["id"]

        bid = {"price": 150, "days": 6, "text": "Сделаю на aiogram 3, покажу демо через три дня."}
        r = await h.post(f"/api/projects/{pid}/bids", json=bid, headers=B); ok(r, 403)  # not moderated yet

        r = await h.get("/api/admin/overview", headers=A); ok(r, 403)
        r = await h.get("/api/admin/overview", headers=ADM); ok(r)
        assert [p["id"] for p in r.json()["profiles"]] == ["1002"]
        ok(await h.post("/api/admin/profiles/1002/approve", headers=ADM))

        r = await h.post(f"/api/projects/{pid}/bids", json=bid, headers=B); ok(r)
        assert r.json()["myBid"]["price"] == 150 and r.json()["bids"] == []  # bidder does not see the bid list
        r = await h.get(f"/api/projects/{pid}", headers=A); ok(r)
        assert r.json()["bidsCount"] == 1 and r.json()["bids"][0]["devId"] == "1002"

        r = await h.post(f"/api/projects/{pid}/choose", json={"devId": 1002}, headers=A); ok(r, 400)  # new dev limit
        ok(await h.post(f"/api/projects/{pid}/bids", json={**bid, "price": 90}, headers=B))
        r = await h.post(f"/api/projects/{pid}/choose", json={"devId": 1002}, headers=A); ok(r)
        chat_id, deal_id = r.json()["chatId"], r.json()["dealId"]

        r = await h.post(f"/api/chats/{chat_id}/messages", json={"text": "Привет! Жду демо."}, headers=A); ok(r)
        r = await h.get("/api/chats", headers=B); ok(r)
        assert r.json()[0]["unread"] == 2 and r.json()[0]["deal"]["status"] == "awaiting_payment"
        r = await h.post(f"/api/chats/{chat_id}/messages", json={"text": "давай напрямую, напиши в лс"}, headers=B); ok(r)
        texts = [m["text"] for m in r.json()["messages"]]
        assert any(t.startswith("Внимание:") for t in texts)
        ok(await h.post(f"/api/chats/{chat_id}/read", headers=A))
        r = await h.get(f"/api/chats/{chat_id}", headers=ADM); ok(r, 404)  # strangers can't read chats

        files = [("files", ("shot.png", PNG, "image/png"))]
        data = {"against": "1002", "reason": "offsite_payment", "deal": str(deal_id),
                "text": "Просит перейти в личку и оплатить напрямую, минуя гаранта."}
        r = await h.post("/api/complaints", data=data, files=files, headers=A); ok(r)
        cid, url = r.json()["id"], r.json()["evidence"][0]
        ok(await h.get(url))
        ok(await h.get(url[:-4] + "0000"), 403)

        r = await h.post(f"/api/admin/complaints/{cid}/ban", headers=ADM); ok(r)
        assert "Первое нарушение" in r.json()["message"]
        ok(await h.get("/api/bootstrap", headers=B), 403)
        ok(await h.post("/api/admin/users/1002/unban", headers=ADM))
        ok(await h.get("/api/bootstrap", headers=B))
        r = await h.post("/api/admin/users/1002/ban", headers=ADM); ok(r)
        assert "бессрочная" in r.json()["message"] and r.json()["member"]["ban"] == {"until": None}
        ok(await h.post("/api/admin/users/1003/ban", headers=ADM), 400)  # admins can't be banned

        r = await h.get("/api/bootstrap", headers=A); ok(r)
        assert r.json()["devs"] == []  # banned developer is hidden from the catalogue
        print("API flow OK")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
