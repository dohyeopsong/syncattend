# CLAUDE.md — backend/

`backend/`는 Syncattend의 FastAPI async API 서버입니다. 인증·기기 바인딩·강좌·세션·출석·SSE와 ORM 모델을 포함합니다.

## 구조

- `app/main.py`: FastAPI 앱, CORS, request ID middleware, health check, router 등록
- `app/routers/`: `auth`, `devices`, `courses`, `sessions`, `attendance`, `sse`
- `app/services/`: 토큰 발급/교차 검증, 출석 집계, Redis 이벤트, 이메일 코드, session estimate, simulation
- `app/models.py`: SQLAlchemy ORM
- `app/schemas.py`: Pydantic request/response schema
- `app/config.py`: 환경 변수 기반 settings
- `tests/`: SQLite + fakeredis 기반 unit/integration 성격 테스트
- `migrations/`: Docker PostgreSQL 첫 초기화용 SQL `0001`–`0008`
- `migrations_alembic/`: Alembic 환경 설정

## 실행

현재 작업 트리에는 `backend/.env.example`이 없으므로 복사 명령을 사용하지 않습니다. `backend/.env` 또는 셸 환경 변수에 다음을 설정합니다.

```dotenv
DATABASE_URL=postgresql+asyncpg://sdas:sdas@localhost:5432/sdas
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=change-this-in-development
CORS_ORIGINS=http://localhost:5173
```

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/health
```

`infra/docker-compose.yml`을 사용하면 PostgreSQL, Redis, backend를 함께 실행할 수 있습니다.

```bash
docker compose -f ../infra/docker-compose.yml up --build
```

## 테스트

```bash
cd backend
.venv/bin/pytest -q
```

테스트 설정은 `tests/conftest.py`에서 SQLite in-memory와 fakeredis를 사용하고 이메일 provider를 비웁니다. 따라서 테스트 성공만으로 실제 PostgreSQL schema, Redis 네트워크, Render startup, 동시 insert를 모두 증명하지 않습니다. 동시성 관련 DB 행 수와 migration은 실제 PostgreSQL Compose 환경에서도 별도 확인합니다.

## API 계약

`../contracts/openapi.yaml`은 backend와 모든 클라이언트가 공유하는 계약입니다. 현재 backend operation ID와 계약 operation ID는 각각 42개이며 정합합니다.

```bash
cd ..
python3 scripts/check_contract.py
```

endpoint, request/response field, status code를 변경하면 계약을 같은 작업에서 갱신하고 위 검사를 실행합니다. 계약에 없는 동작을 클라이언트나 서버에 임의로 추가하지 않습니다.

## 도메인 규칙

- QR과 audio nonce는 Redis에서 기본 15초 TTL로 회전하고 발급 쌍을 교차 검증합니다.
- audio protocol은 제품 기준 18.5–20kHz, 16 slots, 60ms symbol, slot 15 start marker입니다. audio nonce는 `0–e` 문자만 사용하는 8자리 hex이며 `f`는 marker와 충돌하므로 사용하지 않습니다.
- 인증 윈도 기본값은 60초입니다.
- 출석 unique 제약은 계정 기준과 기기 UUID 기준을 각각 적용합니다.
- `check_in`과 `check_out`은 별도 phase입니다. `checkout_opened`는 1차 종료 후 2차 재오픈 가능 상태를 구분합니다.
- 신규/변경 기기는 `@wku.ac.kr` 재인증을 통과해야 합니다.
- SSE는 DB polling이 아니라 Redis pub/sub 이벤트를 사용합니다.

## 이메일 provider

`app/services/email_codes.py`의 전달 순서는 다음과 같습니다.

1. `RESEND_API_KEY` 설정: Resend HTTPS API
2. `SMTP_USER`와 `SMTP_PASSWORD` 설정: SMTP fallback
3. 둘 다 없음: 개발 로그 stub

Resend 발신 주소(`RESEND_FROM`)는 verified sender/domain이어야 합니다. provider 오류는 HTTP 500으로 명시적으로 반환하며 성공으로 위장하지 않습니다.

## 배포와 schema

`render_start.sh`는 현재 ORM으로 `Base.metadata.create_all`을 실행하고 `python -m scripts.seed_e2e`를 시도한 뒤 `$PORT`에 Uvicorn을 실행합니다. `create_all`은 이미 존재하는 테이블을 변경하지 않으므로 장기 운영 DB의 schema 변경 자동 적용 수단이 아닙니다.

로컬 Compose는 PostgreSQL named volume이 처음 만들어질 때 `backend/migrations/*.sql`을 init script로 적용합니다. 기존 volume에는 새 SQL이 자동 재적용되지 않습니다. schema를 변경할 때는 raw SQL, ORM, Alembic/운영 적용 절차를 함께 검토합니다.

## 변경 범위와 안전

- 구현 변경과 직접 관련된 테스트를 추가·수정합니다.
- secrets, 실제 계정, production token을 코드나 문서에 넣지 않습니다.
- `rm -rf`, `git reset --hard`, `DROP TABLE`, `DROP DATABASE`는 확인 없이 실행하지 않습니다.
- 다른 폴더의 변경이 필요하면 모노레포 전체 정합성을 확인하되, 불필요한 대규모 리팩터링은 하지 않습니다.
