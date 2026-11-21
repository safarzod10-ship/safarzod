from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import notify
from .config import settings
from .escrow import EscrowError, fmt, open_deal
from .models import Chat, Deal, DevProfile, Message, Offer, Project, User, utcnow
from .serial import aware

TTL_HOURS = (24, 48, 72)
CATEGORY_LABEL = {"bots": "Боты", "web": "Веб", "parsers": "Парсеры", "mobile": "Mobile", "web3": "Web3",
                  "design": "Дизайн", "devops": "DevOps"}


def left(o: Offer) -> str:
    sec = max(0, int((aware(o.expires_at) - utcnow()).total_seconds()))
    h, m = sec // 3600, sec % 3600 // 60
    return f"{h}ч {m:02d}м" if h else f"{m}м"


def is_open(o: Offer) -> bool:
    return o.status == "pending" and aware(o.expires_at) > utcnow()


async def _dev_ready(s: AsyncSession, dev_id: int, amount: int) -> None:
    p = await s.get(DevProfile, dev_id)
    if p is None or p.moderation != "published":
        raise EscrowError("Исполнитель ещё не прошёл проверку анкеты, поэтому сделку оформить нельзя")
    done = (await s.execute(select(func.count()).where(Deal.dev_id == dev_id, Deal.status == "done"))).scalar_one()
    if done < 3 and amount > settings.new_dev_limit:
        raise EscrowError(f"У нового исполнителя сумма сделки ограничена {settings.new_dev_limit} {settings.asset}, "
                          f"пока у него нет трёх успешных сделок")


async def _lock(s: AsyncSession, offer_id: int) -> Offer:
    o = await s.get(Offer, offer_id, with_for_update=True, populate_existing=True)
    if o is None:
        raise EscrowError("Оффер не найден")
    if o.status == "pending" and aware(o.expires_at) <= utcnow():
        o.status, o.decided_at = "expired", utcnow()
    if o.status != "pending":
        raise EscrowError({"accepted": "Оффер уже принят", "declined": "Оффер уже отклонён",
                           "countered": "На этот оффер уже ответили своей ценой", "withdrawn": "Оффер отозван",
                           "expired": "Срок оффера истёк"}.get(o.status, "Оффер уже закрыт"))
    return o


async def open_project(s: AsyncSession, project_id: int | None, client_id: int) -> Project:
    p = await s.get(Project, project_id) if project_id else None
    if p is None or p.client_id != client_id:
        raise EscrowError("Выберите открытый проект заказчика: оффер делается на опубликованную задачу")
    if p.status != "open":
        raise EscrowError("По этому проекту исполнитель уже выбран")
    return p


async def propose(s: AsyncSession, chat: Chat, me: User, *, amount: int, days: int, project_id: int | None,
                  ttl_hours: int = 48, as_role: str | None = None, parent: Offer | None = None) -> Offer:
    peer_id = chat.b_id if chat.a_id == me.id else chat.a_id
    peer = await s.get(User, peer_id)
    if peer is None or peer.banned():
        raise EscrowError("Пользователь заблокирован, предложить сделку нельзя")
    role = as_role or me.role
    client_id, dev_id = (me.id, peer_id) if role == "client" else (peer_id, me.id)
    p = await open_project(s, project_id, client_id)
    await _dev_ready(s, dev_id, amount)
    ttl = ttl_hours if ttl_hours in TTL_HOURS else 48
    o = Offer(chat_id=chat.id, from_id=me.id, to_id=peer_id, client_id=client_id, dev_id=dev_id, project_id=p.id,
              parent_id=parent.id if parent else None, title=p.title[:120], amount=amount, days=days,
              expires_at=utcnow() + timedelta(hours=ttl))
    s.add(o)
    await s.flush()
    m = Message(chat_id=chat.id, sender_id=me.id, offer_id=o.id,
                text=f"Оффер: {amount} {settings.asset} за «{o.title}», срок {days} дн.")
    s.add(m)
    chat.updated_at = utcnow()
    await s.flush()
    if chat.a_id == me.id:
        chat.a_read = m.id
    else:
        chat.b_read = m.id
    notify.send_offer(peer_id, o, me.name, parent.amount if parent else None, left(o))
    return o


async def counter(s: AsyncSession, offer_id: int, me: User, amount: int, days: int, ttl_hours: int = 48) -> Offer:
    o = await _lock(s, offer_id)
    if o.to_id != me.id:
        raise EscrowError("Ответить своей ценой может только тот, кому пришёл оффер")
    o.status, o.decided_at = "countered", utcnow()
    chat = await s.get(Chat, o.chat_id)
    return await propose(s, chat, me, amount=amount, days=days, ttl_hours=ttl_hours,
                         as_role="client" if me.id == o.client_id else "dev", project_id=o.project_id, parent=o)


async def accept(s: AsyncSession, offer_id: int, me: User) -> tuple[Offer, Deal]:
    o = await _lock(s, offer_id)
    if o.to_id != me.id:
        raise EscrowError("Принять оффер может только тот, кому он пришёл")
    sender = await s.get(User, o.from_id)
    if sender is None or sender.banned():
        raise EscrowError("Пользователь заблокирован, сделку оформить нельзя")
    await _dev_ready(s, o.dev_id, o.amount)
    p = await open_project(s, o.project_id, o.client_id)
    d = await open_deal(s, o.client_id, o.dev_id, o.title, o.amount, o.days, p.id, CATEGORY_LABEL.get(p.category, ""))
    o.status, o.decided_at, o.deal_id = "accepted", utcnow(), d.id
    for other in (await s.execute(select(Offer).where(Offer.project_id == p.id, Offer.status == "pending",
                                                      Offer.id != o.id))).scalars():
        other.status, other.decided_at = "withdrawn", utcnow()
    notify.send_deal(o.client_id, d, f"Оффер принят: «{d.title}», {d.amount} {settings.asset}. "
                                     f"Оплатите {fmt(d.total)} {settings.asset}: деньги будут у гаранта до приёмки работы.",
                     "Оплатить")
    notify.send_deal(o.dev_id, d, f"Оффер принят: «{d.title}», {d.amount} {settings.asset}. "
                                  f"Начинайте после оплаты: мы пришлём уведомление.")
    return o, d


async def decline(s: AsyncSession, offer_id: int, me: User) -> Offer:
    o = await _lock(s, offer_id)
    if o.to_id != me.id:
        raise EscrowError("Отклонить оффер может только тот, кому он пришёл")
    o.status, o.decided_at = "declined", utcnow()
    notify.send(o.from_id, f"{me.name} отклонил оффер {o.amount} {settings.asset} за «{o.title}». "
                           f"Можно предложить другую цену в чате.", "Открыть чат", screen="chat", id=o.chat_id)
    return o


async def withdraw(s: AsyncSession, offer_id: int, me: User) -> Offer:
    o = await _lock(s, offer_id)
    if o.from_id != me.id:
        raise EscrowError("Отозвать можно только свой оффер")
    o.status, o.decided_at = "withdrawn", utcnow()
    return o


async def expire_due(s: AsyncSession) -> None:
    rows = (await s.execute(select(Offer).where(Offer.status == "pending", Offer.expires_at <= utcnow()))).scalars().all()
    for o in rows:
        o.status, o.decided_at = "expired", utcnow()
    if rows:
        await s.commit()

