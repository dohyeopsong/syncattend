# CLAUDE.md — Syncattend

Syncattend는 FastAPI backend, React web, Flutter mobile로 구성된 단일 모노레포입니다. 작업 전에 `README.md`와 변경 대상 디렉터리의 README/CLAUDE 문서를 읽습니다.

## 작업 원칙

- 이 저장소는 현재 단일 작업 흐름으로 운영합니다. 폐기된 CLI A/B/C 오너 모델을 문서·코드·응답에 다시 도입하지 않습니다.
- 요구사항과 현재 코드를 먼저 대조하고, 필요한 범위만 작게 변경합니다.
- endpoint, schema, 환경 변수, 테스트 결과를 추측하지 않습니다.
- 작업 트리의 기존 변경은 보존합니다. 특히 이번 작업과 무관한 `backend/.env.example` 삭제를 되돌리지 않습니다.
- 코드 주석은 English, 기본 응답과 문서는 Korean + English 기술 용어를 사용합니다.
- 커밋이 필요할 때 메시지는 English Conventional Commits 형식을 사용합니다.
- dev server를 검증 후 종료하고, 시크릿을 코드·문서·로그에 기록하지 않습니다.

## 저장소 경계

| 경로 | 내용 |
|---|---|
| `backend/` | FastAPI API, ORM, 인증, 출석, Redis 이벤트 |
| `contracts/` | OpenAPI HTTP 계약 |
| `web/` | React/Vite 교수·학생 웹 |
| `mobile/` | Flutter 학생 앱 |
| `infra/` | Docker Compose |
| `scripts/` | 정합성·검증 스크립트 |
| `docs/` | 설계·QA·운영 문서 |

모노레포이므로 필요한 경우 여러 폴더를 함께 변경할 수 있지만, 계약 변경은 구현 변경과 같은 작업에서 검토·검증해야 합니다.

## API와 보안 불변조건

- `contracts/openapi.yaml`이 HTTP API의 단일 진실 원천입니다.
- backend와 계약은 현재 42개 operation ID로 정합합니다. `python3 scripts/check_contract.py`로 확인합니다.
- QR/audio nonce TTL은 기본 15초이며, 두 nonce는 같은 발급 쌍인지 교차 검증합니다.
- 출석 인증 윈도는 기본 60초입니다.
- 세션별로 `(session_id, student_id)`와 `(session_id, device_uuid)`가 각각 unique해야 합니다.
- 기기 식별자는 앱 생성 UUID입니다. 새 UUID는 `@wku.ac.kr` 이메일 재인증 없이 자동 바인딩하지 않습니다.
- 세션 phase는 `check_in → closed → check_out → closed` 흐름을 지원하며, `checkout_opened`로 2차 인증 가능 여부를 구분합니다.
- 출석 최종 상태는 마감 시 두 인증 timestamp에서 계산합니다. 검증 성공 직후에도 마감 전 상태는 `pending`입니다.
- 근접성은 raw location이 아니라 audio token 검증 결과로만 표현합니다.
- 제품 audio protocol은 18.5–20kHz, 16 slots, 60ms symbol, slot 15 marker, `0–e` 8자리 hex nonce입니다. emitter와 mobile decoder의 기본값을 바꿀 때는 양쪽을 함께 검증합니다.

## 로컬 실행

전체 스택:

```bash
docker compose -f infra/docker-compose.yml up --build
curl http://localhost:8000/health
```

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

현재 `backend/.env.example`은 작업 트리에 없으므로 `cp .env.example .env`를 사용하지 않습니다. 로컬 `.env`에는 최소 `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGINS`가 필요합니다. 테스트는 SQLite/fakeredis를 사용하므로 별도 DB가 없어도 실행할 수 있습니다.

Web:

```bash
cd web
npm install
npm run dev
npm run build
npm test
```

Mobile:

```bash
cd mobile
flutter pub get
flutter test
flutter analyze
flutter run --dart-define=USE_MOCK=true
```

## 검증과 보고

완료를 주장하기 전에 변경 영역의 검증을 실행하고 실제 수치를 보고합니다.

- backend: `.venv/bin/pytest -q`의 passed/failed/skipped
- web: `npm run build` 결과와 Vitest passed/failed/skipped
- mobile: Flutter passed/failed/skipped와 `flutter analyze` 결과
- contract: `scripts/check_contract.py` 결과

SQLite 테스트가 통과해도 PostgreSQL 타입, 동시성, 초기화/기존 DB 마이그레이션까지 검증된 것은 아닙니다. Docker Compose, 실제 배포, 실제 휴대폰 microphone loopback은 직접 실행한 경우에만 통과로 보고합니다.

## 운영과 위험 명령

- Render startup은 `Base.metadata.create_all` 후 seed를 시도합니다. `create_all`은 기존 테이블의 schema evolution을 수행하지 않습니다.
- 이메일은 Resend HTTPS → SMTP → 개발 로그 stub 순서입니다. 실제 발송은 verified sender/domain이 필요합니다.
- audio emitter는 `<audio>` + WAV blob 경로를 사용합니다. Safari 무음 회귀를 피하기 위해 `AudioContext`로 되돌리지 않습니다.
- `rm -rf`, `git reset --hard`, `DROP TABLE`, `DROP DATABASE`는 사용자 확인 없이 실행하지 않습니다.
- main/develop에 직접 push하지 않습니다.
