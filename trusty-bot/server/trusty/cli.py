import asyncio
import sys

from sqlalchemy import func, select

from .db import Session, init_db
from .models import Complaint, Deal, DevProfile, Project, User


async def main(argv: list[str]) -> int:
    await init_db()
    cmd = argv[0] if argv else "help"
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
            print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
