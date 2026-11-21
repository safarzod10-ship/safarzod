"""Files in chats, portfolio pictures, executor levels, client reputation, invitations, picks, Pro (Stars and USDT),
public share card.

Run:  TRUSTY_DB_URL=postgresql+asyncpg://... python -m tests.test_features
"""
import asyncio
import hashlib
import hmac
import io
import json
import os
import time
from datetime import timedelta
from decimal import Decimal

os.environ.setdefault("TRUSTY_BOT_TOKEN", "123456:TEST_TOKEN_for_signing_only")
os.environ["TRUSTY_BOT_MODE"] = "off"
os.environ["TRUSTY_CRYPTOPAY_TOKEN"] = "777:MOCK_TOKEN"
os.environ["TRUSTY_CRYPTOPAY_URL"] = "http://127.0.0.1:18767"
os.environ["TRUSTY_PUBLIC_URL"] = "https://trusty.example"
os.environ.setdefault("TRUSTY_UPLOAD_DIR", "/tmp/claude-0/-home-user-safarzod/cb7e660d-38ea-558c-88d3-b5711404703f/scratchpad/uploads")

import httpx  # noqa: E402
from aiohttp import web  # noqa: E402
from PIL import Image  # noqa: E402

from trusty import notify, pro  # noqa: E402
from trusty.auth import sign_init_data  # noqa: E402
from trusty.config import settings  # noqa: E402
from trusty.db import Session, engine  # noqa: E402
from trusty.main import app  # noqa: E402
from trusty.models import Base, Deal, Review, User, utcnow  # noqa: E402

from .mock_cryptopay import MockCryptoPay  # noqa: E402


def auth(uid: int, name: str) -> dict:
    init = sign_init_data({"auth_date": int(time.time()), "query_id": "AA1",
                           "user": {"id": uid, "first_name": name, "username": name.lower()}}, settings.bot_token)
    return {"Authorization": f"tma {init}"}


A, B, D, ADM = auth(5001, "Anna"), auth(5002, "Boris"), auth(5003, "Dina"), auth(5004, "Admin")
CALLS: list[tuple] = []


def png(color=(23, 99, 69), size=(40, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


class FakeBot:
    """Only what Pro needs from the bot: an invoice link in Telegram Stars."""

    def __init__(self):
        self.invoices = []

    async def create_invoice_link(self, **kw):
        self.invoices.append(kw)
        return f"https://t.me/$fake{len(self.invoices)}"


async def main() -> None:
    mock = MockCryptoPay()
    mapp = web.Application()
    mapp.router.add_route("*", "/api/{method}", mock.handle)
    runner = web.AppRunner(mapp)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", 18767).start()
    # record what would go to Telegram
    notify.send_project = lambda chat_id, p, text, note="НОВЫЙ ПРОЕКТ": CALLS.append(("project", chat_id, p.id, note))
    notify.send_matches = lambda chat_id, p, devs: CALLS.append(("matches", chat_id, p.id, [d["id"] for d in devs]))

    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)
        await c.run_sync(Base.metadata.create_all)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as h:
        def ok(r, code=200):
            assert r.status_code == code, f"{r.request.method} {r.request.url.path}: {r.status_code} {r.text[:300]}"
            return r.json() if r.headers.get("content-type", "").startswith("application/json") else r

        for who in (A, B, D, ADM):
            ok(await h.get("/api/bootstrap", headers=who))
        async with Session() as s:
            (await s.get(User, 5004)).is_admin = True
            for uid in (5002, 5003):
                (await s.get(User, uid)).bot_started = True
            await s.commit()
        base = {"years": 3, "rate": 20, "status": "free", "about": "Делаю Telegram-ботов и Mini App: записи, оплаты, CRM, админки, деплой на сервер."}
        ok(await h.put("/api/dev-profile", json={**base, "categories": ["bots"], "stack": ["Python", "aiogram"]}, headers=B))
        ok(await h.put("/api/dev-profile", json={**base, "categories": ["web"], "stack": ["React", "TypeScript"]}, headers=D))
        for uid in (5002, 5003):
            ok(await h.post(f"/api/admin/profiles/{uid}/approve", headers=ADM))

        # 1. files in a chat: pictures and documents with a caption; signed links; unknown types refused
        chat = ok(await h.post("/api/chats/open", json={"userId": 5002}, headers=A))
        cid = chat["id"]
        chat = ok(await h.post(f"/api/chats/{cid}/files", headers=A, data={"text": "Макеты и ТЗ"},
                               files=[("files", ("screen.png", png(), "image/png")), ("files", ("tz.pdf", b"%PDF-1.4 test", "application/pdf"))]))
        m = chat["messages"][-1]
        assert m["text"] == "Макеты и ТЗ" and [f["name"] for f in m["files"]] == ["screen.png", "tz.pdf"] and m["files"][0]["image"]
        r = ok(await h.get(m["files"][1]["url"]))
        assert r.content == b"%PDF-1.4 test" and "attachment" in r.headers["content-disposition"]
        ok(await h.get(m["files"][0]["url"].split("?")[0] + "?sig=00"), 403)
        ok(await h.post(f"/api/chats/{cid}/files", headers=A, files=[("files", ("x.exe", b"MZ", "application/x-msdownload"))]), 400)
        chat = ok(await h.post(f"/api/chats/{cid}/files", headers=B, files=[("files", ("work.zip", b"PK\x03\x04zip", "application/zip"))]))
        assert chat["messages"][-1]["files"][0]["name"] == "work.zip" and chat["messages"][-1]["text"] == ""
        b_list = ok(await h.get("/api/chats", headers=A))
        assert b_list[0]["unread"] == 1 and b_list[0]["messages"][-1]["files"][0]["name"] == "work.zip"

        # 2. portfolio: a picture (re-encoded to JPEG) and a link; links are checked; pictures belong to their owner
        up = ok(await h.post("/api/portfolio/image", headers=B, files={"file": ("shot.png", png((200, 10, 10)), "image/png")}))
        ok(await h.post("/api/portfolio/image", headers=B, files={"file": ("bad.png", b"not an image", "image/png")}), 400)
        me = ok(await h.put("/api/portfolio", headers=B, json={"items": [
            {"title": "Бот записи", "text": "3 филиала, оплата", "url": "https://t.me/salon_bot", "imageId": up["imageId"]}]}))
        work = me["profile"]["portfolio"][0]
        assert work["url"] == "https://t.me/salon_bot" and work["image"].startswith("/api/f/p/")
        r = ok(await h.get(work["image"]))
        assert r.headers["content-type"] == "image/jpeg"
        ok(await h.put("/api/portfolio", headers=B, json={"items": [{"title": "Сайт", "url": "javascript:alert(1)"}]}), 400)
        ok(await h.put("/api/portfolio", headers=D, json={"items": [{"title": "Чужое", "imageId": up["imageId"]}]}), 400)
        ok(await h.put("/api/portfolio", headers=A, json={"items": []}), 400)  # no profile

        # 3. levels: Новый -> Проверенный -> Топ, with what is left in plain words
        dev = ok(await h.get("/api/devs/5002", headers=A))
        assert dev["level"] == "new" and dev["levelNext"]["name"] == "Проверенный" and "ещё 3 сделки" in dev["levelNext"]["left"]

        async def finished(n: int, rating: int = 5):
            async with Session() as s:
                for _ in range(n):
                    d = Deal(client_id=5001, dev_id=5002, title="x", amount=10, days=1, status="done", result="ontime",
                             due_at=utcnow(), finished_at=utcnow(), created_at=utcnow() - timedelta(hours=2),
                             paid_at=utcnow() - timedelta(hours=1, minutes=30))
                    s.add(d)
                    await s.flush()
                    s.add(Review(deal_id=d.id, author_id=5001, target_id=5002, rating=rating))
                await s.commit()
        await finished(3)
        dev = ok(await h.get("/api/devs/5002", headers=A))
        assert dev["level"] == "verified" and dev["levelNext"]["name"] == "Топ" and "ещё 12 сделок" in dev["levelNext"]["left"], dev["levelNext"]
        await finished(12)
        dev = ok(await h.get("/api/devs/5002", headers=A))
        assert dev["level"] == "top" and dev["levelNext"] is None

        # 4. the client's reputation for executors: rating and "платит быстро" (paid within two hours, on average)
        async with Session() as s:
            for d in (await s.execute(__import__("sqlalchemy").select(Deal).limit(2))).scalars():
                s.add(Review(deal_id=d.id, author_id=5002, target_id=5001, rating=4))
            await s.commit()
        chat = ok(await h.get(f"/api/chats/{cid}", headers=B))
        assert chat["peer"]["fastPay"] is True and chat["peer"]["rating"] == 4.0 and chat["peer"]["deals"] == 15, chat["peer"]

        # 5. invitations and picks; Pro executors come first; Pro executors get new projects at once
        new = {"title": "Бот для записи в студию", "category": "bots", "text": "Запись к мастеру, напоминания, админка расписания и оплата.",
               "budgetMin": 50, "budgetMax": 90, "days": 7, "stack": ["Python"]}
        CALLS.clear()
        p = ok(await h.post("/api/projects", headers=A, json=new))
        assert ("matches", 5001, p["id"], ["5002"]) in CALLS and not any(c[0] == "project" for c in CALLS)  # nobody is Pro yet
        p2 = ok(await h.post(f"/api/projects/{p['id']}/invite", headers=A, json={"devId": 5002}))
        assert p2["invitedIds"] == ["5002"] and ("project", 5002, p["id"], "ПРИГЛАШЕНИЕ") in CALLS
        ok(await h.post(f"/api/projects/{p['id']}/invite", headers=A, json={"devId": 5002}), 400)
        ok(await h.post(f"/api/projects/{p['id']}/invite", headers=B, json={"devId": 5003}), 404)
        assert ok(await h.get(f"/api/projects/{p['id']}", headers=B))["invited"] is True
        assert [d["id"] for d in ok(await h.get(f"/api/projects/{p['id']}/matches", headers=A))] == ["5002"]
        ok(await h.put("/api/dev-profile", json={**base, "categories": ["web", "bots"], "stack": ["React", "Python"]}, headers=D))
        ok(await h.post("/api/admin/profiles/5003/approve", headers=ADM))
        async with Session() as s:
            (await s.get(User, 5003)).pro_until = utcnow() + timedelta(days=5)
            await s.commit()
        picks = ok(await h.get(f"/api/projects/{p['id']}/matches", headers=A))
        assert [d["id"] for d in picks] == ["5003", "5002"] and picks[0]["pro"], [(d["id"], d["pro"]) for d in picks]  # Pro first
        CALLS.clear()
        ok(await h.post("/api/projects", headers=A, json={**new, "title": "Ещё один бот для записи"}))
        assert [c[1] for c in CALLS if c[0] == "project"] == [5003]  # only the Pro executor who fits
        ok(await h.patch("/api/me", headers=D, json={"alerts": False}))
        CALLS.clear()
        ok(await h.post("/api/projects", headers=A, json={**new, "title": "Третий бот для записи"}))
        assert not any(c[0] == "project" for c in CALLS)  # alerts switched off

        # 6. Pro in USDT through Crypto Pay (webhook) and in Telegram Stars (pre-checkout + successful payment)
        info = ok(await h.get("/api/pro", headers=B))
        assert info["active"] is False and info["plans"][0]["stars"] == settings.pro_stars and info["plans"][1]["discount"] == 15
        url = ok(await h.post("/api/pro/crypto", headers=B, json={"plan": "1m"}))["url"]
        iid = max(mock.invoices)
        assert url and mock.invoices[iid]["amount"] == "5.00" and mock.invoices[iid]["payload"].startswith("pro:")
        paid = mock.pay(iid)
        raw = json.dumps({"update_id": 9, "update_type": "invoice_paid", "request_date": "2026-11-21T00:00:00Z", "payload": paid}).encode()
        sig = hmac.new(hashlib.sha256(b"777:MOCK_TOKEN").digest(), raw, hashlib.sha256).hexdigest()
        ok(await h.post("/api/cryptopay/webhook", content=raw, headers={"crypto-pay-api-signature": sig, "content-type": "application/json"}))
        ok(await h.post("/api/cryptopay/webhook", content=raw, headers={"crypto-pay-api-signature": sig, "content-type": "application/json"}))
        async with Session() as s:
            until = (await s.get(User, 5002)).pro_until
        assert ok(await h.get("/api/pro", headers=B))["active"] and abs((until - utcnow()) - timedelta(days=30)) < timedelta(minutes=1)

        notify.bot = FakeBot()
        link = ok(await h.post("/api/pro/stars", headers=B, json={"plan": "3m"}))["url"]
        inv = notify.bot.invoices[-1]
        assert link.startswith("https://t.me/") and inv["currency"] == "XTR" and inv["prices"][0].amount == round(settings.pro_stars * 3 * 0.85)
        async with Session() as s:
            assert await pro.check_stars(s, inv["payload"], 5002, inv["prices"][0].amount, "XTR") is None
            assert await pro.check_stars(s, inv["payload"], 5002, 1, "XTR")  # wrong amount
            assert await pro.check_stars(s, inv["payload"], 5001, inv["prices"][0].amount, "XTR")  # someone else
            await s.rollback()
        async with Session() as s:
            assert await pro.paid_stars(s, inv["payload"], 5002, "charge-1") is True
        async with Session() as s:
            assert await pro.paid_stars(s, inv["payload"], 5002, "charge-1") is False  # once
            u = await s.get(User, 5002)
            assert abs((u.pro_until - utcnow()) - timedelta(days=30 + 90)) < timedelta(minutes=1)  # periods add up
        notify.bot = None
        me = ok(await h.get("/api/bootstrap", headers=B))["me"]
        assert me["pro"]["active"] and me["profile"]["pro"]

        # 7. public card: a picture and a page with a link preview that opens the bot
        r = ok(await h.get("/api/share/dev/5002.jpg"))
        assert r.headers["content-type"] == "image/jpeg" and len(r.content) > 5000
        page = ok(await h.get("/api/u/5002")).text
        assert 'og:image" content="https://trusty.example/api/share/dev/5002.jpg"' in page and "t.me/itrusty_bot?start=dev_5002" in page
        ok(await h.get("/api/u/5001"), 404)  # not an executor
    print("features OK: files, portfolio, levels, client reputation, invites, picks, Pro (USDT + Stars), share card")
    from trusty.cryptopay import pay
    await pay.close()
    await runner.cleanup()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
