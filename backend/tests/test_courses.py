"""
Tests: courses + enrollments (createCourse, listCourses, enrollStudent, listEnrollments).

Covers ownership guards, role guards, duplicate-enrollment conflict, and
cross-professor isolation.
"""
import uuid

from tests.conftest import auth_header, seed_user


async def _prof(session):
    return await seed_user(session, f"p_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="professor")


async def _student(session):
    return await seed_user(session, f"s_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")


async def test_create_and_list_course(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post("/courses", json={"name": "CS101"}, headers=hdr)
    assert r.status_code == 201, r.text
    course = r.json()
    assert course["name"] == "CS101"
    assert course["professor_id"] == prof.id

    listed = await client.get("/courses", headers=hdr)
    assert listed.status_code == 200
    assert any(c["id"] == course["id"] for c in listed.json())


async def test_student_cannot_create_course(client, session):
    stu = await _student(session)
    r = await client.post(
        "/courses", json={"name": "X"}, headers=auth_header(stu.id, "student")
    )
    assert r.status_code == 403


async def test_enroll_and_list_enrollments(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    hdr = auth_header(prof.id, "professor")
    course = (await client.post("/courses", json={"name": "CS101"}, headers=hdr)).json()

    r = await client.post(
        f"/courses/{course['id']}/enrollments",
        json={"student_id": stu.id},
        headers=hdr,
    )
    assert r.status_code == 201, r.text
    assert r.json() == {"course_id": course["id"], "student_id": stu.id}

    listed = await client.get(f"/courses/{course['id']}/enrollments", headers=hdr)
    assert listed.status_code == 200
    assert [e["student_id"] for e in listed.json()] == [stu.id]


async def test_enroll_duplicate_conflict(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    hdr = auth_header(prof.id, "professor")
    course = (await client.post("/courses", json={"name": "CS101"}, headers=hdr)).json()

    body = {"student_id": stu.id}
    assert (
        await client.post(f"/courses/{course['id']}/enrollments", json=body, headers=hdr)
    ).status_code == 201
    dup = await client.post(
        f"/courses/{course['id']}/enrollments", json=body, headers=hdr
    )
    assert dup.status_code == 409


async def test_enroll_rejects_non_student(client, session):
    prof = await _prof(session)
    other_prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    course = (await client.post("/courses", json={"name": "CS101"}, headers=hdr)).json()
    r = await client.post(
        f"/courses/{course['id']}/enrollments",
        json={"student_id": other_prof.id},
        headers=hdr,
    )
    assert r.status_code == 400


async def test_cannot_enroll_into_other_professors_course(client, session):
    owner = await _prof(session)
    intruder = await _prof(session)
    stu = await _student(session)
    course = (
        await client.post(
            "/courses", json={"name": "CS101"}, headers=auth_header(owner.id, "professor")
        )
    ).json()
    r = await client.post(
        f"/courses/{course['id']}/enrollments",
        json={"student_id": stu.id},
        headers=auth_header(intruder.id, "professor"),
    )
    assert r.status_code == 403


async def test_enroll_missing_course_404(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    r = await client.post(
        f"/courses/{uuid.uuid4()}/enrollments",
        json={"student_id": stu.id},
        headers=auth_header(prof.id, "professor"),
    )
    assert r.status_code == 404
