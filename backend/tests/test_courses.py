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


# ------------------------------------------------ schedule fields + CRUD


def _course_payload(name="자료구조"):
    return {
        "name": name,
        "code": "374150",
        "department": "컴퓨터·소프트웨어공학과",
        "professor_name": "홍길동",
        "day_of_week": 2,
        "start_period": 3,
        "end_period": 4,
        "location": "공대 406",
        "credits": 3.0,
    }


async def test_create_course_with_schedule_fields(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post("/courses", json=_course_payload(), headers=hdr)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["code"] == "374150"
    assert c["department"] == "컴퓨터·소프트웨어공학과"
    assert c["day_of_week"] == 2
    assert c["start_period"] == 3 and c["end_period"] == 4
    assert c["location"] == "공대 406"
    assert c["credits"] == 3.0
    assert c["professor_name"] == "홍길동"


async def test_create_course_name_only_defaults_null(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post("/courses", json={"name": "이름만"}, headers=hdr)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["name"] == "이름만"
    for f in ("code", "department", "day_of_week", "credits", "location"):
        assert c[f] is None


async def test_create_course_rejects_bad_day_of_week(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post(
        "/courses", json={"name": "X", "day_of_week": 7}, headers=hdr
    )
    assert r.status_code == 422


async def test_update_course_partial(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    course = (await client.post("/courses", json=_course_payload(), headers=hdr)).json()
    r = await client.patch(
        f"/courses/{course['id']}",
        json={"location": "공대 999", "credits": 4.0},
        headers=hdr,
    )
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["location"] == "공대 999"
    assert c["credits"] == 4.0
    # untouched fields preserved
    assert c["code"] == "374150"
    assert c["day_of_week"] == 2


async def test_update_course_not_owner_403(client, session):
    owner = await _prof(session)
    intruder = await _prof(session)
    course = (
        await client.post(
            "/courses", json={"name": "CS"}, headers=auth_header(owner.id, "professor")
        )
    ).json()
    r = await client.patch(
        f"/courses/{course['id']}",
        json={"name": "hijacked"},
        headers=auth_header(intruder.id, "professor"),
    )
    assert r.status_code == 403


async def test_update_course_missing_404(client, session):
    prof = await _prof(session)
    r = await client.patch(
        f"/courses/{uuid.uuid4()}",
        json={"name": "x"},
        headers=auth_header(prof.id, "professor"),
    )
    assert r.status_code == 404


async def test_delete_course_cascades_enrollment(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    hdr = auth_header(prof.id, "professor")
    course = (await client.post("/courses", json={"name": "CS"}, headers=hdr)).json()
    await client.post(
        f"/courses/{course['id']}/enrollments",
        json={"student_id": stu.id},
        headers=hdr,
    )
    r = await client.delete(f"/courses/{course['id']}", headers=hdr)
    assert r.status_code == 204
    # course gone -> listing owner's courses no longer includes it
    listed = await client.get("/courses", headers=hdr)
    assert all(c["id"] != course["id"] for c in listed.json())


async def test_delete_course_not_owner_403(client, session):
    owner = await _prof(session)
    intruder = await _prof(session)
    course = (
        await client.post(
            "/courses", json={"name": "CS"}, headers=auth_header(owner.id, "professor")
        )
    ).json()
    r = await client.delete(
        f"/courses/{course['id']}", headers=auth_header(intruder.id, "professor")
    )
    assert r.status_code == 403


# ------------------------------------------------ catalog + self-enroll


async def test_catalog_visible_to_student_with_enrolled_flag(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    phdr = auth_header(prof.id, "professor")
    c1 = (await client.post("/courses", json={"name": "A"}, headers=phdr)).json()
    c2 = (await client.post("/courses", json={"name": "B"}, headers=phdr)).json()
    # student enrolls in c1 only
    await client.post(f"/courses/{c1['id']}/enroll-self", headers=auth_header(stu.id, "student"))

    r = await client.get("/courses/catalog", headers=auth_header(stu.id, "student"))
    assert r.status_code == 200, r.text
    catalog = {c["id"]: c for c in r.json()}
    assert catalog[c1["id"]]["enrolled"] is True
    assert catalog[c2["id"]]["enrolled"] is False


async def test_enroll_self_and_duplicate_conflict(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    course = (
        await client.post("/courses", json={"name": "A"}, headers=auth_header(prof.id, "professor"))
    ).json()
    shdr = auth_header(stu.id, "student")
    r = await client.post(f"/courses/{course['id']}/enroll-self", headers=shdr)
    assert r.status_code == 201, r.text
    assert r.json() == {"course_id": course["id"], "student_id": stu.id}
    dup = await client.post(f"/courses/{course['id']}/enroll-self", headers=shdr)
    assert dup.status_code == 409


async def test_enroll_self_missing_course_404(client, session):
    stu = await _student(session)
    r = await client.post(
        f"/courses/{uuid.uuid4()}/enroll-self", headers=auth_header(stu.id, "student")
    )
    assert r.status_code == 404


async def test_enroll_self_professor_forbidden(client, session):
    prof = await _prof(session)
    course = (
        await client.post("/courses", json={"name": "A"}, headers=auth_header(prof.id, "professor"))
    ).json()
    r = await client.post(
        f"/courses/{course['id']}/enroll-self", headers=auth_header(prof.id, "professor")
    )
    assert r.status_code == 403


async def test_unenroll_self(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    course = (
        await client.post("/courses", json={"name": "A"}, headers=auth_header(prof.id, "professor"))
    ).json()
    shdr = auth_header(stu.id, "student")
    await client.post(f"/courses/{course['id']}/enroll-self", headers=shdr)
    r = await client.delete(f"/courses/{course['id']}/enroll-self", headers=shdr)
    assert r.status_code == 204
    # unenroll again -> 404
    again = await client.delete(f"/courses/{course['id']}/enroll-self", headers=shdr)
    assert again.status_code == 404


async def test_my_courses_returns_schedule(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    phdr = auth_header(prof.id, "professor")
    c1 = (await client.post("/courses", json=_course_payload("자료구조"), headers=phdr)).json()
    c2 = (await client.post("/courses", json={"name": "미수강"}, headers=phdr)).json()
    shdr = auth_header(stu.id, "student")
    await client.post(f"/courses/{c1['id']}/enroll-self", headers=shdr)

    r = await client.get("/me/courses", headers=shdr)
    assert r.status_code == 200, r.text
    mine = r.json()
    ids = [c["id"] for c in mine]
    assert c1["id"] in ids
    assert c2["id"] not in ids
    item = next(c for c in mine if c["id"] == c1["id"])
    assert item["day_of_week"] == 2
    assert item["location"] == "공대 406"
    assert item["credits"] == 3.0


# ------------------------------------------------ period rules + validation

from app.periods import period_to_time, period_end_time, MAX_PERIOD  # noqa: E402


def test_period_to_time_helper():
    assert period_to_time(1) == "09:00"
    assert period_to_time(2) == "10:00"
    assert period_to_time(12) == "20:00"
    assert period_end_time(1) == "10:00"
    assert period_end_time(12) == "21:00"


async def test_create_course_rejects_period_out_of_range(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    # 0 is below MIN_PERIOD
    r = await client.post(
        "/courses", json={"name": "X", "start_period": 0, "end_period": 2}, headers=hdr
    )
    assert r.status_code == 422
    # 13 is above MAX_PERIOD
    r2 = await client.post(
        "/courses",
        json={"name": "X", "start_period": 1, "end_period": MAX_PERIOD + 1},
        headers=hdr,
    )
    assert r2.status_code == 422


async def test_create_course_rejects_start_after_end(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post(
        "/courses", json={"name": "X", "start_period": 5, "end_period": 3}, headers=hdr
    )
    assert r.status_code == 422


async def test_create_course_accepts_valid_periods(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post(
        "/courses",
        json={"name": "X", "start_period": 1, "end_period": 12},
        headers=hdr,
    )
    assert r.status_code == 201, r.text


async def test_update_course_rejects_inverted_period_after_merge(client, session):
    prof = await _prof(session)
    hdr = auth_header(prof.id, "professor")
    course = (
        await client.post(
            "/courses",
            json={"name": "X", "start_period": 3, "end_period": 6},
            headers=hdr,
        )
    ).json()
    # Partial update sets only start_period, inverting the stored pair (3..6 -> 9..6)
    r = await client.patch(
        f"/courses/{course['id']}", json={"start_period": 9}, headers=hdr
    )
    assert r.status_code == 422


# ------------------------------------------------ catalog search (q)


async def test_catalog_q_matches_name_case_insensitive(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    phdr = auth_header(prof.id, "professor")
    await client.post("/courses", json={"name": "파이썬프로그래밍"}, headers=phdr)
    await client.post("/courses", json={"name": "자료구조"}, headers=phdr)

    shdr = auth_header(stu.id, "student")
    r = await client.get("/courses/catalog", params={"q": "파이썬"}, headers=shdr)
    assert r.status_code == 200, r.text
    names = [c["name"] for c in r.json()]
    assert names == ["파이썬프로그래밍"]


async def test_catalog_q_matches_professor_name_and_code(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    phdr = auth_header(prof.id, "professor")
    await client.post(
        "/courses",
        json={"name": "A", "professor_name": "김교수", "code": "374142"},
        headers=phdr,
    )
    await client.post("/courses", json={"name": "B", "professor_name": "이교수"}, headers=phdr)
    shdr = auth_header(stu.id, "student")

    by_prof = await client.get("/courses/catalog", params={"q": "김교수"}, headers=shdr)
    assert [c["name"] for c in by_prof.json()] == ["A"]

    by_code = await client.get("/courses/catalog", params={"q": "374142"}, headers=shdr)
    assert [c["name"] for c in by_code.json()] == ["A"]


async def test_catalog_blank_q_returns_all(client, session):
    prof = await _prof(session)
    stu = await _student(session)
    phdr = auth_header(prof.id, "professor")
    await client.post("/courses", json={"name": "A"}, headers=phdr)
    await client.post("/courses", json={"name": "B"}, headers=phdr)
    shdr = auth_header(stu.id, "student")

    # absent q
    all_r = await client.get("/courses/catalog", headers=shdr)
    assert len(all_r.json()) == 2
    # blank q -> still all (backward compatible)
    blank_r = await client.get("/courses/catalog", params={"q": "   "}, headers=shdr)
    assert len(blank_r.json()) == 2
