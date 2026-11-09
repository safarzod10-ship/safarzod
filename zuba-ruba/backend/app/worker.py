import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import timedelta

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramNetworkError,
    TelegramRetryAfter,
    TelegramServerError,
)
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo
from sqlalchemy import func, select, update

from app import settings_store
from app.bot.handlers import router
from app.bot.messages import BOT_NAME, DESCRIPTION, SHORT_DESCRIPTION, send_broadcast, send_notification, webapp_url
from app.clock import utcnow
from app.config import get_config
from app.db import dispose_engine, init_engine, sessionmaker
from app.flyer import FlyerClient
from app.logging_setup import setup_logging
from app.models import Boost, Broadcast, Completion, Notification, User
from app.services import analytics, referrals, tasks, withdrawals

log = logging.getLogger("worker")
MAX_ATTEMPTS = 8



async def process_due_completions(flyer: FlyerClient) -> int:
    processed = 0
    async with sessionmaker()() as session:
        ids = await tasks.due_completion_ids(session)
    for completion_id in ids:
        async with sessionmaker()() as session:
            completion = (
                await session.execute(
                    select(Completion)
                    .where(Completion.id == completion_id, Completion.status.in_(("waiting_payment", "holding")), Completion.next_check_at <= func.now())
                    .with_for_update(skip_locked=True).execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if completion is None:
                continue
            settings = await settings_store.load(session)
            await tasks.recheck_completion(session, flyer, completion, settings)
            await session.commit()
            processed += 1
    return processed


async def process_due_boosts(flyer: FlyerClient) -> int:
    processed = 0
    async with sessionmaker()() as session:
        ids = await tasks.due_boost_ids(session)
    for boost_id in ids:
        async with sessionmaker()() as session:
            boost = (
                await session.execute(
                    select(Boost).where(Boost.id == boost_id, Boost.status == "active", Boost.next_check_at <= func.now()).with_for_update(skip_locked=True).execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if boost is None:
                continue
            settings = await settings_store.load(session)
            await tasks.recheck_boost(session, flyer, boost, settings)
            await session.commit()
            processed += 1
    return processed


async def deliver(send: Callable[[], Awaitable[int]]) -> tuple[str, int | None, str | None, float | None]:
    try:
        return "sent", await send(), None, None
    except TelegramRetryAfter as exc:
        return "retry", None, f"retry after {exc.retry_after}s", float(exc.retry_after)
    except TelegramForbiddenError as exc:
        return "blocked", None, exc.message, None
    except TelegramBadRequest as exc:
        return "failed", None, exc.message, None
    except (TelegramNetworkError, TelegramServerError) as exc:
        return "retry", None, str(exc), None
    except Exception as exc:
        log.exception("delivery error")
        return "retry", None, str(exc), None


async def process_notifications(bot: Bot, batch: int = 20) -> int:
    async with sessionmaker()() as session:
        rows = list(
            (
                await session.execute(
                    select(Notification)
                    .where(Notification.status == "queued", Notification.next_attempt_at <= func.now())
                    .order_by(Notification.id)
                    .limit(batch)
                    .with_for_update(skip_locked=True).execution_options(populate_existing=True)
                )
            ).scalars()
        )
        for notification in rows:
            outcome, message_id, error, retry_after = await deliver(lambda n=notification: send_notification(bot, n))
            notification.attempts += 1
            if outcome == "sent":
                notification.status = "sent"
                notification.sent_at = utcnow()
                notification.telegram_message_id = message_id
                notification.last_error = None
            elif outcome == "retry" and notification.attempts < MAX_ATTEMPTS:
                delay = retry_after if retry_after is not None else min(30 * 2 ** notification.attempts, 3600)
                notification.next_attempt_at = utcnow() + timedelta(seconds=delay)
                notification.last_error = error
            else:
                notification.status = "failed"
                notification.last_error = error
                if outcome == "blocked":
                    await session.execute(update(User).where(User.id == notification.user_id).values(bot_blocked=True))
            await asyncio.sleep(0.04)
        await session.commit()
        return len(rows)


async def process_broadcasts(bot: Bot, batch: int = 25) -> int:
    async with sessionmaker()() as session:
        broadcast = (
            await session.execute(
                select(Broadcast).where(Broadcast.status.in_(("queued", "sending"))).order_by(Broadcast.id).limit(1).with_for_update(skip_locked=True).execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if broadcast is None:
            return 0
        if broadcast.status == "queued":
            broadcast.status = "sending"
            broadcast.started_at = utcnow()
        recipients = list(
            (
                await session.execute(
                    select(User.id)
                    .where(User.id > broadcast.cursor_user_id, analytics.recipients_condition(broadcast.audience))
                    .order_by(User.id)
                    .limit(batch)
                )
            ).scalars()
        )
        if not recipients:
            broadcast.status = "done"
            broadcast.finished_at = utcnow()
            await session.commit()
            return 0
        for user_id in recipients:
            for _ in range(3):
                outcome, _, error, retry_after = await deliver(lambda u=user_id: send_broadcast(bot, u, broadcast))
                if outcome == "retry" and retry_after is not None:
                    await asyncio.sleep(min(retry_after, 60))
                    continue
                break
            if outcome == "sent":
                broadcast.sent += 1
            else:
                broadcast.failed += 1
                if outcome == "blocked":
                    await session.execute(update(User).where(User.id == user_id).values(bot_blocked=True))
            broadcast.cursor_user_id = user_id
            await asyncio.sleep(0.04)
        await session.commit()
        return len(recipients)


async def process_auto_withdrawals(bot: Bot) -> int:
    async with sessionmaker()() as session:
        settings = await settings_store.load(session)
        if not settings.bool("withdraw_auto") or not settings.bool("withdrawals_enabled"):
            return 0
        ids = await withdrawals.due_auto(session)
    processed = 0
    for withdrawal_id in ids:
        async with sessionmaker()() as session:
            try:
                await withdrawals.send_gift(session, bot, withdrawal_id, None)
                processed += 1
            except withdrawals.WithdrawalError as exc:
                await session.rollback()
                log.warning("auto withdrawal %s: %s", withdrawal_id, exc)
                if exc.code == "uncertain":
                    return processed
    return processed


async def reevaluate_referrals() -> None:
    async with sessionmaker()() as session:
        settings = await settings_store.load(session)
        for invitee_id in await referrals.pending_invitees(session):
            await referrals.evaluate(session, invitee_id, settings)
        await session.commit()


async def loop(name: str, interval: float, job: Callable[[], Awaitable[object]]) -> None:
    while True:
        try:
            result = await job()
            idle = not result
        except Exception:
            log.exception("job %s failed", name)
            idle = True
        await asyncio.sleep(interval if idle else 0.2)


async def configure_bot(bot: Bot) -> None:
    try:
        await bot.set_my_commands([BotCommand(command="start", description="Открыть ZUBA RUBA"), BotCommand(command="paysupport", description="Вопросы по выводу")])
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Открыть", web_app=WebAppInfo(url=webapp_url())))
        if (await bot.get_my_name()).name != BOT_NAME:
            await bot.set_my_name(name=BOT_NAME)
        if (await bot.get_my_short_description()).short_description != SHORT_DESCRIPTION:
            await bot.set_my_short_description(short_description=SHORT_DESCRIPTION)
        if (await bot.get_my_description()).description != DESCRIPTION:
            await bot.set_my_description(description=DESCRIPTION)
    except Exception:
        log.exception("bot configuration failed")


async def wait_for_telegram(bot: Bot) -> None:
    delay = 5
    while True:
        try:
            await bot.delete_webhook(drop_pending_updates=False)
            return
        except (TelegramNetworkError, TelegramServerError, TelegramRetryAfter) as exc:
            log.warning("telegram unavailable, retry in %ss: %s", delay, exc)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)


async def main() -> None:
    config = get_config()
    setup_logging(config.log_level)
    init_engine()
    bot = Bot(config.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
    flyer = FlyerClient(config.flyer_api_key, config.flyer_base_url)
    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    jobs: list[asyncio.Task] = []
    try:
        jobs = [
            asyncio.create_task(loop("completions", 30, lambda: process_due_completions(flyer))),
            asyncio.create_task(loop("boosts", 60, lambda: process_due_boosts(flyer))),
            asyncio.create_task(loop("notifications", 2, lambda: process_notifications(bot))),
            asyncio.create_task(loop("broadcasts", 3, lambda: process_broadcasts(bot))),
            asyncio.create_task(loop("referrals", 3600, reevaluate_referrals)),
            asyncio.create_task(loop("withdrawals", 20, lambda: process_auto_withdrawals(bot))),
        ]
        log.info("worker started")
        await wait_for_telegram(bot)
        await configure_bot(bot)
        await dispatcher.start_polling(bot, allowed_updates=["message", "my_chat_member", "pre_checkout_query"], handle_signals=True)
    finally:
        for job in jobs:
            job.cancel()
        await flyer.close()
        await bot.session.close()
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
