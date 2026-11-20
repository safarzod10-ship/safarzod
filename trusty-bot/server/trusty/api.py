"""HTTP API for the Mini App. All routes are under /api and require Telegram auth."""
import hashlib
import hmac
import os
import re
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import notify
from .auth import admin_user, current_user
from .config import settings
from .db import get_session
from .models import Bid, Chat, Complaint, Deal, DevProfile, Evidence, Message, Project, User, utcnow
from .serial import (aware, chat_payloads, complaint_payloads, dev_payloads, member_payload, project_payloads,
                     short_date)

router = APIRouter(prefix="/api")

CATEGORIES = {"bots": "Боты", "web": "Веб", "parsers": "Парсеры", "mobile": "Mobile", "web3": "Web3",
              "design": "Дизайн", "devops": "DevOps"}
REASONS = {"no_work", "vanished", "offsite_payment", "fraud", "other"}
OFFSITE = re.compile(r"(@[a-z0-9_]{4,}|t\.me/|в\s?лс|в\s?личк|напрямую|без\s+(гаранта|комисси)|на\s+карт|\+7\d|"
                     r"\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b)", re.I)
NEW_DEV_LIMIT = 100


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
    return {
        "me": await me_payload(s, me),
        "devs": devs,
        "projects": await project_payloads(s, list(projects), me),
        "chats": await chat_payloads(s, list(chats), me),
        "myComplaints": await complaint_payloads(s, list(complaints), settings.secret),
        "admins": [{"name": a.name, "handle": a.username or ""} for a in await admins(s)],
    }


class MePatch(BaseModel):
    role: str = Field(pattern="^(client|dev)$")


@router.patch("/me")
async def patch_me(body: MePatch, me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    me.role = body.role
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
    if done < 3 and b.price > NEW_DEV_LIMIT:
        bad(f"У нового разработчика сумма сделки ограничена {NEW_DEV_LIMIT} USDT, пока нет трёх успешных сделок")
    d = Deal(project_id=p.id, client_id=me.id, dev_id=dev.id, title=p.title, category=CATEGORIES.get(p.category, ""),
             amount=b.price, days=b.days, due_at=utcnow() + timedelta(days=b.days))
    s.add(d)
    p.status = "in_work"
    await s.flush()
    c = await get_or_create_chat(s, me.id, dev.id)
    c.deal_id, c.updated_at = d.id, utcnow()
    s.add(Message(chat_id=c.id, sender_id=None,
                  text=f"Сделка #{d.id} создана. Условия зафиксированы: {d.amount} USDT, срок {d.days} дн. "
                       f"Ожидаем оплату от заказчика."))
    await s.commit()
    notify.send(dev.id, f"Вас выбрали исполнителем: «{p.title}», {d.amount} USDT. Сделка #{d.id}.",
                "Открыть чат сделки", screen="chat", id=c.id)
    return {"chatId": str(c.id), "dealId": d.id}


# ---------------------------------------------------------------- chats
@router.get("/chats")
async def list_chats(me: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    chats = (await s.execute(select(Chat).where(or_(Chat.a_id == me.id, Chat.b_id == me.id))
                             .order_by(desc(Chat.updated_at)).limit(100))).scalars().all()
    return await chat_payloads(s, list(chats), me)


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
    peer_id = c.b_id if c.a_id == me.id else c.a_id
    flagged = bool(OFFSITE.search(body.text))
    m = Message(chat_id=c.id, sender_id=me.id, text=body.text.strip(), flagged=flagged)
    s.add(m)
    if flagged:
        warned = (await s.execute(select(Message.id).where(Message.chat_id == c.id, Message.sender_id.is_(None),
                                                           Message.text.like("Внимание:%")).limit(1))).first()
        if not warned:
            s.add(Message(chat_id=c.id, sender_id=None,
                          text="Внимание: договорённости и оплата вне Trusty не защищены гарантом."))
    now = utcnow()
    c.updated_at = now
    await s.flush()
    if c.a_id == me.id:
        c.a_read = m.id
    else:
        c.b_read = m.id
    peer = await s.get(User, peer_id)
    last_note = aware(c.b_notified_at if c.a_id == me.id else c.a_notified_at)
    away = peer is not None and now - aware(peer.last_seen_at) > timedelta(minutes=2)
    if peer and away and (last_note is None or now - last_note > timedelta(minutes=10)):
        if c.a_id == me.id:
            c.b_notified_at = now
        else:
            c.a_notified_at = now
        notify.send(peer.id, f"Новое сообщение от {me.name}: {body.text[:120]}", "Ответить", screen="chat", id=c.id)
    await s.commit()
    return (await chat_payloads(s, [c], me, full=True))[0]


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
    notify.send(u.id, f"Ваш аккаунт в Trusty заблокирован по жалобе #{c.id}. {decision}")
    return {"complaint": (await complaint_payloads(s, [c], settings.secret))[0], "message": decision}


@admin.post("/users/{uid}/ban")
async def ban(uid: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    u = await s.get(User, uid)
    if u is None or u.is_admin:
        bad("Администратора заблокировать нельзя")
    decision = ban_user(u)
    await s.commit()
    notify.send(u.id, f"Ваш аккаунт в Trusty заблокирован. {decision}")
    return {"member": member_payload(u, await s.get(DevProfile, u.id) is not None), "message": decision}


@admin.post("/users/{uid}/unban")
async def unban(uid: int, me: User = Depends(admin_user), s: AsyncSession = Depends(get_session)):
    u = await s.get(User, uid)
    if u is None:
        bad("Пользователь не найден", 404)
    u.ban_permanent, u.ban_until = False, None
    await s.commit()
    notify.send(u.id, "Блокировка аккаунта в Trusty снята.")
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
    notify.send(uid, "Анкета проверена: ваш профиль опубликован в каталоге Trusty.", "Открыть профиль", screen="dev", id=uid)
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


__all__ = ["router", "admin"]
