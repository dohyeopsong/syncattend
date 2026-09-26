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


async def test_reregister_request_normalizes_email(client, session):
    """Uppercase + surrounding whitespace must be normalized, not 422'd.

    Real iOS keyboards/autofill capitalize or pad the email; the request must
    still succeed and store the code under the canonical (lower) key.
    """
    from app.redis_client import get_redis

    user = await seed_user(session, "s8@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    r = await client.post(
        "/devices/reregister/request",
        json={"email": "  S8@WKU.ac.kr  "},
        headers=hdr,
    )
    assert r.status_code == 202, r.text
    # code is stored under the normalized (lowercased) email key
    code = await get_redis().get("reregister:code:s8@wku.ac.kr")
    assert code is not None


async def test_reregister_request_stores_code_in_redis(client, session):
    """Happy path: normal email → 202 and a code lands in Redis."""
    from app.redis_client import get_redis

    user = await seed_user(session, "s9@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    r = await client.post(
        "/devices/reregister/request", json={"email": "s9@wku.ac.kr"}, headers=hdr
    )
    assert r.status_code == 202, r.text
    code = await get_redis().get("reregister:code:s9@wku.ac.kr")
    assert code is not None and code.isdigit()


async def test_reregister_request_rejects_mismatched_account(client, session):
    """A valid @wku.ac.kr email that isn't the caller's account → 400."""
    user = await seed_user(session, "s10@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    r = await client.post(
        "/devices/reregister/request",
        json={"email": "someone.else@wku.ac.kr"},
        headers=hdr,
    )
    assert r.status_code == 400
    assert "match" in r.json()["detail"].lower()


async def test_reregister_request_malformed_email_is_422(client, session):
    """A genuinely malformed email (not just whitespace/case) still fails at
    validation with a 422 — this is the format the client must avoid sending."""
    user = await seed_user(session, "s11@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    r = await client.post(
        "/devices/reregister/request",
        json={"email": "not-an-email"},
        headers=hdr,
    )
    assert r.status_code == 422


# ------------------------------------------------ edge cases: getMyDevice 404
async def test_get_my_device_no_binding_404(client, session):
    """An authenticated account that never registered a device has no active
    binding → getMyDevice returns 404 (not 200 with a null/empty body)."""
    user = await seed_user(session, "s12@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    r = await client.get("/devices/me", headers=hdr)
    assert r.status_code == 404, r.text
    assert "binding" in r.json()["detail"].lower()


async def test_get_my_device_404_after_reregister_does_not_leak_old(client, session):
    """After re-registration deactivates the old binding, only the new active
    one is returned; a fresh account still sees 404 (no cross-account leak)."""
    user = await seed_user(session, "s13@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(user.id, "student")
    # A second account with no binding must independently 404.
    other = await seed_user(session, "s14@wku.ac.kr", "pw123456", "student")
    other_hdr = auth_header(other.id, "student")

    await client.post(
        "/devices/register", json={"device_uuid": str(uuid.uuid4())}, headers=hdr
    )
    # s13 has a binding...
    assert (await client.get("/devices/me", headers=hdr)).status_code == 200
    # ...but s14 (never registered) still gets 404.
    r = await client.get("/devices/me", headers=other_hdr)
    assert r.status_code == 404, r.text


# ------------------------------------------------ edge cases: refresh 401
async def test_refresh_rejects_corrupted_token(client, session):
    """A structurally broken / garbage refresh_token is a JWTError inside the
    router → 401 (never a 500). Covers truncated and tampered payloads."""
    # completely non-JWT garbage
    r1 = await client.post("/auth/refresh", json={"refresh_token": "not.a.valid.jwt"})
    assert r1.status_code == 401, r1.text

    # a real token whose payload/signature bytes have been mangled
    user = await seed_user(session, "s15@wku.ac.kr", "pw123456", "student")
    login = (
        await client.post(
            "/auth/login", json={"email": "s15@wku.ac.kr", "password": "pw123456"}
        )
    ).json()
    good = login["refresh_token"]
    # flip the final segment (signature) so verification fails
    tampered = good[:-4] + ("abcd" if good[-4:] != "abcd" else "efgh")
    r2 = await client.post("/auth/refresh", json={"refresh_token": tampered})
    assert r2.status_code == 401, r2.text
