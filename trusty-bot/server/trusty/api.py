"""HTTP API for the Mini App. All routes are under /api and require Telegram auth."""
import hashlib
import hmac
import os
import re
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import json
import logging

from . import cards, escrow, matching, notify, offers, presence, pro
from . import files as storage
from .auth import admin_user, current_user
from .config import settings
from .cryptopay import CryptoPayError, check_signature, pay
from .db import get_session
from .models import (Attachment, Bid, Chat, Complaint, Deal, DevProfile, Evidence, Invite, Message, Offer, Payment, Project,
                     User, utcnow)
from .serial import (aware, chat_payloads, complaint_payloads, deal_payloads, dev_payloads, member_payload,
                     project_payloads, short_date)

log = logging.getLogger("trusty.api")

router = APIRouter(prefix="/api")

CATEGORIES = {"bots": "Боты", "web": "Веб", "parsers": "Парсеры", "mobile": "Mobile", "web3": "Web3",
              "design": "Дизайн", "devops": "DevOps"}
REASONS = {"no_work", "vanished", "offsite_payment", "fraud", "other"}
OFFSITE = re.compile(r"(@[a-z0-9_]{4,}|t\.me/|в\s?лс|в\s?личк|напрямую|без\s+(гаранта|комисси)|на\s+карт|\+7\d|"
                     r"\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b)", re.I)


def bad(msg: str, code: int = 400):
    raise HTTPException(code, msg)


# ---------------------------------------------------------------- helpers
async def dev_rows(s: AsyncSession, where) -> list[tuple[DevProfile, User]]:
    q = select(DevProfile, User).join(User, User.id == DevProfile.user_id).where(where)
    return [(p, u) for p, u in (await s.execute(q)).all()]


async def get_or_create_chat(s: AsyncSession, x: int, y: int) -> Chat:
    a, b = sorted((x, y))
    c = (await s.execute(select(Chat).where(Chat.a_id == a, Chat.b_id == b))).scalar_one_or_none()
    if c is None:
        c = Chat(a_id=a, b_id=b)
        s.add(c)
        await s.flush()
    return c


async def my_chat(s: AsyncSession, chat_id: int, me: User) -> Chat:
    c = await s.get(Chat, chat_id)
    if c is None or me.id not in (c.a_id, c.b_id):
        bad("Чат не найден", 404)
    return c


async def admins(s: AsyncSession) -> list[User]:
    return list((await s.execute(select(User).where(User.is_admin.is_(True)))).scalars())


async def me_payload(s: AsyncSession, me: User) -> dict:
    p = await s.get(DevProfile, me.id)
    profile = (await dev_payloads(s, [(p, me)]))[0] if p else None
    return {"id": str(me.id), "name": me.name, "username": me.username, "role": me.role, "isAdmin": me.is_admin,
            "onboarded": me.onboarded, "pro": pro.info(me),
            "devForm": p.moderation if p else "none", "profile": profile,
            "moderationNote": p.moderation_note if p else None}


def ban_user(u: User) -> str:
    """First violation: 30 days. Any repeat: permanent."""
    permanent = u.strikes >= 1
    u.strikes += 1
    if permanent:
        u.ban_permanent, u.ban_until = True, None
        return "Повторное нарушение: бессрочная блокировка."
    u.ban_until = utcnow() + timedelta(days=30)
    return f"Первое нарушение: блокировка до {short_date(u.ban_until)}."


# ---------------------------------------------------------------- me / bootstrap
@router.get("/bootstrap")
async def bootstrap(me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    devs = await dev_payloads(s, await dev_rows(s, DevProfile.moderation == "published"))
    devs = [d for d in devs if not d["banned"]]
    my_bid_ids = select(Bid.project_id).where(Bid.dev_id == me.id)
    projects = (await s.execute(
        select(Project).where(or_(Project.status == "open", Project.client_id == me.id, Project.id.in_(my_bid_ids)))
        .order_by(desc(Project.created_at)).limit(300))).scalars().all()
    chats = (await s.execute(select(Chat).where(or_(Chat.a_id == me.id, Chat.b_id == me.id))
                             .order_by(desc(Chat.updated_at)).limit(100))).scalars().all()
    complaints = (await s.execute(select(Complaint).where(Complaint.from_id == me.id)
                                  .order_by(desc(Complaint.created_at)))).scalars().all()
    deals = (await s.execute(select(Deal).where(or_(Deal.client_id == me.id, Deal.dev_id == me.id))
                             .order_by(desc(Deal.created_at)).limit(100))).scalars().all()
    return {
        "deals": await deal_payloads(s, list(deals), me),
        "payments": {"enabled": pay.enabled, "asset": settings.asset, "feePercent": settings.fee_percent,
                     "reviewDays": settings.review_days},
        "me": await me_payload(s, me),
        "devs": devs,
        "projects": await project_payloads(s, list(projects), me),
        "chats": await chat_payloads(s, list(chats), me, skip_hidden=True),
        "myComplaints": await complaint_payloads(s, list(complaints), settings.secret),
        "admins": [{"name": a.name, "handle": a.username or ""} for a in await admins(s)],
    }


class MePatch(BaseModel):
    role: str | None = Field(default=None, pattern="^(client|dev)$")
    onboarded: bool | None = None
    alerts: bool | None = None  # Pro: new projects to the bot


@router.patch("/me")
async def patch_me(body: MePatch, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    if body.role:
        me.role = body.role
    if body.onboarded is not None:
        me.onboarded = body.onboarded
    if body.alerts is not None:
        me.alerts = body.alerts
    await s.commit()
    return await me_payload(s, me)


@router.get("/devs/{uid}")
async def get_dev(uid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    rows = await dev_rows(s, DevProfile.user_id == uid)
    if not rows or (rows[0][0].moderation != "published" and uid != me.id and not me.is_admin):
        bad("Разработчик не найден", 404)
    return (await dev_payloads(s, rows))[0]


class DevForm(BaseModel):
    categories: list[str] = Field(min_length=1, max_length=7)
    years: int = Field(ge=0, le=40)
    stack: list[str] = Field(min_length=2, max_length=25)
    rate: int = Field(gt=0, le=1000)
    status: str = Field(pattern="^(free|busy|away)$")
    about: str = Field(min_length=60, max_length=3000)
    github: str | None = Field(default=None, max_length=64)
    links: list[str] = Field(default_factory=list, max_length=10)


@router.put("/dev-profile")
async def put_profile(body: DevForm, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    cats = [c for c in body.categories if c in CATEGORIES]
    if not cats:
        bad("Выберите направление")
    stack = [x.strip()[:30] for x in body.stack if x.strip()][:25]
    p = await s.get(DevProfile, me.id) or DevProfile(user_id=me.id)
    p.categories, p.stack, p.years, p.rate, p.status = cats, stack, body.years, body.rate, body.status
    p.title = f"{', '.join(CATEGORIES[c] for c in cats)} · {', '.join(stack[:2])}"[:120]
    p.about = body.about.strip()
    p.github = (body.github or "").strip().lstrip("@").removeprefix("https://github.com/").strip("/")[:64] or None
    p.links = [x.strip()[:200] for x in body.links if x.strip().startswith(("http://", "https://", "t.me/"))][:10]
    p.portfolio = [{"title": x.split("//", 1)[-1][:80], "text": x} for x in p.links[:5]]
    p.moderation, p.moderation_note = "review", None
    s.add(p)
    me.role = "dev"
    await s.commit()
    for a in await admins(s):
        notify.send(a.id, f"Новая анкета разработчика на проверку: {me.name}.", "Открыть админку", screen="admin")
    return await me_payload(s, me)


# ---------------------------------------------------------------- projects and bids
class ProjectIn(BaseModel):
    title: str = Field(min_length=8, max_length=120)
    category: str
    text: str = Field(min_length=40, max_length=5000)
    budgetMin: int = Field(gt=0, le=1_000_000)
    budgetMax: int = Field(gt=0, le=1_000_000)
    days: int = Field(gt=0, le=365)
    stack: list[str] = Field(default_factory=list, max_length=15)
    files: list[str] = Field(default_factory=list, max_length=10)


@router.post("/projects")
async def create_project(body: ProjectIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    if body.category not in CATEGORIES:
        bad("Неизвестное направление")
    if body.budgetMax < body.budgetMin:
        bad("Бюджет «до» меньше, чем «от»")
    p = Project(client_id=me.id, title=body.title.strip(), category=body.category, text=body.text.strip(),
                budget_min=body.budgetMin, budget_max=body.budgetMax, days=body.days,
                stack=[x[:30] for x in body.stack], files=[{"name": f[:120], "size": "—"} for f in body.files])
    s.add(p)
    await s.commit()
    try:  # picks for the client and instant alerts for Pro executors; never fails the publishing itself
        await matching.after_publish(s, p)
    except Exception as e:  # noqa: BLE001
        log.warning("after publish %s: %s", p.id, e)
    return (await project_payloads(s, [p], me))[0]


@router.get("/projects/{pid}")
async def get_project(pid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    p = await s.get(Project, pid)
    if p is None:
        bad("Проект не найден", 404)
    return (await project_payloads(s, [p], me))[0]


class BidIn(BaseModel):
    price: int = Field(gt=0, le=1_000_000)
    days: int = Field(gt=0, le=365)
    text: str = Field(min_length=20, max_length=3000)


@router.post("/projects/{pid}/bids")
async def bid(pid: int, body: BidIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    p = await s.get(Project, pid)
    if p is None or p.status != "open":
        bad("Проект уже не принимает отклики")
    if p.client_id == me.id:
        bad("Нельзя откликнуться на свой проект")
    prof = await s.get(DevProfile, me.id)
    if prof is None or prof.moderation != "published":
        bad("Откликаться могут разработчики с проверенной анкетой", 403)
    b = (await s.execute(select(Bid).where(Bid.project_id == pid, Bid.dev_id == me.id))).scalar_one_or_none()
    fresh = b is None
    b = b or Bid(project_id=pid, dev_id=me.id)
    b.price, b.days, b.text, b.created_at = body.price, body.days, body.text.strip(), utcnow()
    s.add(b)
    await s.commit()
    if fresh:
        notify.send(p.client_id, f"Новый отклик на «{p.title}»: {body.price} USDT, {body.days} дн. от {me.name}.",
                    "Посмотреть отклик", screen="project", id=p.id)
    return (await project_payloads(s, [p], me))[0]


class ChooseIn(BaseModel):
    devId: int


@router.post("/projects/{pid}/choose")
async def choose(pid: int, body: ChooseIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    p = await s.get(Project, pid)
    if p is None or p.client_id != me.id:
        bad("Проект не найден", 404)
    if p.status != "open":
        bad("Исполнитель уже выбран")
    b = (await s.execute(select(Bid).where(Bid.project_id == pid, Bid.dev_id == body.devId))).scalar_one_or_none()
    if b is None:
        bad("Отклик не найден", 404)
    dev = await s.get(User, b.dev_id)
    if dev is None or dev.banned():
        bad("Разработчик заблокирован")
    done = (await dev_payloads(s, await dev_rows(s, DevProfile.user_id == dev.id)))[0]["deals"]
    if done < 3 and b.price > settings.new_dev_limit:
        bad(f"У нового исполнителя сумма сделки ограничена {settings.new_dev_limit} USDT, пока нет трёх успешных сделок")
    d = await escrow.open_deal(s, me.id, dev.id, p.title, b.price, b.days, p.id, CATEGORIES.get(p.category, ""))
    c = await get_or_create_chat(s, me.id, dev.id)
    await s.commit()
    notify.send_deal(dev.id, d, f"Вас выбрали исполнителем: «{p.title}», {d.amount} {settings.asset}. "
                                f"Начинайте после оплаты: мы пришлём уведомление.")
    return {"chatId": str(c.id), "dealId": d.id}


# ---------------------------------------------------------------- chats
@router.get("/chats")
async def list_chats(me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    chats = (await s.execute(select(Chat).where(or_(Chat.a_id == me.id, Chat.b_id == me.id))
                             .order_by(desc(Chat.updated_at)).limit(100))).scalars().all()
    return await chat_payloads(s, list(chats), me, skip_hidden=True)


@router.post("/chats/{cid}/delete")
async def delete_chat(cid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Removes the chat from my list and hides its history from me. The other side keeps it, and the messages stay
    on the server for the arbiter. A new message brings the chat back."""
    c = await my_chat(s, cid, me)
    last = (await s.execute(select(Message.id).where(Message.chat_id == c.id).order_by(desc(Message.id)).limit(1))).scalar() or 0
    if c.a_id == me.id:
        c.a_hidden, c.a_read = last, max(c.a_read, last)
    else:
        c.b_hidden, c.b_read = last, max(c.b_read, last)
    await s.commit()
    return {"ok": True}


class OpenChat(BaseModel):
    userId: int


@router.post("/chats/open")
async def open_chat(body: OpenChat, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    if body.userId == me.id:
        bad("Это вы")
    peer = await s.get(User, body.userId)
    if peer is None:
        bad("Пользователь не найден", 404)
    c = await get_or_create_chat(s, me.id, peer.id)
    await s.commit()
    return (await chat_payloads(s, [c], me, full=True))[0]


@router.get("/chats/{cid}")
async def get_chat(cid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await my_chat(s, cid, me)
    return (await chat_payloads(s, [c], me, full=True))[0]


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/chats/{cid}/messages")
async def post_message(cid: int, body: MessageIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await my_chat(s, cid, me)
    flagged = bool(OFFSITE.search(body.text))
    m = Message(chat_id=c.id, sender_id=me.id, text=body.text.strip(), flagged=flagged)
    s.add(m)
    if flagged:
        warned = (await s.execute(select(Message.id).where(Message.chat_id == c.id, Message.sender_id.is_(None),
                                                           Message.text.like("Внимание:%")).limit(1))).first()
        if not warned:
            s.add(Message(chat_id=c.id, sender_id=None,
                          text="Внимание: договорённости и оплата вне IT Trusty не защищены гарантом."))
    await _delivered(s, c, me, m, body.text)
    await s.commit()
    return (await chat_payloads(s, [c], me, full=True))[0]


async def _delivered(s: AsyncSession, c: Chat, me: User, m: Message, preview: str) -> None:
    """After my message: it is read by me, and the peer gets a bot notice if they are away (at most every 10 min)."""
    now = utcnow()
    c.updated_at = now
    await s.flush()
    if c.a_id == me.id:
        c.a_read = m.id
    else:
        c.b_read = m.id
    peer = await s.get(User, c.b_id if c.a_id == me.id else c.a_id)
    last_note = aware(c.b_notified_at if c.a_id == me.id else c.a_notified_at)
    away = peer is not None and now - aware(peer.last_seen_at) > timedelta(minutes=2)
    if peer and away and (last_note is None or now - last_note > timedelta(minutes=10)):
        if c.a_id == me.id:
            c.b_notified_at = now
        else:
            c.a_notified_at = now
        notify.send(peer.id, f"Новое сообщение от {me.name}: {preview[:120]}", "Ответить", screen="chat", id=c.id)


@router.post("/chats/{cid}/files")
async def send_files(cid: int, text: str = Form(default=""), files: list[UploadFile] = File(...),
                     me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Screenshots, archives and documents in a chat, with an optional caption (e.g. when handing over work)."""
    c = await my_chat(s, cid, me)
    if not 1 <= len(files) <= 10:
        bad("Можно прикрепить от 1 до 10 файлов")
    text = text.strip()[:4000]
    m = Message(chat_id=c.id, sender_id=me.id, text=text, flagged=bool(text and OFFSITE.search(text)))
    s.add(m)
    await s.flush()
    names = []
    for f in files:
        path, name, mime, size = await storage.save_attachment(f, c.id)
        s.add(Attachment(message_id=m.id, chat_id=c.id, path=path, name=name, mime=mime, size=size))
        names.append(name)
    await _delivered(s, c, me, m, text or "файлы: " + ", ".join(names))
    await s.commit()
    return (await chat_payloads(s, [c], me, full=True))[0]


@router.get("/f/a/{aid}", include_in_schema=False)
async def get_attachment(aid: int, sig: str, s: AsyncSession = Depends(get_session)):
    storage.check("a", aid, sig)
    a = await s.get(Attachment, aid)
    if a is None or not os.path.exists(a.path):
        bad("Файл не найден", 404)
    return FileResponse(a.path, media_type=a.mime, filename=a.name,
                        content_disposition_type="inline" if a.mime in storage.IMAGES else "attachment",
                        headers={"Cache-Control": "private, max-age=86400"})


@router.get("/f/p/{ident}", include_in_schema=False)
async def get_picture(ident: str, sig: str):
    storage.check("p", ident, sig)
    path = storage.picture_path(ident)
    if not os.path.exists(path):
        bad("Картинка не найдена", 404)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})


# ---------------------------------------------------------------- portfolio
@router.post("/portfolio/image")
async def portfolio_image(file: UploadFile = File(...), me: User = Depends(current_user)):
    ident = await storage.save_picture(file, me.id)
    return {"imageId": ident, "url": storage.link("p", ident)}


class Work(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    text: str = Field(default="", max_length=300)
    url: str | None = Field(default=None, max_length=300)
    imageId: str | None = Field(default=None, max_length=40)


class PortfolioIn(BaseModel):
    items: list[Work] = Field(default_factory=list, max_length=12)


@router.put("/portfolio")
async def put_portfolio(body: PortfolioIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Works with a picture and a link to the live project; saved at once, without a new moderation."""
    p = await s.get(DevProfile, me.id)
    if p is None:
        bad("Сначала заполните анкету исполнителя")
    items = []
    for w in body.items:
        url = (w.url or "").strip()
        if url and not url.startswith(("https://", "http://", "t.me/")):
            bad(f"Ссылка в работе «{w.title}» должна начинаться с https://")
        if w.imageId and not w.imageId.startswith(f"{me.id}-"):
            bad("Картинка не найдена")
        items.append({"title": w.title.strip(), "text": w.text.strip(), "url": url or None, "image": w.imageId or None})
    p.portfolio = items
    await s.commit()
    return await me_payload(s, me)


# ---------------------------------------------------------------- invitations and picks
class InviteIn(BaseModel):
    devId: int


@router.post("/projects/{pid}/invite")
async def invite(pid: int, body: InviteIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    p = await s.get(Project, pid)
    if p is None or p.client_id != me.id:
        bad("Проект не найден", 404)
    if p.status != "open":
        bad("По этому проекту исполнитель уже выбран")
    prof, dev = await s.get(DevProfile, body.devId), await s.get(User, body.devId)
    if prof is None or dev is None or prof.moderation != "published" or dev.banned():
        bad("Пригласить можно исполнителя с одобренной анкетой")
    if (await s.execute(select(Invite).where(Invite.project_id == pid, Invite.dev_id == dev.id))).scalar_one_or_none():
        bad("Вы уже пригласили этого исполнителя в проект")
    s.add(Invite(project_id=pid, dev_id=dev.id))
    await s.commit()
    notify.send_project(dev.id, p, f"{me.name} приглашает вас в проект. Откликнитесь со своей ценой:", "ПРИГЛАШЕНИЕ")
    return (await project_payloads(s, [p], me))[0]


@router.get("/projects/{pid}/matches")
async def project_matches(pid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    p = await s.get(Project, pid)
    if p is None or p.client_id != me.id:
        bad("Проект не найден", 404)
    return await matching.matches(s, p, 8)


# ---------------------------------------------------------------- IT Trusty Pro
class PlanIn(BaseModel):
    plan: str = Field(default="1m", pattern="^(1m|3m)$")


@router.get("/pro")
async def pro_info(me: User = Depends(current_user)):
    return pro.info(me)


@router.post("/pro/stars")
async def pro_stars(body: PlanIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return {"url": await _run(s, pro.stars_link(s, me, body.plan))}


@router.post("/pro/crypto")
async def pro_crypto(body: PlanIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return {"url": await _run(s, pro.crypto_invoice(s, me, body.plan))}


@router.post("/pro/check")
async def pro_check(me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Called when the user comes back from paying: picks up a USDT payment before the webhook."""
    try:
        await pro.sync_crypto(s)
    except CryptoPayError as e:
        log.warning("pro check: %s", e)
    await s.refresh(me)
    return pro.info(me)


# ---------------------------------------------------------------- public card for sharing
async def _public_dev(s: AsyncSession, uid: int) -> dict:
    rows = await dev_rows(s, DevProfile.user_id == uid)
    if not rows or rows[0][0].moderation != "published" or rows[0][1].banned():
        raise HTTPException(404, "Профиль не найден")
    return (await dev_payloads(s, rows))[0]


@router.get("/share/dev/{uid}.jpg", include_in_schema=False)
async def share_card(uid: int, s: AsyncSession = Depends(get_session)):
    d = await _public_dev(s, uid)
    from .serial import LEVELS
    img = cards.dev_card(d["name"], d["title"], LEVELS[d["level"]], d["rating"], d["deals"], d["onTime"], d["stack"], d["pro"],
                         settings.bot_username)
    return Response(img, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/u/{uid}", include_in_schema=False)
async def share_page(uid: int, s: AsyncSession = Depends(get_session)):
    """A link that shows the executor's card as a preview in Telegram and other apps, then opens the bot."""
    from html import escape
    d = await _public_dev(s, uid)
    bot_link = f"https://t.me/{settings.bot_username}?start=dev_{uid}"
    stats = f"{d['rating']:.1f} ★ · {d['deals']} сделок · " if d["deals"] else ""
    desc = escape(f"{stats}{', '.join(d['stack'][:4])}. Сделка через гаранта IT Trusty: оплата в USDT после приёмки работы.")
    title = escape(f"{d['name']} — исполнитель IT Trusty")
    img = f"{settings.public_url}/api/share/dev/{uid}.jpg"
    return HTMLResponse(f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>{title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><meta property="og:type" content="profile">
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}">
<meta property="og:image" content="{img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url={bot_link}"></head>
<body style="background:#000;color:#fff;font-family:system-ui;text-align:center;padding:40px">
<p>{title}</p><p><a style="color:#4fb98c" href="{bot_link}">Открыть в Telegram</a></p></body></html>""")


@router.post("/chats/{cid}/typing")
async def typing(cid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await my_chat(s, cid, me)
    presence.typed(c.id, me.id)
    return {"ok": True}


class OfferIn(BaseModel):
    projectId: int  # the client's open project the offer is about
    amount: int = Field(gt=0, le=1_000_000)
    days: int = Field(gt=0, le=365)
    ttlHours: int = Field(default=48, ge=1, le=72)
    asRole: str | None = Field(default=None, pattern="^(client|dev)$")


class CounterIn(BaseModel):
    amount: int = Field(gt=0, le=1_000_000)
    days: int = Field(gt=0, le=365)
    ttlHours: int = Field(default=48, ge=1, le=72)


async def _offer_chat(s: AsyncSession, offer_id: int, me: User) -> Chat:
    o = await s.get(Offer, offer_id)
    if o is None or me.id not in (o.from_id, o.to_id):
        bad("Оффер не найден", 404)
    return await s.get(Chat, o.chat_id)


async def _chat_out(s: AsyncSession, c: Chat, me: User) -> dict:
    await s.refresh(c)
    return (await chat_payloads(s, [c], me, full=True))[0]


@router.post("/chats/{cid}/offers")
async def create_offer(cid: int, body: OfferIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await my_chat(s, cid, me)
    await _run(s, offers.propose(s, c, me, amount=body.amount, days=body.days, ttl_hours=body.ttlHours,
                                 as_role=body.asRole, project_id=body.projectId))
    await s.commit()
    return await _chat_out(s, c, me)


@router.post("/offers/{oid}/counter")
async def counter_offer(oid: int, body: CounterIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await _offer_chat(s, oid, me)
    await _run(s, offers.counter(s, oid, me, body.amount, body.days, body.ttlHours))
    await s.commit()
    return await _chat_out(s, c, me)


@router.post("/offers/{oid}/accept")
async def accept_offer(oid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await _offer_chat(s, oid, me)
    _, d = await _run(s, offers.accept(s, oid, me))
    await s.commit()
    return {"chat": await _chat_out(s, c, me), "deal": (await deal_payloads(s, [d], me))[0]}


@router.post("/offers/{oid}/decline")
async def decline_offer(oid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await _offer_chat(s, oid, me)
    await _run(s, offers.decline(s, oid, me))
    await s.commit()
    return await _chat_out(s, c, me)


@router.post("/offers/{oid}/withdraw")
async def withdraw_offer(oid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await _offer_chat(s, oid, me)
    await _run(s, offers.withdraw(s, oid, me))
    await s.commit()
    return await _chat_out(s, c, me)


@router.post("/chats/{cid}/read")
async def read_chat(cid: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    c = await my_chat(s, cid, me)
    last = (await s.execute(select(Message.id).where(Message.chat_id == c.id).order_by(desc(Message.id)).limit(1))).scalar()
    if last:
        if c.a_id == me.id:
            c.a_read = last
        else:
            c.b_read = last
        await s.commit()
    return {"ok": True}


# ---------------------------------------------------------------- complaints and evidence
@router.post("/complaints")
async def create_complaint(against: int = Form(...), reason: str = Form(...), text: str = Form(...),
                           deal: int | None = Form(default=None), files: list[UploadFile] = File(default=[]),
                           me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    if reason not in REASONS:
        bad("Неизвестная причина")
    if not 20 <= len(text.strip()) <= 4000:
        bad("Опишите ситуацию подробнее")
    if against == me.id or await s.get(User, against) is None:
        bad("Пользователь не найден", 404)
    if not 1 <= len(files) <= 6:
        bad("Приложите от 1 до 6 скриншотов")
    c = Complaint(from_id=me.id, against_id=against, deal_id=deal, reason=reason, text=text.strip())
    s.add(c)
    await s.flush()
    folder = os.path.join(settings.upload_dir, "complaints", str(c.id))
    os.makedirs(folder, exist_ok=True)
    for i, f in enumerate(files):
        mime = (f.content_type or "").lower()
        if mime not in ("image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"):
            bad("Доказательства принимаются картинками: JPG, PNG, WEBP")
        data = await f.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            bad("Файл больше 8 МБ")
        path = os.path.join(folder, f"{i + 1}.{mime.split('/')[1]}")
        with open(path, "wb") as fh:
            fh.write(data)
        s.add(Evidence(complaint_id=c.id, path=path, mime=mime))
    await s.commit()
    for a in await admins(s):
        notify.send(a.id, f"Новая жалоба #{c.id} от {me.name}.", "Открыть жалобу", screen="complaint-admin", id=c.id)
    return (await complaint_payloads(s, [c], settings.secret))[0]


@router.get("/files/{eid}")
async def get_file(eid: int, sig: str, s: AsyncSession = Depends(get_session)):
    expected = hmac.new(settings.secret, str(eid).encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(expected, sig):
        bad("Нет доступа", 403)
    e = await s.get(Evidence, eid)
    if e is None or not os.path.exists(e.path):
        bad("Файл не найден", 404)
    return FileResponse(e.path, media_type=e.mime, headers={"Cache-Control": "private, max-age=86400"})


# ---------------------------------------------------------------- admin
admin = APIRouter(prefix="/api/admin")


@admin.get("/overview")
async def overview(me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    users = (await s.execute(select(User).order_by(desc(User.last_seen_at)).limit(1000))).scalars().all()
    dev_ids = set((await s.execute(select(DevProfile.user_id))).scalars())
    complaints = (await s.execute(select(Complaint).order_by(desc(Complaint.created_at)).limit(300))).scalars().all()
    pending = await dev_rows(s, DevProfile.moderation == "review")
    return {
        "members": [member_payload(u, u.id in dev_ids) for u in users],
        "complaints": await complaint_payloads(s, list(complaints), settings.secret),
        "profiles": await dev_payloads(s, pending),
        "admins": [{"name": a.name, "handle": a.username or ""} for a in await admins(s)],
    }


async def _complaint(s: AsyncSession, cid: int) -> Complaint:
    c = await s.get(Complaint, cid)
    if c is None:
        bad("Жалоба не найдена", 404)
    return c


@admin.post("/complaints/{cid}/take")
async def take(cid: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    c = await _complaint(s, cid)
    if c.status == "new":
        c.status, c.handled_by = "review", me.id
        await s.commit()
    return (await complaint_payloads(s, [c], settings.secret))[0]


@admin.post("/complaints/{cid}/reject")
async def reject(cid: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    c = await _complaint(s, cid)
    c.status, c.handled_by, c.decision = "rejected", me.id, "Нарушение не подтвердилось."
    await s.commit()
    notify.send(c.from_id, f"Жалоба #{c.id} рассмотрена: нарушение не подтвердилось.")
    return (await complaint_payloads(s, [c], settings.secret))[0]


@admin.post("/complaints/{cid}/ban")
async def ban_by_complaint(cid: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    c = await _complaint(s, cid)
    u = await s.get(User, c.against_id)
    if u is None or u.is_admin:
        bad("Администратора заблокировать нельзя")
    decision = ban_user(u)
    c.status, c.handled_by, c.decision = "resolved", me.id, decision
    await s.commit()
    notify.send(c.from_id, f"Жалоба #{c.id} рассмотрена. {decision}")
    notify.send(u.id, f"Ваш аккаунт в IT Trusty заблокирован по жалобе #{c.id}. {decision}")
    return {"complaint": (await complaint_payloads(s, [c], settings.secret))[0], "message": decision}


@admin.post("/users/{uid}/ban")
async def ban(uid: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    u = await s.get(User, uid)
    if u is None or u.is_admin:
        bad("Администратора заблокировать нельзя")
    decision = ban_user(u)
    await s.commit()
    notify.send(u.id, f"Ваш аккаунт в IT Trusty заблокирован. {decision}")
    return {"member": member_payload(u, await s.get(DevProfile, u.id) is not None), "message": decision}


@admin.post("/users/{uid}/unban")
async def unban(uid: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    u = await s.get(User, uid)
    if u is None:
        bad("Пользователь не найден", 404)
    u.ban_permanent, u.ban_until = False, None
    await s.commit()
    notify.send(u.id, "Блокировка аккаунта в IT Trusty снята.")
    return {"member": member_payload(u, await s.get(DevProfile, u.id) is not None)}


class Moderation(BaseModel):
    note: str | None = Field(default=None, max_length=500)


@admin.post("/profiles/{uid}/approve")
async def approve(uid: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    p = await s.get(DevProfile, uid)
    if p is None:
        bad("Анкета не найдена", 404)
    p.moderation, p.moderation_note = "published", None
    await s.commit()
    notify.send(uid, "Анкета проверена: ваш профиль опубликован в каталоге IT Trusty.", "Открыть профиль", screen="dev", id=uid)
    return {"ok": True}


@admin.post("/profiles/{uid}/reject")
async def reject_profile(uid: int, body: Moderation, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    p = await s.get(DevProfile, uid)
    if p is None:
        bad("Анкета не найдена", 404)
    p.moderation, p.moderation_note = "rejected", body.note
    await s.commit()
    notify.send(uid, f"Анкета не прошла проверку.{(' ' + body.note) if body.note else ''} Исправьте её в профиле.",
                "Открыть анкету", screen="dev-form")
    return {"ok": True}


# ---------------------------------------------------------------- deals and escrow
async def _deal_for(s: AsyncSession, deal_id: int, me: User) -> Deal:
    d = await s.get(Deal, deal_id)
    if d is None or (me.id not in (d.client_id, d.dev_id) and not me.is_admin):
        bad("Сделка не найдена", 404)
    return d


async def _deal_out(s: AsyncSession, deal_id: int, me: User) -> dict:
    d = await _deal_for(s, deal_id, me)
    await s.refresh(d)
    return (await deal_payloads(s, [d], me))[0]


async def _run(s: AsyncSession, fn):
    try:
        return await fn
    except escrow.EscrowError as e:
        await s.rollback()
        bad(str(e))
    except CryptoPayError as e:
        await s.rollback()
        log.error("crypto pay: %s", e)
        bad("Платёжный сервис не ответил, попробуйте ещё раз через минуту", 502)


@router.get("/deals")
async def list_deals(me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    deals = (await s.execute(select(Deal).where(or_(Deal.client_id == me.id, Deal.dev_id == me.id))
                             .order_by(desc(Deal.created_at)).limit(100))).scalars().all()
    return await deal_payloads(s, list(deals), me)


@router.get("/deals/{deal_id}")
async def get_deal(deal_id: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return await _deal_out(s, deal_id, me)


@router.post("/deals/{deal_id}/pay")
async def pay_deal(deal_id: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _deal_for(s, deal_id, me)
    return await _run(s, escrow.invoice_for(s, deal_id, me))


@router.post("/deals/{deal_id}/check")
async def check_deal(deal_id: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Called when the user comes back from @CryptoBot: picks up a payment even before the webhook."""
    d = await _deal_for(s, deal_id, me)
    if d.status == "awaiting_payment" and d.invoice_id and pay.enabled:
        try:
            found = await pay.get_invoices([d.invoice_id])
            if found and found[0]["status"] == "paid":
                await escrow.handle_paid_invoice(s, found[0])
        except CryptoPayError as e:
            log.warning("check deal %s: %s", deal_id, e)
    return await _deal_out(s, deal_id, me)


class NoteIn(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.post("/deals/{deal_id}/submit")
async def submit_deal(deal_id: int, body: NoteIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _run(s, escrow.submit(s, deal_id, me, body.note))
    return await _deal_out(s, deal_id, me)


@router.post("/deals/{deal_id}/accept")
async def accept_deal(deal_id: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _run(s, escrow.accept(s, deal_id, me))
    return await _deal_out(s, deal_id, me)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=10, max_length=1000)


@router.post("/deals/{deal_id}/dispute")
async def dispute_deal(deal_id: int, body: ReasonIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _run(s, escrow.dispute(s, deal_id, me, body.reason))
    return await _deal_out(s, deal_id, me)


@router.post("/deals/{deal_id}/cancel")
async def cancel_deal(deal_id: int, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _run(s, escrow.cancel(s, deal_id, me))
    return await _deal_out(s, deal_id, me)


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str = Field(default="", max_length=1000)


@router.post("/deals/{deal_id}/review")
async def review_deal(deal_id: int, body: ReviewIn, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _run(s, escrow.review(s, deal_id, me, body.rating, body.text))
    return await _deal_out(s, deal_id, me)


class ResolveIn(BaseModel):
    devShare: int = Field(ge=0, le=100)
    note: str = Field(default="", max_length=1000)


@admin.post("/deals/{deal_id}/resolve")
async def resolve_deal(deal_id: int, body: ResolveIn, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    await _run(s, escrow.resolve(s, deal_id, me, body.devShare, body.note))
    return await _deal_out(s, deal_id, me)


@admin.get("/finance")
async def finance(me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    balance, error = [], None
    if pay.enabled:
        try:
            balance = [{"asset": b["currency_code"], "available": b["available"], "onhold": b.get("onhold", "0")}
                       for b in await pay.get_balance() if b["currency_code"] in (settings.asset, "TON") or float(b["available"])]
        except CryptoPayError as e:
            error = str(e)
    payments = (await s.execute(select(Payment).order_by(desc(Payment.id)).limit(60))).scalars().all()
    disputes = (await s.execute(select(Deal).where(Deal.status == "dispute").order_by(Deal.created_at))).scalars().all()
    held = (await s.execute(select(Deal).where(Deal.status.in_(("in_work", "review", "dispute"))))).scalars().all()
    users = {u.id: u for u in (await s.execute(select(User).where(User.id.in_({p.user_id for p in payments} or {0})))).scalars()}
    return {
        "enabled": pay.enabled, "asset": settings.asset, "feePercent": settings.fee_percent, "balance": balance, "error": error,
        "held": str(sum((d.total for d in held), start=escrow.Decimal(0))),
        "disputes": await deal_payloads(s, list(disputes), me),
        "payments": [{"id": p.id, "dealId": p.deal_id, "kind": p.kind, "amount": str(p.amount), "status": p.status,
                      "user": users[p.user_id].name if p.user_id in users else str(p.user_id), "error": p.error,
                      "attempts": p.attempts, "at": aware(p.updated_at).isoformat()} for p in payments],
    }


@admin.post("/payments/{payment_id}/retry")
async def retry_payment(payment_id: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    p = await s.get(Payment, payment_id)
    if p is None or p.kind == "invoice" or p.status in ("sent", "check"):
        bad("Повторять нечего")
    d = await s.get(Deal, p.deal_id)
    p = await _run(s, escrow.payout(s, d, p.user_id, p.amount, p.kind, f"IT Trusty, сделка #{d.id}"))
    return {"status": p.status, "error": p.error}


@router.post("/cryptopay/webhook", include_in_schema=False)
async def cryptopay_webhook(request: Request, s: AsyncSession = Depends(get_session)):
    """Crypto Pay update (invoice_paid). Authenticated by the HMAC signature, not by Telegram."""
    raw = await request.body()
    if not check_signature(raw, request.headers.get("crypto-pay-api-signature", "")):
        raise HTTPException(401, "bad signature")
    try:
        update = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "bad json") from None
    if update.get("update_type") == "invoice_paid" and isinstance(update.get("payload"), dict):
        inv = update["payload"]
        if str(inv.get("payload") or "").startswith("pro:"):
            await pro.handle_crypto(s, inv)
        else:
            await escrow.handle_paid_invoice(s, inv)
    return PlainTextResponse("ok")


__all__ = ["router", "admin"]
