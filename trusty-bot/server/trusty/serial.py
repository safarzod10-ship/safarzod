from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import presence
from .models import (Attachment, Bid, Chat, Complaint, Deal, DevProfile, Evidence, Invite, Message, Offer, Project, Review,
                     User, utcnow)

MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
              "ноября", "декабря"]
MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]


def aware(d: datetime | None) -> datetime | None:
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def minutes_since(d: datetime | None) -> int:
    if d is None:
        return 10 ** 6
    return max(0, int((utcnow() - aware(d)).total_seconds() // 60))


def plural(n: int, one: str, few: str, many: str) -> str:
    m10, m100 = n % 10, n % 100
    if m10 == 1 and m100 != 11:
        return one
    if 2 <= m10 <= 4 and not 12 <= m100 <= 14:
        return few
    return many


def ago(d: datetime) -> str:
    m = minutes_since(d)
    if m < 1:
        return "только что"
    if m < 60:
        return f"{m} мин назад"
    h = m // 60
    if h < 24:
        return f"{h} ч назад"
    days = h // 24
    if days == 1:
        return "вчера"
    return f"{days} {plural(days, 'день', 'дня', 'дней')} назад"


def short_date(d: datetime) -> str:
    d = aware(d)
    return f"{d.day} {MONTHS_SHORT[d.month - 1]}"


def amount_range(a: int) -> str:
    for lo, hi in ((0, 50), (50, 100), (100, 200), (200, 300), (300, 500), (500, 700), (700, 1000)):
        if a < hi:
            return f"{lo}–{hi}"
    return "1000+"


def hue(uid: int) -> int:
    return uid % 8


def client_brief(u: User, stats: dict | None = None) -> dict:
    st = stats or {}
    return {"id": str(u.id), "name": u.name, "handle": u.username or "", "hue": hue(u.id),
            "rating": st.get("rating", 0), "deals": st.get("deals", 0), "fastPay": st.get("fastPay", False),
            "lastSeenMin": minutes_since(u.last_seen_at)}


FAST_PAY_HOURS = 2


async def client_stats(s: AsyncSession, ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = defaultdict(lambda: {"rating": 0, "deals": 0, "fastPay": False})
    if not ids:
        return out
    waits: dict[int, list[float]] = defaultdict(list)
    for cid, created, paid in await s.execute(select(Deal.client_id, Deal.created_at, Deal.paid_at)
                                              .where(Deal.client_id.in_(ids), Deal.paid_at.is_not(None))):
        waits[cid].append((aware(paid) - aware(created)).total_seconds() / 3600)
    for cid, w in waits.items():
        out[cid]["fastPay"] = len(w) >= 2 and sum(w) / len(w) <= FAST_PAY_HOURS
    rows = await s.execute(select(Deal.client_id, func.count()).where(Deal.client_id.in_(ids), Deal.status == "done")
                           .group_by(Deal.client_id))
    for cid, n in rows:
        out[cid]["deals"] = n
    rows = await s.execute(select(Review.target_id, func.avg(Review.rating)).join(Deal, Deal.id == Review.deal_id)
                           .where(Review.target_id.in_(ids), Deal.client_id == Review.target_id).group_by(Review.target_id))
    for tid, avg in rows:
        out[tid]["rating"] = round(float(avg), 1)
    return out


LEVELS = {"new": "Новый", "verified": "Проверенный", "top": "Топ"}


def level_of(verified: bool, done: int, rating: float, on_time: int, lost: int) -> str:
    if verified and done >= 15 and rating >= 4.8 and on_time >= 90 and lost == 0:
        return "top"
    if verified and done >= 3 and rating >= 4.5 and lost <= 1:
        return "verified"
    return "new"


def level_next(level: str, done: int, rating: float, on_time: int, lost: int) -> dict | None:
    if level == "top":
        return None
    goal = {"deals": 3, "rating": 4.5, "onTime": 0, "lost": 1} if level == "new" else {"deals": 15, "rating": 4.8, "onTime": 90, "lost": 0}
    left = []
    if done < goal["deals"]:
        n = goal["deals"] - done
        left.append(f"ещё {n} {plural(n, 'сделка', 'сделки', 'сделок')}")
    if done and rating < goal["rating"]:
        left.append(f"рейтинг от {goal['rating']:g}")
    if goal["onTime"] and done and on_time < goal["onTime"]:
        left.append(f"сдача в срок от {goal['onTime']}%")
    if lost > goal["lost"]:
        left.append("без проигранных споров" if goal["lost"] == 0 else "не больше одного проигранного спора")
    return {"name": LEVELS["verified" if level == "new" else "top"], "left": left}


def portfolio_payload(items: list) -> list[dict]:
    from .files import link
    out = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        out.append({"title": it.get("title") or "", "text": it.get("text") or "", "url": it.get("url") or None,
                    "image": link("p", it["image"]) if it.get("image") else None, "imageId": it.get("image") or None})
    return out


async def dev_payloads(s: AsyncSession, profiles: list[tuple[DevProfile, User]]) -> list[dict]:
    ids = [u.id for _, u in profiles]
    if not ids:
        return []
    deals = (await s.execute(select(Deal).where(Deal.dev_id.in_(ids)).order_by(Deal.finished_at.desc()))).scalars().all()
    reviews = {(r.deal_id, r.target_id): r for r in (await s.execute(select(Review).where(Review.target_id.in_(ids)))).scalars()}
    authors = {}
    if reviews:
        a_ids = list({r.author_id for r in reviews.values()})
        authors = {u.id: u for u in (await s.execute(select(User).where(User.id.in_(a_ids)))).scalars()}
    by_dev: dict[int, list[Deal]] = defaultdict(list)
    for d in deals:
        by_dev[d.dev_id].append(d)
    out = []
    for p, u in profiles:
        mine = by_dev[u.id]
        done = [d for d in mine if d.status == "done"]
        disputes = [d for d in mine if d.status == "dispute" or (d.result or "").startswith("dispute")]
        lost = [d for d in mine if d.result == "dispute_lost"]
        ontime = [d for d in done if d.result == "ontime"]
        ratings = [reviews[(d.id, u.id)].rating for d in done if (d.id, u.id) in reviews]
        history = []
        for d in done[:6]:
            r = reviews.get((d.id, u.id))
            history.append({
                "id": d.id, "title": d.title, "category": d.category, "amount": amount_range(d.amount),
                "date": short_date(d.finished_at or d.created_at), "result": d.result or "ontime",
                "rating": r.rating if r else None, "review": r.text if r else None,
                "author": authors[r.author_id].first_name if r and r.author_id in authors else None,
            })
        created = aware(u.created_at)
        rating = round(sum(ratings) / len(ratings), 1) if ratings else 0
        on_time = round(100 * len(ontime) / len(done)) if done else 0
        lvl = level_of(p.moderation == "published", len(done), rating, on_time, len(lost))
        out.append({
            "id": str(u.id), "name": u.name, "handle": u.username or "", "hue": hue(u.id), "title": p.title,
            "categories": p.categories, "stack": p.stack,
            "rating": round(sum(ratings) / len(ratings), 1) if ratings else 0,
            "deals": len(done), "volume": sum(d.amount for d in done),
            "onTime": round(100 * len(ontime) / len(done)) if done else 0,
            "disputes": len(disputes), "disputesLost": len(lost),
            "lastSeenMin": minutes_since(u.last_seen_at), "responseMin": 0,
            "status": p.status, "busyUntil": p.busy_until, "rate": p.rate,
            "verified": p.moderation == "published", "github": p.github or None, "deposit": p.deposit or None,
            "isNew": len(done) < 3, "joined": f"{MONTHS_GEN[created.month - 1]} {created.year}",
            "about": p.about, "portfolio": portfolio_payload(p.portfolio), "links": p.links or [], "history": history,
            "pro": u.pro(), "level": lvl, "levelNext": level_next(lvl, len(done), rating, on_time, len(lost)),
            "moderation": p.moderation, "years": p.years,
            "banned": (None if not u.banned() else {"until": None if u.ban_permanent else short_date(u.ban_until)}),
        })
    return out


async def project_payloads(s: AsyncSession, projects: list[Project], me: User) -> list[dict]:
    if not projects:
        return []
    pids = [p.id for p in projects]
    client_ids = list({p.client_id for p in projects})
    clients = {u.id: u for u in (await s.execute(select(User).where(User.id.in_(client_ids)))).scalars()}
    cstats = await client_stats(s, client_ids)
    counts = dict((await s.execute(select(Bid.project_id, func.count()).where(Bid.project_id.in_(pids))
                                   .group_by(Bid.project_id))).all())
    owned = [p.id for p in projects if p.client_id == me.id]
    invites = (await s.execute(select(Invite).where(Invite.project_id.in_(pids)))).scalars().all()
    bids: dict[int, list[Bid]] = defaultdict(list)
    mine: dict[int, Bid] = {}
    for b in (await s.execute(select(Bid).where(Bid.project_id.in_(pids)))).scalars():
        if b.project_id in owned:
            bids[b.project_id].append(b)
        if b.dev_id == me.id:
            mine[b.project_id] = b
    out = []
    for p in projects:
        out.append({
            "id": p.id, "title": p.title, "category": p.category, "budgetMin": p.budget_min, "budgetMax": p.budget_max,
            "days": p.days, "stack": p.stack, "text": p.text, "clientId": str(p.client_id),
            "client": client_brief(clients[p.client_id], cstats.get(p.client_id)) if p.client_id in clients else None,
            "ago": ago(p.created_at), "files": p.files or [], "status": p.status,
            "bidsCount": counts.get(p.id, 0),
            "bids": [{"devId": str(b.dev_id), "price": b.price, "days": b.days, "text": b.text, "ago": ago(b.created_at)}
                     for b in sorted(bids.get(p.id, []), key=lambda b: b.price)],
            "myBid": ({"projectId": p.id, "price": mine[p.id].price, "days": mine[p.id].days, "text": mine[p.id].text}
                      if p.id in mine else None),
            "invited": any(i.project_id == p.id and i.dev_id == me.id for i in invites),
            "invitedIds": [str(i.dev_id) for i in invites if i.project_id == p.id] if p.client_id == me.id else [],
        })
    return out


def offer_payload(o: Offer, me_id: int, prev_amount: int | None) -> dict:
    from decimal import ROUND_HALF_UP, Decimal
    from .config import settings
    status = "expired" if o.status == "pending" and aware(o.expires_at) <= utcnow() else o.status
    fee = (Decimal(o.amount) * Decimal(str(settings.fee_percent)) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {"id": o.id, "title": o.title, "amount": o.amount, "days": o.days, "status": status,
            "mine": o.from_id == me_id, "myRole": "client" if o.client_id == me_id else "dev",
            "prevAmount": prev_amount, "expiresAt": aware(o.expires_at).isoformat(), "createdAt": aware(o.created_at).isoformat(),
            "dealId": o.deal_id,
            "fee": str(fee), "total": str(Decimal(o.amount) + fee)}


def message_payload(m: Message, me_id: int, offer: dict | None = None, files: list | None = None) -> dict:
    out = {"id": m.id, "from": "system" if m.sender_id is None else ("me" if m.sender_id == me_id else "peer"),
           "text": m.text, "at": aware(m.created_at).isoformat()}
    if offer:
        out["offer"] = offer
    if files:
        from .files import IMAGES, link
        out["files"] = [{"id": a.id, "name": a.name, "size": a.size, "mime": a.mime, "image": a.mime in IMAGES,
                         "url": link("a", a.id)} for a in files]
    return out


async def _offers_for(s: AsyncSession, msgs: list[Message], me_id: int) -> dict[int, dict]:
    ids = [m.offer_id for m in msgs if m.offer_id]
    if not ids:
        return {}
    rows = {o.id: o for o in (await s.execute(select(Offer).where(Offer.id.in_(ids)))).scalars()}
    parent_ids = [o.parent_id for o in rows.values() if o.parent_id and o.parent_id not in rows]
    parents = {o.id: o for o in (await s.execute(select(Offer).where(Offer.id.in_(parent_ids)))).scalars()} if parent_ids else {}
    parents.update(rows)
    return {oid: offer_payload(o, me_id, parents[o.parent_id].amount if o.parent_id in parents else None)
            for oid, o in rows.items()}


async def chat_payloads(s: AsyncSession, chats: list[Chat], me: User, full: bool = False, skip_hidden: bool = False) -> list[dict]:
    if not chats:
        return []
    peer_ids = [c.b_id if c.a_id == me.id else c.a_id for c in chats]
    peers = {u.id: u for u in (await s.execute(select(User).where(User.id.in_(peer_ids)))).scalars()}
    dev_ids = set((await s.execute(select(DevProfile.user_id).where(DevProfile.user_id.in_(peer_ids)))).scalars())
    cstats = await client_stats(s, [x for x in peer_ids if x not in dev_ids])
    deals = {}
    deal_ids = [c.deal_id for c in chats if c.deal_id]
    if deal_ids:
        deals = {d.id: d for d in (await s.execute(select(Deal).where(Deal.id.in_(deal_ids)))).scalars()}
    out = []
    for c in chats:
        pid = c.b_id if c.a_id == me.id else c.a_id
        read = c.a_read if c.a_id == me.id else c.b_read
        hidden_at = c.a_hidden if c.a_id == me.id else c.b_hidden
        hidden = hidden_at or 0
        peer = peers.get(pid)
        unread = (await s.execute(select(func.count()).where(Message.chat_id == c.id, Message.id > max(read, hidden),
                                                             or_(Message.sender_id != me.id, Message.sender_id.is_(None))))).scalar_one()
        q = (select(Message).where(Message.chat_id == c.id, Message.id > hidden).order_by(Message.id.desc())
             .limit(300 if full else 1))
        msgs = list(reversed((await s.execute(q)).scalars().all()))
        if skip_hidden and not msgs:
            continue
        offer_cards = await _offers_for(s, msgs, me.id) if full else {}
        files: dict[int, list] = defaultdict(list)
        if msgs:
            for a in (await s.execute(select(Attachment).where(Attachment.message_id.in_([m.id for m in msgs]))
                                      .order_by(Attachment.id))).scalars():
                files[a.message_id].append(a)
        waiting = (await s.execute(select(func.count()).where(Offer.chat_id == c.id, Offer.to_id == me.id,
                                                              Offer.status == "pending", Offer.expires_at > utcnow()))).scalar_one()
        d = deals.get(c.deal_id) if c.deal_id else None
        out.append({
            "id": str(c.id),
            "peer": {"name": peer.name if peer else "Пользователь", "hue": hue(pid),
                     "lastSeenMin": minutes_since(peer.last_seen_at) if peer else 10 ** 6,
                     "role": "dev" if pid in dev_ids else "client", "refId": str(pid),
                     **({} if pid in dev_ids else {"rating": cstats[pid]["rating"], "deals": cstats[pid]["deals"],
                                                   "fastPay": cstats[pid]["fastPay"]})},
            "deal": ({"id": d.id, "title": d.title, "amount": d.amount, "status": d.status, "due": short_date(d.due_at),
                      "clientId": str(d.client_id), "devId": str(d.dev_id)} if d else None),
            "unread": unread,
            "offersWaiting": waiting,
            "peerTyping": presence.is_typing(c.id, pid),
            "messages": [message_payload(m, me.id, offer_cards.get(m.offer_id), files.get(m.id)) for m in msgs],
        })
    return out


def evidence_url(e: Evidence, secret: bytes) -> str:
    import hashlib
    import hmac
    sig = hmac.new(secret, str(e.id).encode(), hashlib.sha256).hexdigest()[:32]
    return f"/api/files/{e.id}?sig={sig}"


async def complaint_payloads(s: AsyncSession, complaints: list[Complaint], secret: bytes) -> list[dict]:
    if not complaints:
        return []
    uids = list({c.from_id for c in complaints} | {c.against_id for c in complaints})
    users = {u.id: u for u in (await s.execute(select(User).where(User.id.in_(uids)))).scalars()}
    ev: dict[int, list[Evidence]] = defaultdict(list)
    for e in (await s.execute(select(Evidence).where(Evidence.complaint_id.in_([c.id for c in complaints])))).scalars():
        ev[e.complaint_id].append(e)
    return [{
        "id": c.id, "fromId": str(c.from_id), "fromName": users[c.from_id].name if c.from_id in users else "—",
        "againstId": str(c.against_id), "againstName": users[c.against_id].name if c.against_id in users else "—",
        "dealId": c.deal_id, "reason": c.reason, "text": c.text, "status": c.status, "ago": ago(c.created_at),
        "decision": c.decision, "evidence": [evidence_url(e, secret) for e in ev[c.id]],
    } for c in complaints]


def member_payload(u: User, is_dev: bool) -> dict:
    ban = None
    if u.banned():
        ban = {"until": None if u.ban_permanent else short_date(u.ban_until)}
    return {"id": str(u.id), "name": u.name, "handle": u.username or "", "hue": hue(u.id),
            "role": "dev" if is_dev else "client", "strikes": u.strikes, "ban": ban, "isAdmin": u.is_admin}


def person(u: User | None, uid: int) -> dict:
    return {"id": str(uid), "name": u.name if u else "Пользователь", "handle": (u.username or "") if u else "", "hue": hue(uid),
            "lastSeenMin": minutes_since(u.last_seen_at) if u else 10 ** 6}


async def deal_payloads(s: AsyncSession, deals: list, me: User) -> list[dict]:
    from .models import Deal, Payment
    if not deals:
        return []
    ids = [d.id for d in deals]
    uids = list({d.client_id for d in deals} | {d.dev_id for d in deals})
    users = {u.id: u for u in (await s.execute(select(User).where(User.id.in_(uids)))).scalars()}
    reviews = {(r.deal_id, r.author_id): r for r in (await s.execute(select(Review).where(Review.deal_id.in_(ids)))).scalars()}
    pays = defaultdict(list)
    for p in (await s.execute(select(Payment).where(Payment.deal_id.in_(ids)).order_by(Payment.id))).scalars():
        pays[p.deal_id].append(p)
    chats = {}
    for c in (await s.execute(select(Chat).where(or_(*[and_pair(d.client_id, d.dev_id) for d in deals])))).scalars():
        chats[(c.a_id, c.b_id)] = c.id
    out = []
    for d in deals:
        role = "client" if d.client_id == me.id else "dev" if d.dev_id == me.id else "admin"
        r = reviews.get((d.id, d.client_id))
        rc = reviews.get((d.id, d.dev_id))
        mine = reviews.get((d.id, me.id))
        final = d.status == "done" or (d.status == "refunded" and d.paid_at is not None)
        visible = [p for p in pays[d.id] if role == "admin" or p.user_id == me.id]
        out.append({
            "id": d.id, "title": d.title, "category": d.category, "amount": d.amount,
            "fee": str(d.fee) if d.fee is not None else None, "total": str(d.total), "status": d.status, "role": role,
            "client": person(users.get(d.client_id), d.client_id), "dev": person(users.get(d.dev_id), d.dev_id),
            "days": d.days, "due": short_date(d.due_at), "dueAt": aware(d.due_at).isoformat(),
            "createdAt": aware(d.created_at).isoformat(), "paidAt": aware(d.paid_at).isoformat() if d.paid_at else None,
            "submittedAt": aware(d.submitted_at).isoformat() if d.submitted_at else None,
            "reviewUntil": aware(d.review_until).isoformat() if d.review_until else None,
            "finishedAt": aware(d.finished_at).isoformat() if d.finished_at else None,
            "workNote": d.work_note, "disputeReason": d.dispute_reason,
            "disputeBy": None if not d.dispute_by else ("client" if d.dispute_by == d.client_id else "dev"),
            "resolution": d.resolution, "devShare": d.dev_share, "result": d.result, "projectId": d.project_id,
            "chatId": str(chats[tuple(sorted((d.client_id, d.dev_id)))]) if tuple(sorted((d.client_id, d.dev_id))) in chats else None,
            "review": {"rating": r.rating, "text": r.text} if r else None,
            "clientReview": {"rating": rc.rating, "text": rc.text} if rc else None,
            "payments": [{"id": p.id, "kind": p.kind, "amount": str(p.amount), "status": p.status, "userId": str(p.user_id),
                          "url": p.url if (p.kind != "invoice" and (p.user_id == me.id or role == "admin")) else None,
                          "error": p.error if role == "admin" else None, "at": aware(p.updated_at).isoformat()} for p in visible],
            "actions": {
                "pay": role == "client" and d.status == "awaiting_payment",
                "submit": role == "dev" and d.status == "in_work",
                "accept": role == "client" and d.status in ("in_work", "review"),
                "dispute": role in ("client", "dev") and d.status in ("in_work", "review"),
                "cancel": (role in ("client", "dev") and d.status == "awaiting_payment") or (role == "dev" and d.status == "in_work"),
                "review": role in ("client", "dev") and final and mine is None,
                "resolve": role == "admin" and d.status == "dispute",
            },
        })
    return out


def and_pair(x: int, y: int):
    from sqlalchemy import and_
    from .models import Chat as _Chat
    a, b = sorted((x, y))
    return and_(_Chat.a_id == a, _Chat.b_id == b)
