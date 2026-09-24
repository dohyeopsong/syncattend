"""
Tests: user registration (operationId registerUser).

Covers: student @wku.ac.kr enforcement, professor domain freedom, duplicate
email conflict, and that a registered user can then log in.
"""
import uuid


async def test_register_student_success_and_login(client, session):
    email = f"stu_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    r = await client.post(
        "/auth/register",
        json={"email": email, "password": "supersecret", "role": "student", "name": "Kim"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == email
    assert body["role"] == "student"
    assert body["name"] == "Kim"
    assert "id" in body
    # password must not leak
    assert "password" not in body and "password_hash" not in body

    login = await client.post(
        "/auth/login", json={"email": email, "password": "supersecret"}
    )
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "student"


async def test_register_student_rejects_non_school_email(client, session):
    r = await client.post(
        "/auth/register",
        json={"email": "outsider@gmail.com", "password": "supersecret", "role": "student"},
    )
    assert r.status_code == 400
    assert "wku.ac.kr" in r.json()["detail"]


async def test_register_professor_allows_any_domain(client, session):
    email = f"prof_{uuid.uuid4().hex[:8]}@university.edu"
    r = await client.post(
        "/auth/register",
        json={"email": email, "password": "supersecret", "role": "professor"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "professor"


async def test_register_duplicate_email_conflict(client, session):
    email = f"dup_{uuid.uuid4().hex[:8]}@wku.ac.kr"
    payload = {"email": email, "password": "supersecret", "role": "student"}
    first = await client.post("/auth/register", json=payload)
    assert first.status_code == 201
    second = await client.post("/auth/register", json=payload)
    assert second.status_code == 409


async def test_register_short_password_rejected(client, session):
    r = await client.post(
        "/auth/register",
        json={"email": f"s_{uuid.uuid4().hex[:8]}@wku.ac.kr", "password": "short", "role": "student"},
    )
    # pydantic min_length=8 → 422 validation error
    assert r.status_code == 422
