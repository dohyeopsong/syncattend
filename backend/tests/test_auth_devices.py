"""Tests: login/refresh + device register(409)/reregister/getMyDevice."""
import uuid

from tests.conftest import auth_header, seed_user


async def test_login_success_and_refresh(client, session):
    user = await seed_user(session, "s1@wku.ac.kr", "pw123456", "student")
    r = await client.post(
        "/auth/login", json={"email": "s1@wku.ac.kr", "password": "pw123456"}
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["role"] == "student"
    assert data["access_token"] and data["refresh_token"]

    r2 = await client.post("/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert r2.status_code == 200
    assert r2.json()["access_token"]


async def test_login_wrong_password(client, session):
    await seed_user(session, "s2@wku.ac.kr", "pw123456", "student")
    r = await client.post(
        "/auth/login", json={"email": "s2@wku.ac.kr", "password": "wrong"}
    )
    assert r.status_code == 401


async def test_refresh_rejects_access_token(client, session):
    user = await seed_user(session, "s3@wku.ac.kr", "pw123456", "student")
    login = (
        await client.post(
            "/auth/login", json={"email": "s3@wku.ac.kr", "password": "pw123456"}
        )
    ).json()
    # passing an access_token where a refresh_token is required must fail
    r = await client.post("/auth/refresh", json={"refresh_token": login["access_token"]})
    assert r.status_code == 401


async def test_device_register_then_conflict(client, session):
    user = await seed_user(session, "s4@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    u1 = str(uuid.uuid4())

    r = await client.post("/devices/register", json={"device_uuid": u1}, headers=hdr)
    assert r.status_code == 200, r.text
    assert r.json()["device_uuid"] == u1

    # same uuid again → idempotent 200
    r2 = await client.post("/devices/register", json={"device_uuid": u1}, headers=hdr)
    assert r2.status_code == 200

    # different uuid on an already-bound account → 409 (email re-auth required)
    r3 = await client.post(
        "/devices/register", json={"device_uuid": str(uuid.uuid4())}, headers=hdr
    )
    assert r3.status_code == 409


async def test_get_my_device(client, session):
    user = await seed_user(session, "s5@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    u1 = str(uuid.uuid4())
    await client.post("/devices/register", json={"device_uuid": u1}, headers=hdr)
    r = await client.get("/devices/me", headers=hdr)
    assert r.status_code == 200
    assert r.json()["device_uuid"] == u1


async def test_reregister_flow_rebinds(client, session):
    from app.redis_client import get_redis

    user = await seed_user(session, "s6@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    old_uuid = str(uuid.uuid4())
    await client.post("/devices/register", json={"device_uuid": old_uuid}, headers=hdr)

    # request a code (@wku.ac.kr enforced + must match account email)
    r = await client.post(
        "/devices/reregister/request", json={"email": "s6@wku.ac.kr"}, headers=hdr
    )
    assert r.status_code == 202

    # read the code straight from redis (dev/test delivery)
    code = await get_redis().get("reregister:code:s6@wku.ac.kr")
    assert code is not None

    new_uuid = str(uuid.uuid4())
    r2 = await client.post(
        "/devices/reregister/confirm",
        json={"email": "s6@wku.ac.kr", "code": code, "new_device_uuid": new_uuid},
        headers=hdr,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["device_uuid"] == new_uuid

    # binding now reflects the new uuid
    me = (await client.get("/devices/me", headers=hdr)).json()
    assert me["device_uuid"] == new_uuid


async def test_reregister_rejects_non_school_email(client, session):
    user = await seed_user(session, "s7@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    r = await client.post(
        "/devices/reregister/request", json={"email": "s7@gmail.com"}, headers=hdr
    )
    assert r.status_code == 400
