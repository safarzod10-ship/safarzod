import asyncio
import os

os.environ.setdefault("TRUSTY_BOT_TOKEN", "123456:TEST_TOKEN_for_signing_only")
os.environ["TRUSTY_BOT_MODE"] = "off"
os.environ["TRUSTY_PUBLIC_URL"] = "https://trusty.example"

from aiogram.client.session.base import BaseSession
from aiogram.methods import TelegramMethod
from aiogram.types import Update

from trusty.bot import build
from trusty.db import engine
from trusty.models import Base

CALLS: list[tuple[str, dict]] = []


class FakeSession(BaseSession):
    async def make_request(self, bot, method: TelegramMethod, timeout=None):
        name = type(method).__name__
        CALLS.append((name, method.model_dump(exclude_none=True)))
        if name in ("SendPhoto", "SendMessage", "EditMessageMedia", "EditMessageText"):
            return method.__returning__.model_validate({
                "message_id": len(CALLS), "date": 0, "chat": {"id": 42, "type": "private"},
                "photo": [{"file_id": f"F{len(CALLS)}", "file_unique_id": "u", "width": 1200, "height": 630}]})
        if name == "AnswerCallbackQuery":
            return True
        return True

    async def close(self):
        pass

    async def stream_content(self, *a, **k):
        yield b""


def user(uid=42):
    return {"id": uid, "is_bot": False, "first_name": "Тест", "username": "test"}


def msg(text: str, mid: int = 1):
    return {"message_id": mid, "date": 0, "chat": {"id": 42, "type": "private"}, "from": user(), "text": text,
            **({"entities": [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}]} if text.startswith("/") else {})}


def buttons(kw: dict) -> list[dict]:
    return [b for row in (kw.get("reply_markup") or {}).get("inline_keyboard", []) for b in row]


async def main():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)
        await c.run_sync(Base.metadata.create_all)
    bot, dp = build()
    bot.session = FakeSession()

    await dp.feed_update(bot, Update.model_validate({"update_id": 1, "message": msg("/start")}))
    name, kw = CALLS[-1]
    assert name == "SendPhoto" and "Деньги у гаранта" in kw["caption"], CALLS[-1]
    bs = buttons(kw)
    assert bs[0]["web_app"]["url"] == "https://trusty.example/" and any(b.get("callback_data") == "m:deals" for b in bs), bs
    assert bs[0]["style"] == "primary", bs[0]

    for i, data in enumerate(("m:how", "m:deals", "m:help", "m:home")):
        cq = {"id": str(i), "from": user(), "chat_instance": "x", "data": data,
              "message": {"message_id": 5, "date": 0, "chat": {"id": 42, "type": "private"}, "photo": [{"file_id": "F", "file_unique_id": "u", "width": 1, "height": 1}]}}
        await dp.feed_update(bot, Update.model_validate({"update_id": 10 + i, "callback_query": cq}))
        edits = [c for c in CALLS if c[0] == "EditMessageMedia"]
        assert edits and CALLS[-1][0] == "AnswerCallbackQuery", CALLS[-3:]
    captions = [c[1]["media"]["caption"] for c in CALLS if c[0] == "EditMessageMedia"]
    assert "Как работает гарант" in captions[0] and "Сделок пока нет" in captions[1] and "Правила" in captions[2]

    before = len(CALLS)
    await dp.feed_update(bot, Update.model_validate({"update_id": 30, "message": msg("привет")}))
    assert CALLS[before][0] == "SendPhoto"
    await dp.feed_update(bot, Update.model_validate({"update_id": 31, "message": msg("/admin wrong-code")}))
    assert CALLS[-1][0] == "SendPhoto"
    from trusty import offers
    from trusty.models import Chat, Deal, DevProfile, User
    from trusty.db import Session
    async with Session() as s:
        s.add(User(id=43, first_name="Дев", username="dev"))
        await s.flush()
        s.add(DevProfile(user_id=43, title="Боты", categories=["bots"], stack=["Python"], about="x" * 60, moderation="published"))
        from trusty.models import Project
        pr = Project(client_id=42, title="Бот для записи", category="bots", text="x" * 40, budget_min=50, budget_max=80, days=5)
        chat = Chat(a_id=42, b_id=43)
        s.add_all([pr, chat])
        await s.flush()
        o = await offers.propose(s, chat, await s.get(User, 43), amount=60, days=5, as_role="dev", project_id=pr.id)
        await s.commit()
        oid = o.id
    cq = {"id": "77", "from": user(), "chat_instance": "x", "data": f"o:acc:{oid}",
          "message": {"message_id": 9, "date": 0, "chat": {"id": 42, "type": "private"}, "caption": "Дев предлагает 60 USDT",
                      "photo": [{"file_id": "F", "file_unique_id": "u", "width": 1, "height": 1}]}}
    await dp.feed_update(bot, Update.model_validate({"update_id": 40, "callback_query": cq}))
    edit = [c for c in CALLS if c[0] == "EditMessageCaption"][-1][1]
    assert "Принято" in edit["caption"] and "Дев предлагает" in edit["caption"], edit
    async with Session() as s:
        d = (await s.execute(__import__("sqlalchemy").select(Deal))).scalar_one()
        assert d.amount == 60 and d.client_id == 42 and d.dev_id == 43 and d.status == "awaiting_payment"
    cq["id"], cq["data"] = "78", f"o:dec:{oid}"
    await dp.feed_update(bot, Update.model_validate({"update_id": 41, "callback_query": cq}))
    answer = [c for c in CALLS if c[0] == "AnswerCallbackQuery"][-1][1]
    assert answer.get("show_alert") and "уже принят" in answer["text"], answer
    async with Session() as s:
        d = (await s.execute(__import__("sqlalchemy").select(Deal))).scalar_one()
        d.status = "done"
        await s.commit()
        did = d.id
    rq = {"id": "80", "from": user(), "chat_instance": "x", "data": f"r:{did}:4",
          "message": {"message_id": 11, "date": 0, "chat": {"id": 42, "type": "private"}, "text": "Сделка завершена. Оцените исполнителя"}}
    await dp.feed_update(bot, Update.model_validate({"update_id": 50, "callback_query": rq}))
    edit = [c for c in CALLS if c[0] == "EditMessageText"][-1][1]
    assert "★★★★☆" in edit["text"], edit
    from trusty.models import Review
    async with Session() as s:
        r = (await s.execute(__import__("sqlalchemy").select(Review))).scalar_one()
        assert r.rating == 4 and r.author_id == 42 and r.target_id == 43
    rq["id"] = "81"
    await dp.feed_update(bot, Update.model_validate({"update_id": 51, "callback_query": rq}))
    answer = [c for c in CALLS if c[0] == "AnswerCallbackQuery"][-1][1]
    assert answer.get("show_alert") and "уже" in answer["text"], answer
    from decimal import Decimal
    from trusty.models import Subscription
    async with Session() as s:
        sub = Subscription(user_id=42, method="stars", amount=Decimal(300), currency="XTR", days=30)
        s.add(sub)
        await s.commit()
        sid = sub.id
    pq = {"id": "pq1", "from": user(), "currency": "XTR", "total_amount": 300, "invoice_payload": f"pro:{sid}"}
    await dp.feed_update(bot, Update.model_validate({"update_id": 60, "pre_checkout_query": pq}))
    assert CALLS[-1][0] == "AnswerPreCheckoutQuery" and CALLS[-1][1]["ok"] is True, CALLS[-1]
    await dp.feed_update(bot, Update.model_validate({"update_id": 61, "pre_checkout_query": {**pq, "id": "pq2", "total_amount": 1}}))
    assert CALLS[-1][1]["ok"] is False and CALLS[-1][1]["error_message"], CALLS[-1]
    paid = {**msg("x"), "successful_payment": {"currency": "XTR", "total_amount": 300, "invoice_payload": f"pro:{sid}",
                                               "telegram_payment_charge_id": "tg-1", "provider_payment_charge_id": ""}}
    paid.pop("text")
    await dp.feed_update(bot, Update.model_validate({"update_id": 62, "message": paid}))
    async with Session() as s:
        assert (await s.get(User, 42)).pro() and (await s.get(Subscription, sid)).status == "paid"
    async def inline(query, uid):
        await dp.feed_update(bot, Update.model_validate({"update_id": uid, "inline_query": {"id": f"iq{uid}", "from": user(), "query": query, "offset": ""}}))
        name, kw = CALLS[-1]
        assert name == "AnswerInlineQuery" and kw["is_personal"], CALLS[-1]
        return kw
    kw = await inline("dev", 70)
    r = kw["results"][0]
    assert r["type"] == "photo" and r["photo_url"].startswith("https://trusty.example/api/share/dev/43.jpg?v=") and r["thumbnail_url"].endswith("&w=320"), r
    assert r["reply_markup"]["inline_keyboard"][0][0]["url"] == "https://t.me/itrustybot?start=dev_43" and "Дев" in r["caption"], r
    assert [x["id"] for x in (await inline("@dev", 71))["results"]] == ["dev43"]
    assert [x["id"] for x in (await inline("dev_43", 72))["results"]] == ["dev43"]
    assert [x["id"] for x in (await inline("python", 73))["results"]] == ["dev43"]
    kw = await inline("nobody_here", 74)
    assert kw["results"] == [] and "Никого" in kw["button"]["text"] and kw["button"]["web_app"]["url"].startswith("https://trusty.example/"), kw
    await check_setup()
    print("bot OK:", ", ".join(sorted({c[0] for c in CALLS})))
    await engine.dispose()


class SetupSession(FakeSession):
    def __init__(self, photos: int):
        super().__init__()
        self.photos = photos

    async def make_request(self, bot, method: TelegramMethod, timeout=None):
        name = type(method).__name__
        CALLS.append((name, method.model_dump(exclude_none=True)))
        answers = {
            "GetMe": {"id": 9, "is_bot": True, "first_name": "Bot", "username": "itrustybot",
                      "supports_inline_queries": False, "has_main_web_app": False},
            "GetMyName": {"name": "Old"}, "GetMyDescription": {"description": ""},
            "GetMyShortDescription": {"short_description": ""},
            "GetUserProfilePhotos": {"total_count": self.photos, "photos": []},
        }
        if name in answers:
            return method.__returning__.model_validate(answers[name])
        return True


async def check_setup():
    import contextlib
    import io
    import aiogram
    from trusty import cli
    real = aiogram.Bot
    for photos in (0, 1):
        CALLS.clear()
        aiogram.Bot = lambda token, _p=photos: real(token, session=SetupSession(_p))
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                code = await cli.main(["setup"])
        finally:
            aiogram.Bot = real
        names = [c[0] for c in CALLS]
        assert code == 0, out.getvalue()
        assert "SetMyName" not in names, names
        for m in ("SetMyDescription", "SetMyShortDescription", "SetChatMenuButton", "DeleteMyCommands"):
            assert m in names, (m, names)
        assert ("SetMyProfilePhoto" in names) == (photos == 0), names
        text = out.getvalue()
        assert "/setinline -> @itrustybot" in text and "Enable Mini App -> https://trusty.example" in text, text
    print(text)


if __name__ == "__main__":
    asyncio.run(main())
