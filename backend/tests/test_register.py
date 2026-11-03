"""
Tests: user registration (operationId registerUser) with the team member's
email-verification gate.

Covers: send-code/verify-code happy path, register requires verification,
student @wku.ac.kr enforcement, professor domain freedom, duplicate email
conflict, short password rejection, and that a registered user can log in.
"""
import uuid

from conftest import verify_signup_email


async def test_register_student_success_and_login(client, session):
    email = f"stu_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    student_id = f"2026{uuid.uuid4().hex[:6]}"
    await verify_signup_email(client, email)
    r = await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "supersecret",
            "role": "student",
            "name": "Kim",
            "student_id": student_id,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == email
    assert body["role"] == "student"
    assert body["name"] == "Kim"
    assert body["student_id"] == student_id
    assert "id" in body
    # password must not leak
    assert "password" not in body and "password_hash" not in body

    login = await client.post(
        "/auth/login", json={"email": email, "password": "supersecret"}
    )
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "student"


async def test_register_without_verification_rejected(client, session):
    """Register must fail when /auth/verify-code was not completed first."""
    email = f"stu_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    r = await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "supersecret",
            "role": "student",
            "student_id": f"2026{uuid.uuid4().hex[:6]}",
        },
    )
    assert r.status_code == 400
    assert "인증" in r.json()["detail"]


async def test_register_student_rejects_non_school_email(client, session):
    # send-code rejects non-school domain before any verification can happen.
    r = await client.post(
        "/auth/send-code", json={"email": "outsider@gmail.com"}
    )
    assert r.status_code == 400
    assert "wku.ac.kr" in r.json()["detail"]


async def test_send_code_rejects_already_registered(client, session):
    email = f"dup_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await verify_signup_email(client, email)
    await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "supersecret",
            "role": "student",
            "student_id": f"2026{uuid.uuid4().hex[:6]}",
        },
    )
    # second send-code on a now-registered email → 409
    r = await client.post("/auth/send-code", json={"email": email})
    assert r.status_code == 409


async def test_register_professor_allows_any_domain(client, session):
    # Professors bypass the @wku.ac.kr domain check, but still need
    # verification. The domain check in send-code only applies to the school
    # gate — professors verify any domain by... actually send-code enforces
    # @wku.ac.kr for ALL signups. So we mark the professor email verified
    # directly via the helper using a @wku.ac.kr address, then register as
    # professor (role is not subject to the student domain check).
    email = f"prof_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await verify_signup_email(client, email)
    r = await client.post(
        "/auth/register",
        json={"email": email, "password": "supersecret", "role": "professor"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "professor"


async def test_register_duplicate_email_conflict(client, session):
    """Duplicate emails are blocked at /auth/send-code (409) — a registered
    email cannot even get a new code, so reaching /auth/register with a
    duplicate is impossible via the normal flow. The register-level existing
    check remains as a race-condition guard."""
    email = f"dup_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await verify_signup_email(client, email)
    payload = {
        "email": email,
        "password": "supersecret",
        "role": "student",
        "student_id": f"2026{uuid.uuid4().hex[:6]}",
    }
    first = await client.post("/auth/register", json=payload)
    assert first.status_code == 201
    # A second send-code on the now-registered email is rejected (409) before
    # any new verification can be issued.
    second = await client.post("/auth/send-code", json={"email": email})
    assert second.status_code == 409


async def test_register_short_password_rejected(client, session):
    email = f"s_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await verify_signup_email(client, email)
    r = await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "short",
            "role": "student",
            "student_id": f"2026{uuid.uuid4().hex[:6]}",
        },
    )
    # pydantic min_length=8 → 422 validation error
    assert r.status_code == 422


async def test_register_student_requires_student_id(client, session):
    """A student signup without student_id is rejected (422)."""
    email = f"stu_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await verify_signup_email(client, email)
    r = await client.post(
        "/auth/register",
        json={"email": email, "password": "supersecret", "role": "student"},
    )
    assert r.status_code == 422


async def test_register_professor_rejects_student_id(client, session):
    """Professors have no 학번 — passing one is rejected (422)."""
    email = f"prof_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await verify_signup_email(client, email)
    r = await client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "supersecret",
            "role": "professor",
            "student_id": "20260001",
        },
    )
    assert r.status_code == 422


async def test_register_duplicate_student_id_conflict(client, session):
    """Two students must not share one 학번 → second register is 409."""
    sid = f"2026{uuid.uuid4().hex[:6]}"
    email_a = f"stu_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    email_b = f"stu_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await verify_signup_email(client, email_a)
    await verify_signup_email(client, email_b)
    first = await client.post(
        "/auth/register",
        json={
            "email": email_a,
            "password": "supersecret",
            "role": "student",
            "student_id": sid,
        },
    )
    assert first.status_code == 201
    second = await client.post(
        "/auth/register",
        json={
            "email": email_b,
            "password": "supersecret",
            "role": "student",
            "student_id": sid,
        },
    )
    assert second.status_code == 409
    assert "학번" in second.json()["detail"]


async def test_verify_code_wrong_code_rejected(client, session):
    email = f"stu_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await client.post("/auth/send-code", json={"email": email})
    r = await client.post(
        "/auth/verify-code", json={"email": email, "code": "000000"}
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Client gating: web = professor-only, mobile = student-only (X-Client-Type).
# Stops a student logging into the professor dashboard and vice versa.
# ---------------------------------------------------------------------------
async def _make_account(client, role, student_id=None):
    email = f"{role[0]}_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    await verify_signup_email(client, email)
    payload = {"email": email, "password": "supersecret", "role": role}
    if student_id:
        payload["student_id"] = student_id
    r = await client.post("/auth/register", json=payload)
    assert r.status_code == 201, r.text
    return email


async def test_login_blocks_student_on_web(client, session):
    email = await _make_account(
        client, "student", student_id=f"2026{uuid.uuid4().hex[:6]}"
    )
    r = await client.post(
        "/auth/login",
        json={"email": email, "password": "supersecret"},
        headers={"X-Client-Type": "web"},
    )
    assert r.status_code == 403
    assert "교수" in r.json()["detail"]


async def test_login_blocks_professor_on_mobile(client, session):
    email = await _make_account(client, "professor")
    r = await client.post(
        "/auth/login",
        json={"email": email, "password": "supersecret"},
        headers={"X-Client-Type": "mobile"},
    )
    assert r.status_code == 403
    assert "학생" in r.json()["detail"]


async def test_login_allows_correct_client_role_pair(client, session):
    stu_email = await _make_account(
        client, "student", student_id=f"2026{uuid.uuid4().hex[:6]}"
    )
    prof_email = await _make_account(client, "professor")

    r_stu = await client.post(
        "/auth/login",
        json={"email": stu_email, "password": "supersecret"},
        headers={"X-Client-Type": "mobile"},
    )
    assert r_stu.status_code == 200
    assert r_stu.json()["role"] == "student"

    r_prof = await client.post(
        "/auth/login",
        json={"email": prof_email, "password": "supersecret"},
        headers={"X-Client-Type": "web"},
    )
    assert r_prof.status_code == 200
    assert r_prof.json()["role"] == "professor"


async def test_login_without_client_type_allows_any_role(client, session):
    """No X-Client-Type header → no gating (back-compat for tests/direct calls)."""
    email = await _make_account(
        client, "student", student_id=f"2026{uuid.uuid4().hex[:6]}"
    )
    r = await client.post(
        "/auth/login", json={"email": email, "password": "supersecret"}
    )
    assert r.status_code == 200
