import logging
from datetime import timedelta
from decimal import Decimal

from aiogram.types import LabeledPrice
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import notify
from .config import settings
from .cryptopay import pay
from .escrow import EscrowError
from .models import Subscription, User, utcnow
from .serial import aware, short_date

log = logging.getLogger("trusty.pro")

PLANS = {"1m": (1, Decimal("1")), "3m": (3, Decimal("0.85"))}


def prices(plan: str) -> tuple[int, int, Decimal]:
    months, k = PLANS.get(plan, PLANS["1m"])
    stars = int(round(settings.pro_stars * months * float(k)))
    usdt = (Decimal(str(settings.pro_usdt)) * months * k).quantize(Decimal("0.01"))
    return settings.pro_days * months, stars, usdt


def info(u: User) -> dict:
    plans = []
    for key, (months, k) in PLANS.items():
        days, stars, usdt = prices(key)
        plans.append({"key": key, "days": days, "stars": stars, "usdt": str(usdt), "discount": int(round((1 - float(k)) * 100))})
    return {"active": u.pro(), "until": short_date(u.pro_until) if u.pro() else None, "alerts": u.alerts, "plans": plans,
            "crypto": pay.enabled, "stars": notify.bot is not None}


async def _new(s: AsyncSession, me: User, plan: str, method: str) -> tuple[Subscription, int, Decimal]:
    if plan not in PLANS:
        raise EscrowError("Нет такого тарифа")
    days, stars, usdt = prices(plan)
    sub = Subscription(user_id=me.id, method=method, amount=Decimal(stars) if method == "stars" else usdt,
                       currency="XTR" if method == "stars" else settings.asset, days=days)
    s.add(sub)
    await s.flush()
    return sub, stars, usdt


async def stars_link(s: AsyncSession, me: User, plan: str) -> str:
    if notify.bot is None:
        raise EscrowError("Оплата звёздами сейчас недоступна")
    sub, stars, _ = await _new(s, me, plan, "stars")
    sub.url = await notify.bot.create_invoice_link(
        title="IT Trusty Pro", description=f"Pro на {sub.days} дней: новые проекты сразу в бот и первые места в каталоге.",
        payload=f"pro:{sub.id}", currency="XTR", prices=[LabeledPrice(label=f"Pro на {sub.days} дней", amount=stars)])
    await s.commit()
    return sub.url


async def crypto_invoice(s: AsyncSession, me: User, plan: str) -> str:
    if not pay.enabled:
        raise EscrowError("Оплата в USDT сейчас недоступна")
    sub, _, usdt = await _new(s, me, plan, "crypto")
    inv = await pay.create_invoice(
        amount=usdt, payload=f"pro:{sub.id}", description=f"IT Trusty Pro на {sub.days} дней",
        hidden_message="Pro подключён. Вернитесь в приложение.",
        paid_btn_url=f"{settings.public_url}/?screen=pro" if settings.public_url.startswith("https://") else None)
    sub.external_id, sub.url = str(inv["invoice_id"]), inv.get("bot_invoice_url")
    await s.commit()
    return sub.url


async def _locked(s: AsyncSession, payload: str) -> Subscription | None:
    if not payload.startswith("pro:") or not payload[4:].isdigit():
        return None
    return await s.get(Subscription, int(payload[4:]), with_for_update=True, populate_existing=True)


async def activate(s: AsyncSession, sub: Subscription, external_id: str | None = None) -> bool:
    if sub.status == "paid":
        return False
    u = await s.get(User, sub.user_id, with_for_update=True, populate_existing=True)
    start = max(utcnow(), aware(u.pro_until) or utcnow())
    u.pro_until = start + timedelta(days=sub.days)
    sub.status, sub.paid_at = "paid", utcnow()
    if external_id:
        sub.external_id = external_id
    await s.commit()
    notify.send(u.id, f"IT Trusty Pro подключён до {short_date(u.pro_until)}. Новые проекты по вашему направлению "
                      f"будут приходить сюда, а профиль поднимется в каталоге.", "Открыть IT Trusty", screen="pro")
    return True


async def check_stars(s: AsyncSession, payload: str, user_id: int, amount: int, currency: str) -> str | None:
    sub = await _locked(s, payload)
    if sub is None or sub.user_id != user_id or sub.method != "stars":
        return "Счёт не найден, откройте оплату из приложения ещё раз"
    if sub.status != "pending":
        return "Этот счёт уже оплачен"
    if currency != "XTR" or amount != int(sub.amount):
        return "Сумма счёта изменилась, откройте оплату ещё раз"
    return None


async def paid_stars(s: AsyncSession, payload: str, user_id: int, charge_id: str) -> bool:
    sub = await _locked(s, payload)
    if sub is None or sub.user_id != user_id:
        log.error("stars payment for unknown subscription %s from %s (charge %s)", payload, user_id, charge_id)
        return False
    return await activate(s, sub, charge_id)


async def handle_crypto(s: AsyncSession, inv: dict) -> bool:
    sub = await _locked(s, str(inv.get("payload") or ""))
    if sub is None or sub.method != "crypto" or str(inv.get("invoice_id")) != sub.external_id or inv.get("status") != "paid":
        return False
    return await activate(s, sub)


async def sync_crypto(s: AsyncSession) -> None:
    if not pay.enabled:
        return
    pending = (await s.execute(select(Subscription).where(
        Subscription.method == "crypto", Subscription.status == "pending", Subscription.external_id.is_not(None),
        Subscription.created_at > utcnow() - timedelta(days=2)))).scalars().all()
    if not pending:
        return
    for inv in await pay.get_invoices([int(x.external_id) for x in pending]):
        if inv["status"] == "paid":
            await handle_crypto(s, inv)
        elif inv["status"] == "expired":
            sub = await _locked(s, str(inv.get("payload") or ""))
            if sub and sub.status == "pending":
                sub.status = "expired"
                await s.commit()
