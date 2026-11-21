from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import notify
from .models import DevProfile, Project, User
from .serial import dev_payloads

LEVEL_RANK = {"top": 2, "verified": 1, "new": 0}


def fit(p: Project, categories: list, stack: list) -> int:
    want = {x.lower() for x in (p.stack or [])}
    score = 3 if p.category in (categories or []) else 0
    score += len(want & {x.lower() for x in (stack or [])})
    return score


async def matches(s: AsyncSession, p: Project, limit: int = 5) -> list[dict]:
    rows = (await s.execute(select(DevProfile, User).join(User, User.id == DevProfile.user_id)
                            .where(DevProfile.moderation == "published", User.id != p.client_id))).all()
    scored = [(fit(p, prof.categories, prof.stack), prof, u) for prof, u in rows if not u.banned()]
    scored = [x for x in scored if x[0] > 0]
    if not scored:
        return []
    by_id = {u.id: sc for sc, _, u in scored}
    devs = await dev_payloads(s, [(prof, u) for _, prof, u in scored])
    devs.sort(key=lambda d: (not d["pro"], -by_id[int(d["id"])], -LEVEL_RANK[d["level"]], -d["rating"], -d["deals"], d["lastSeenMin"]))
    return devs[:limit]


async def after_publish(s: AsyncSession, p: Project) -> None:
    picks = await matches(s, p, 5)
    if picks:
        notify.send_matches(p.client_id, p, picks)
    pros = (await s.execute(select(DevProfile, User).join(User, User.id == DevProfile.user_id)
                            .where(DevProfile.moderation == "published", User.id != p.client_id,
                                   User.alerts.is_(True), User.bot_started.is_(True)))).all()
    for prof, u in pros:
        if u.pro() and not u.banned() and fit(p, prof.categories, prof.stack):
            notify.send_project(u.id, p, "Новый проект по вашему стеку")
