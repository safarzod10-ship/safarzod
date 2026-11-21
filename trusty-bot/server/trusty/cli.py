import asyncio
import sys
from pathlib import Path

from sqlalchemy import func, select

from .db import Session, init_db
from .models import Complaint, Deal, DevProfile, Project, User


USAGE = "trusty setup | stats | admins | admin-remove <id> | unban <id>"
DESCRIPTION = ("Безопасный сервис для проведения сделок. Простой и удобный инструмент для прозрачного сотрудничества, "
               "фиксации договорённостей и комфортной работы на каждом этапе.")
SHORT_DESCRIPTION = "Безопасные сделки с разработчиками. Оплата в USDT через гаранта, после приёмки работы."
AVATAR = Path(__file__).resolve().parents[2] / "brand" / "logo" / "png" / "telegram-avatar-640.jpg"


async def setup_bot() -> int:
    from aiogram import Bot
    from aiogram.types import BufferedInputFile, InputProfilePhotoStatic, MenuButtonWebApp, WebAppInfo

    from .config import settings
    bot = Bot(settings.bot_token)
    failed = False

    async def step(label: str, coro) -> None:
        nonlocal failed
        try:
            res = await coro
            print(f"  ✓ {label}" + (f" ({res})" if isinstance(res, str) else ""))
        except Exception as e:  # noqa: BLE001
            failed = True
            print(f"  ✗ {label}: {e}")

    async def description():
        if (await bot.get_my_description()).description != DESCRIPTION:
            await bot.set_my_description(description=DESCRIPTION)
        if (await bot.get_my_short_description()).short_description != SHORT_DESCRIPTION:
            await bot.set_my_short_description(short_description=SHORT_DESCRIPTION)

    async def avatar():
        me = await bot.get_me()
        if (await bot.get_user_profile_photos(me.id, limit=1)).total_count:
            return "уже стоит"
        if not AVATAR.exists():
            return "нет файла"
        photo = BufferedInputFile(AVATAR.read_bytes(), "avatar.jpg")
        await bot.set_my_profile_photo(photo=InputProfilePhotoStatic(photo=photo))

    async def menu():
        if not settings.public_url:
            return "нет адреса Mini App"
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Открыть", web_app=WebAppInfo(url=settings.public_url + "/")))

    try:
        me = await bot.get_me()
        print(f"Оформление @{me.username}")
        await step("Описание", description())
        await step("Аватар", avatar())
        await step("Кнопка «Открыть» у поля ввода", menu())
        await step("Команды убраны", bot.delete_my_commands())
        me = await bot.get_me()
        todo = []
        if not me.supports_inline_queries:
            todo.append(f"/setinline -> @{me.username} -> Имя или @username исполнителя")
        if not me.has_main_web_app:
            todo.append(f"/mybots -> @{me.username} -> Bot Settings -> Configure Mini App -> Enable Mini App -> {settings.public_url}")
        if todo:
            print("Осталось в @BotFather (у Telegram нет для этого команды по токену):")
            for i, t in enumerate(todo, 1):
                print(f"  {i}. {t}")
        else:
            print("  ✓ Поиск в чатах и Mini App по ссылке включены")
    finally:
        await bot.session.close()
    return 1 if failed else 0


async def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "help"
    if cmd == "setup":
        return await setup_bot()
    await init_db()
    async with Session() as s:
        if cmd == "admins":
            for u in (await s.execute(select(User).where(User.is_admin.is_(True)))).scalars():
                print(u.id, u.name, f"@{u.username}" if u.username else "")
        elif cmd == "admin-remove" and len(argv) == 2:
            u = await s.get(User, int(argv[1]))
            if not u:
                print("no such user")
                return 1
            u.is_admin = False
            await s.commit()
            print("removed", u.id, u.name)
        elif cmd == "unban" and len(argv) == 2:
            u = await s.get(User, int(argv[1]))
            if not u:
                print("no such user")
                return 1
            u.ban_permanent, u.ban_until = False, None
            await s.commit()
            print("unbanned", u.id, u.name)
        elif cmd == "stats":
            for label, model in (("users", User), ("developers", DevProfile), ("projects", Project), ("deals", Deal),
                                 ("complaints", Complaint)):
                print(f"{label:12}", (await s.execute(select(func.count()).select_from(model))).scalar_one())
        else:
            print(USAGE)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
