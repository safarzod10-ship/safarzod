"""Escrow: deal state machine and money movements through Crypto Pay.

    awaiting_payment --pay--> in_work --submit--> review --accept / auto-accept--> done (payout to the developer)
         |                       |                  |
       cancel               dev declines        dispute --admin resolves (dev share %)--> done | refunded
         v                  (full refund)
     cancelled               refunded

The client pays amount + fee. The developer receives the amount. After a dispute the fee stays with Trusty;
when the developer declines a paid deal, the client gets everything back, fee included.
Every invoice, payout and refund is a row in `payments`; payouts use a unique spend_id, so they never run twice.
"""
import logging
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import notify
from .config import settings
from .cryptopay import CryptoPayError, money, pay
from .models import Chat, Deal, Message, Payment, Project, Review, User, utcnow
from .serial import aware

log = logging.getLogger("trusty.escrow")

STATUS_LABEL = {
    "awaiting_payment": "Ожидает оплаты", "in_work": "В работе", "review": "На приёмке", "done": "Завершена",
    "dispute": "Спор", "cancelled": "Отменена", "refunded": "Возврат",
}


class EscrowError(Exception):
    """A user-facing reason why an action is not possible."""


def fee_for(amount: int) -> Decimal:
    return (Decimal(amount) * Decimal(str(settings.fee_percent)) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def fmt(x) -> str:
    """90 -> '90', 94.5 -> '94,50'"""
    d = money(x)
    return f"{d:.0f}" if d == d.to_integral() else f"{d:.2f}".replace(".", ",")


async def lock_deal(s: AsyncSession, deal_id: int) -> Deal:
    d = await s.get(Deal, deal_id, with_for_update=True, populate_existing=True)
    if d is None:
        raise EscrowError("Сделка не найдена")
    return d


async def deal_chat(s: AsyncSession, d: Deal) -> Chat | None:
    a, b = sorted((d.client_id, d.dev_id))
    return (await s.execute(select(Chat).where(Chat.a_id == a, Chat.b_id == b))).scalar_one_or_none()


async def system_message(s: AsyncSession, d: Deal, text: str) -> int | None:
    c = await deal_chat(s, d)
    if c is None:
        return None
    s.add(Message(chat_id=c.id, sender_id=None, text=text))
    c.updated_at = utcnow()
    return c.id


def notify_deal(user_id: int, d: Deal, text: str, button: str = "Открыть сделку") -> None:
    notify.send_deal(user_id, d, text, button)


async def open_deal(s: AsyncSession, client_id: int, dev_id: int, title: str, amount: int, days: int,
                    project_id: int | None = None, category: str = "") -> Deal:
    """Creates a deal awaiting payment, attaches it to the pair's chat and posts the terms there."""
    d = Deal(project_id=project_id, client_id=client_id, dev_id=dev_id, title=title, category=category,
             amount=amount, days=days, due_at=utcnow() + timedelta(days=days), fee=fee_for(amount))
    s.add(d)
    if project_id:
        p = await s.get(Project, project_id)
        if p is not None and p.status == "open":
            p.status = "in_work"
    await s.flush()
    a, b = sorted((client_id, dev_id))
    c = (await s.execute(select(Chat).where(Chat.a_id == a, Chat.b_id == b))).scalar_one_or_none()
    if c is None:
        c = Chat(a_id=a, b_id=b)
        s.add(c)
        await s.flush()
    c.deal_id, c.updated_at = d.id, utcnow()
    s.add(Message(chat_id=c.id, sender_id=None,
                  text=f"Сделка #{d.id} создана. Условия зафиксированы: {d.amount} {settings.asset}, срок {d.days} дн. "
                       f"Ожидаем оплату от заказчика: {fmt(d.total)} {settings.asset} с комиссией гаранта."))
    return d


# ---------------------------------------------------------------- payment in
async def invoice_for(s: AsyncSession, deal_id: int, me: User) -> dict:
    """Returns an active invoice for the deal (creates one if needed)."""
    d = await lock_deal(s, deal_id)
    if d.client_id != me.id:
        raise EscrowError("Оплатить сделку может только заказчик")
    if d.status != "awaiting_payment":
        raise EscrowError("Сделка уже оплачена" if d.paid_at else "Сделку нельзя оплатить")
    if not pay.enabled:
        raise EscrowError("Оплата временно недоступна")
    if d.invoice_id:
        found = await pay.get_invoices([d.invoice_id])
        inv = found[0] if found else None
        if inv and inv["status"] == "active":
            return {"url": inv.get("bot_invoice_url") or d.invoice_url, "miniAppUrl": inv.get("mini_app_invoice_url"),
                    "amount": str(d.total)}
        if inv and inv["status"] == "paid":
            await mark_paid(s, d, inv)
            raise EscrowError("Оплата уже получена")
    if d.fee is None:
        d.fee = fee_for(d.amount)
    inv = await pay.create_invoice(
        amount=d.total, payload=f"deal:{d.id}",
        description=f"IT Trusty, сделка #{d.id}: {d.title}. Деньги хранятся у гаранта до приёмки работы.",
        hidden_message="Оплата получена гарантом IT Trusty. Вернитесь в приложение: исполнитель уже знает об оплате.",
        paid_btn_url=f"{settings.public_url}/?screen=deal&id={d.id}" if settings.public_url.startswith("https://") else None)
    d.invoice_id, d.invoice_url = int(inv["invoice_id"]), inv.get("bot_invoice_url")
    s.add(Payment(deal_id=d.id, kind="invoice", user_id=me.id, amount=d.total, asset=settings.asset, status="active",
                  external_id=d.invoice_id, url=d.invoice_url))
    await s.commit()
    return {"url": d.invoice_url, "miniAppUrl": inv.get("mini_app_invoice_url"), "amount": str(d.total)}


async def mark_paid(s: AsyncSession, d: Deal, inv: dict) -> bool:
    """Idempotent: moves the deal to in_work once its invoice is paid. Caller holds the row lock."""
    if d.status != "awaiting_payment" or int(inv.get("invoice_id", 0)) != d.invoice_id:
        return False
    if inv.get("status") != "paid" or str(inv.get("payload")) != f"deal:{d.id}":
        return False
    d.status, d.paid_at = "in_work", utcnow()
    row = (await s.execute(select(Payment).where(Payment.kind == "invoice", Payment.external_id == d.invoice_id))).scalar_one_or_none()
    if row:
        row.status = "paid"
    await system_message(s, d, f"Заказчик внёс {fmt(d.total)} {settings.asset}. Деньги у гаранта до приёмки работы.")
    await s.commit()
    notify_deal(d.client_id, d, f"Оплата получена: {fmt(d.total)} {settings.asset} хранятся у гаранта. Исполнитель приступает к работе.")
    notify_deal(d.dev_id, d, f"Заказчик оплатил сделку #{d.id}. Деньги у гаранта, можно начинать работу. "
                             f"Срок: до {aware(d.due_at):%d.%m}.")
    return True


async def handle_paid_invoice(s: AsyncSession, inv: dict) -> bool:
    payload = str(inv.get("payload") or "")
    if not payload.startswith("deal:") or not payload[5:].isdigit():
        return False
    try:
        d = await lock_deal(s, int(payload[5:]))
    except EscrowError:
        return False
    return await mark_paid(s, d, inv)


async def sync_invoices(s: AsyncSession) -> None:
    """Fallback for missed webhooks: checks every deal still waiting for its invoice."""
    deals = (await s.execute(select(Deal).where(Deal.status == "awaiting_payment", Deal.invoice_id.is_not(None)))).scalars().all()
    if not deals or not pay.enabled:
        return
    invoices = {int(i["invoice_id"]): i for i in await pay.get_invoices([d.invoice_id for d in deals])}
    for d in deals:
        inv = invoices.get(d.invoice_id)
        if not inv:
            continue
        if inv["status"] == "paid":
            locked = await lock_deal(s, d.id)
            await mark_paid(s, locked, inv)
        elif inv["status"] == "expired":
            row = (await s.execute(select(Payment).where(Payment.kind == "invoice", Payment.external_id == d.invoice_id))).scalar_one_or_none()
            if row:
                row.status = "expired"
            d.invoice_id = d.invoice_url = None
            await s.commit()


# ---------------------------------------------------------------- payment out
async def payout(s: AsyncSession, d: Deal, user_id: int, amount: Decimal, kind: str, comment: str) -> Payment:
    """Sends `amount` to the user's Crypto Bot wallet. Idempotent per (deal, kind, user) through spend_id.

    If the transfer is refused outright (for example the user never opened @CryptoBot), a check pinned to the user
    is created instead and its link is sent to them. Network errors leave the payment `failed`; the retry job
    repeats the same transfer (same spend_id), never a check, so money can't go out twice.
    """
    spend_id = f"trusty-{d.id}-{kind}-{user_id}"
    p = (await s.execute(select(Payment).where(Payment.spend_id == spend_id))).scalar_one_or_none()
    if p is None:
        p = Payment(deal_id=d.id, kind=kind, user_id=user_id, amount=money(amount), asset=settings.asset,
                    status="pending", spend_id=spend_id, attempts=0)
        s.add(p)
        await s.flush()
    if p.status in ("sent", "check") or p.amount <= 0:
        return p
    p.attempts += 1
    # once an attempt ended with an unknown outcome, only the same transfer (same spend_id) may be repeated
    uncertain_before = bool(p.error) and _uncertain_code(p.error)
    try:
        t = await pay.transfer(user_id, p.amount, spend_id, comment)
        p.status, p.external_id, p.error = "sent", int(t.get("transfer_id") or 0) or None, None
    except CryptoPayError as e:
        p.error = f"{e.code} {e.name}"
        if e.uncertain or uncertain_before:
            p.status = "failed"  # outcome unknown: only the same transfer may be retried
        else:
            try:
                c = await pay.create_check(user_id, p.amount)
                p.status, p.external_id, p.url = "check", int(c["check_id"]), c.get("bot_check_url")
            except CryptoPayError as e2:
                p.status, p.error = "failed", f"{p.error}; check: {e2.code} {e2.name}"
    await s.commit()
    who = "Выплата" if kind == "payout" else "Возврат"
    if p.status == "sent":
        notify.send(user_id, f"{who} по сделке #{d.id}: {fmt(p.amount)} {settings.asset} отправлены на ваш кошелёк в @CryptoBot.")
    elif p.status == "check":
        notify.send_url(user_id, f"{who} по сделке #{d.id}: {fmt(p.amount)} {settings.asset}. Получите деньги по чеку, "
                                 f"он работает только для вас.", "Получить чек", p.url)
    else:
        log.error("payout %s failed: %s", spend_id, p.error)
        for a in (await s.execute(select(User).where(User.is_admin.is_(True)))).scalars():
            notify.send(a.id, f"Не прошла {who.lower()} по сделке #{d.id} ({fmt(p.amount)} {settings.asset}): {p.error}. "
                              f"Повтор будет автоматически, проверьте баланс приложения в @CryptoBot.", "Финансы", screen="finance")
    return p


def _uncertain_code(error: str) -> bool:
    head = error.split(" ", 1)[0]
    return not head.isdigit() or int(head) == 0 or int(head) >= 500


async def retry_failed_payouts(s: AsyncSession) -> None:
    rows = (await s.execute(select(Payment).where(Payment.kind.in_(("payout", "refund")), Payment.status.in_(("failed", "pending")),
                                                  Payment.attempts < 6, Payment.updated_at < utcnow() - timedelta(minutes=5)))).scalars().all()
    for p in rows:
        d = await s.get(Deal, p.deal_id)
        if d:
            await payout(s, d, p.user_id, p.amount, p.kind, f"IT Trusty, сделка #{d.id}")


# ---------------------------------------------------------------- transitions
async def submit(s: AsyncSession, deal_id: int, me: User, note: str) -> Deal:
    d = await lock_deal(s, deal_id)
    if d.dev_id != me.id:
        raise EscrowError("Сдать работу может только исполнитель")
    if d.status != "in_work":
        raise EscrowError("Работу можно сдать, когда сделка оплачена и в работе")
    d.status, d.submitted_at, d.work_note = "review", utcnow(), note.strip() or None
    d.review_until = d.submitted_at + timedelta(days=settings.review_days)
    await system_message(s, d, f"Исполнитель сдал работу.{(' ' + note.strip()) if note.strip() else ''} "
                               f"Заказчик проверяет до {aware(d.review_until):%d.%m %H:%M} UTC, потом работа примется автоматически.")
    await s.commit()
    notify_deal(d.client_id, d, f"Исполнитель сдал работу по сделке #{d.id}. Проверьте и примите её, "
                                f"или откройте спор. Без ответа работа примется через {settings.review_days:g} дн.", "Проверить работу")
    return d


async def accept(s: AsyncSession, deal_id: int, me: User | None) -> Deal:
    """me=None means auto-acceptance after the review period."""
    d = await lock_deal(s, deal_id)
    if me is not None and d.client_id != me.id:
        raise EscrowError("Принять работу может только заказчик")
    if d.status not in ("in_work", "review"):
        raise EscrowError("Эту сделку нельзя принять")
    if me is None and d.status != "review":
        return d
    now = utcnow()
    d.status, d.finished_at = "done", now
    d.result = "ontime" if (aware(d.submitted_at) or now) <= aware(d.due_at) else "late"
    how = "автоматически: заказчик не ответил вовремя" if me is None else "заказчиком"
    await system_message(s, d, f"Работа принята {how}. Гарант переводит {fmt(d.amount)} {settings.asset} исполнителю.")
    await s.commit()
    await payout(s, d, d.dev_id, Decimal(d.amount), "payout", f"IT Trusty, сделка #{d.id}: {d.title}")
    await ask_reviews(s, d)
    return d


async def ask_reviews(s: AsyncSession, d: Deal) -> None:
    """At the end of a deal each side gets a card with stars to rate the other one."""
    users = {u.id: u for u in (await s.execute(select(User).where(User.id.in_((d.client_id, d.dev_id))))).scalars()}
    for me_id, other_id, who in ((d.client_id, d.dev_id, "исполнителя"), (d.dev_id, d.client_id, "заказчика")):
        other = users.get(other_id)
        notify.send_rate(me_id, d, f"Сделка #{d.id} «{d.title}» завершена. Оцените {who} {other.name if other else ''}: "
                                   f"отзыв увидят другие пользователи.")


async def dispute(s: AsyncSession, deal_id: int, me: User, reason: str) -> Deal:
    d = await lock_deal(s, deal_id)
    if me.id not in (d.client_id, d.dev_id):
        raise EscrowError("Сделка не найдена")
    if d.status not in ("in_work", "review"):
        raise EscrowError("Спор можно открыть по оплаченной сделке до её завершения")
    d.status, d.dispute_by, d.dispute_reason = "dispute", me.id, reason.strip()
    side = "Заказчик" if me.id == d.client_id else "Исполнитель"
    await system_message(s, d, f"{side} открыл спор: {reason.strip()} Деньги заморожены до решения арбитра.")
    await s.commit()
    other = d.dev_id if me.id == d.client_id else d.client_id
    notify_deal(other, d, f"По сделке #{d.id} открыт спор. Арбитр изучит переписку; добавьте свои доводы в чат сделки.")
    for a in (await s.execute(select(User).where(User.is_admin.is_(True)))).scalars():
        notify_deal(a.id, d, f"Новый спор по сделке #{d.id} ({fmt(d.amount)} {settings.asset}). Причина: {reason.strip()[:300]}", "Разобрать спор")
    return d


async def resolve(s: AsyncSession, deal_id: int, admin: User, dev_share: int, note: str) -> Deal:
    d = await lock_deal(s, deal_id)
    if d.status != "dispute":
        raise EscrowError("Сделка не в споре")
    if not 0 <= dev_share <= 100:
        raise EscrowError("Доля от 0 до 100%")
    dev_amount = money(Decimal(d.amount) * dev_share / 100)
    client_amount = money(Decimal(d.amount) - dev_amount)
    d.dev_share, d.finished_at = dev_share, utcnow()
    d.status = "done" if dev_amount > 0 else "refunded"
    d.result = "dispute_won" if dev_share >= 50 else "dispute_lost"
    d.resolution = (f"Арбитр: исполнителю {fmt(dev_amount)} {settings.asset} ({dev_share}%), "
                    f"заказчику {fmt(client_amount)} {settings.asset}.{(' ' + note.strip()) if note.strip() else ''}")
    await system_message(s, d, f"Спор решён. {d.resolution}")
    await s.commit()
    if dev_amount > 0:
        await payout(s, d, d.dev_id, dev_amount, "payout", f"IT Trusty, сделка #{d.id}: решение арбитра")
    if client_amount > 0:
        await payout(s, d, d.client_id, client_amount, "refund", f"IT Trusty, сделка #{d.id}: решение арбитра")
    for uid in (d.client_id, d.dev_id):
        notify_deal(uid, d, f"Спор по сделке #{d.id} решён. {d.resolution}")
    await ask_reviews(s, d)
    return d


async def cancel(s: AsyncSession, deal_id: int, me: User) -> Deal:
    d = await lock_deal(s, deal_id)
    if me.id not in (d.client_id, d.dev_id):
        raise EscrowError("Сделка не найдена")
    if d.status == "awaiting_payment":
        if d.invoice_id:
            try:
                await pay.delete_invoice(d.invoice_id)
            except CryptoPayError as e:
                log.info("delete invoice %s: %s", d.invoice_id, e)
            # an invoice paid at this very moment must not be lost
            found = await pay.get_invoices([d.invoice_id]) if pay.enabled else []
            if found and found[0]["status"] == "paid":
                await mark_paid(s, d, found[0])
                raise EscrowError("Сделка уже оплачена, отменить её нельзя")
        d.status, d.finished_at = "cancelled", utcnow()
        text = "Сделка отменена до оплаты."
    elif d.status == "in_work" and me.id == d.dev_id:
        d.status, d.finished_at = "refunded", utcnow()
        text = f"Исполнитель отказался от сделки. Гарант возвращает заказчику {fmt(d.total)} {settings.asset}."
    else:
        raise EscrowError("Отменить оплаченную сделку может исполнитель до сдачи работы. Заказчику доступен спор")
    if d.project_id:
        p = await s.get(Project, d.project_id)
        if p and p.status == "in_work":
            p.status = "open"
    await system_message(s, d, text)
    await s.commit()
    if d.status == "refunded":
        await payout(s, d, d.client_id, d.total, "refund", f"IT Trusty, возврат по сделке #{d.id}")
    other = d.dev_id if me.id == d.client_id else d.client_id
    notify_deal(other, d, f"Сделка #{d.id}: {text}")
    return d


def can_review(d: Deal) -> bool:
    """Reviews are left at the end: after acceptance, or after a dispute or refund of a paid deal."""
    return d.status == "done" or (d.status == "refunded" and d.paid_at is not None)


async def review(s: AsyncSession, deal_id: int, me: User, rating: int, text: str) -> None:
    """The client rates the developer, the developer rates the client; once each."""
    d = await s.get(Deal, deal_id)
    if d is None or me.id not in (d.client_id, d.dev_id):
        raise EscrowError("Отзыв оставляют участники сделки")
    if not can_review(d):
        raise EscrowError("Отзыв можно оставить после завершения сделки")
    if not 1 <= rating <= 5:
        raise EscrowError("Оценка от 1 до 5")
    if (await s.execute(select(Review).where(Review.deal_id == d.id, Review.author_id == me.id))).scalar_one_or_none():
        raise EscrowError("Вы уже оставили отзыв")
    client = me.id == d.client_id
    target = d.dev_id if client else d.client_id
    s.add(Review(deal_id=d.id, author_id=me.id, target_id=target, rating=rating, text=text.strip()))
    await system_message(s, d, f"{'Заказчик' if client else 'Исполнитель'} оставил отзыв: {'★' * rating}")
    await s.commit()
    notify.send(target, f"Новый отзыв по сделке #{d.id}: {'★' * rating}{(' «' + text.strip()[:200] + '»') if text.strip() else ''}",
                "Открыть сделку", screen="deal", id=d.id)


async def auto_accept_due(s: AsyncSession) -> None:
    ids = (await s.execute(select(Deal.id).where(Deal.status == "review", Deal.review_until < utcnow()))).scalars().all()
    for i in ids:
        try:
            await accept(s, i, None)
        except EscrowError:
            pass
