from conftest import ADMIN_ID, auth, register, set_settings
from sqlalchemy import select

from app.db import sessionmaker
from app.models import User


async def test_registration_and_relogin(env):
    me = await register(env.client, 1)
    assert me["id"] == 1 and me["onboarded"] is False and me["is_admin"] is False
    assert me["ref_link"].startswith("https://t.me/zuba_ruba_bot?start=ref_")
    again = await register(env.client, 1)
    assert again["ref_link"] == me["ref_link"]
    response = await env.client.post("/api/me/onboarding", headers=auth(1))
    assert response.json()["onboarded"] is True
    assert (await env.client.get("/api/me", headers=auth(1))).json()["onboarded"] is True
    assert (await register(env.client, ADMIN_ID))["is_admin"] is True


async def test_auth_required(env):
    assert (await env.client.get("/api/me")).status_code == 401
    bad = {"Authorization": "tma user=%7B%7D&hash=deadbeef&auth_date=1"}
    response = await env.client.get("/api/me", headers=bad)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


async def test_referral_link_assignment(env):
    inviter = await register(env.client, 10)
    code = inviter["ref_link"].split("start=")[1]
    await register(env.client, 11, start_param=code)
    await register(env.client, 10, start_param=code)
    await register(env.client, 12)
    await register(env.client, 12, start_param=code)
    async with sessionmaker()() as session:
        users = {u.id: u for u in (await session.execute(select(User))).scalars()}
    assert users[11].referrer_id == 10
    assert users[10].referrer_id is None
    assert users[12].referrer_id is None
    response = await env.client.get("/api/referrals", headers=auth(10))
    assert response.json()["invited"] == 1


async def test_maintenance_and_block(env):
    await register(env.client, 5)
    await register(env.client, ADMIN_ID)
    await set_settings(maintenance=True)
    response = await env.client.get("/api/home", headers=auth(5))
    assert response.status_code == 503 and response.json()["error"]["code"] == "maintenance"
    assert (await env.client.get("/api/home", headers=auth(ADMIN_ID))).status_code == 200
    await set_settings(maintenance=False)
    response = await env.client.post("/api/admin/users/5/block", headers=auth(ADMIN_ID), json={"blocked": True, "reason": "мультиаккаунт"})
    assert response.status_code == 200
    response = await env.client.get("/api/home", headers=auth(5))
    assert response.status_code == 403 and response.json()["error"]["code"] == "blocked"
    await env.client.post("/api/admin/users/5/block", headers=auth(ADMIN_ID), json={"blocked": False})
    assert (await env.client.get("/api/home", headers=auth(5))).status_code == 200
