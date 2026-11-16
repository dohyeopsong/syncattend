# Syncattend (SDAS)

Syncattend는 대리 출석을 **완전히 없앤다고 약속하는 시스템이 아니라**, 시간·공간·기기·교수 확인을 여러 겹으로 결합해 대리 출석을 어렵게 만드는 출석 관리 플랫폼입니다.

현재 모노레포에는 다음 세 클라이언트/서버가 함께 있습니다.

- **Backend**: FastAPI + async SQLAlchemy
- **Professor web**: React + TypeScript + Vite + Zustand
- **Student mobile**: Flutter + Riverpod
- **Persistence**: PostgreSQL + Redis
- **Realtime**: Server-Sent Events (SSE)

## 출석 인증 모델

```text
교수: 세션 열기
        │
        ├─ QR token ─────┐
        └─ audio nonce ──┼─ 학생 앱: QR + 마이크 인증
                         │
                 서버 교차 검증
                         │
          계정/기기 중복·인증 윈도 검사
                         │
             교수 출석 검토 및 일괄 마감
```

### 핵심 불변조건

- QR과 audio nonce는 Redis에서 **15초 TTL**로 회전합니다.
- 두 토큰은 같은 발급 쌍인지 서버에서 교차 검증합니다.
- 출석 인증 윈도는 기본 **60초**입니다.
- 한 세션에서 같은 계정과 같은 `device_uuid`는 각각 한 번만 출석할 수 있습니다.
- 기기 식별자는 OS 하드웨어 ID가 아니라 앱이 생성해 secure storage에 보관하는 UUID입니다.
- 새 UUID 바인딩 또는 기기 변경은 `@wku.ac.kr` 이메일 재인증을 거칩니다.
- 교수는 `check_in`과 `check_out`을 별도로 열 수 있습니다.
  - 둘 다 성공: `present`
  - 입실만 성공: `early_leave`
  - 퇴실만 성공: `late`
  - 둘 다 실패: `absent`
  - 마감 전: `pending`
- 근접성은 원시 위치 정보가 아니라 audio 인증 성공 여부로만 다룹니다.

## 저장소 구조

| 경로 | 역할 |
|---|---|
| `backend/app/` | API, 인증, 토큰, 출석 검증/집계, SSE |
| `backend/tests/` | SQLite + fakeredis 기반 백엔드 테스트 |
| `backend/migrations/` | 로컬 PostgreSQL 초기화용 SQL |
| `backend/migrations_alembic/` | Alembic 설정/향후 스키마 변경 경로 |
| `contracts/openapi.yaml` | HTTP API 계약의 단일 진실 원천 |
| `web/src/` | 교수 대시보드와 학생 웹 화면 |
| `mobile/lib/` | Flutter 학생 앱 |
| `infra/` | PostgreSQL, Redis, backend Docker Compose |
| `scripts/` | 계약 정합성 및 전체 검증 스크립트 |
| `docs/` | 제품·아키텍처·보안·QA 문서 |

백엔드의 주요 모듈은 `routers/`(HTTP 경계), `services/`(토큰·검증·집계·이벤트), `models.py`(ORM), `config.py`(환경설정)로 나뉩니다. 웹은 `pages/`, `components/`, `store/`, `api/`를 사용하고, 모바일은 `features/`, `core/`, `api/`, `models/`로 구성됩니다.

## 빠른 시작

### 1. 로컬 전체 스택

Docker와 Docker Compose가 설치되어 있다면 루트에서 실행합니다.

```bash
docker compose -f infra/docker-compose.yml up --build
curl http://localhost:8000/health
```

서비스 포트는 backend `8000`, PostgreSQL `5432`, Redis `6379`입니다. SQL 파일은 PostgreSQL 볼륨이 **처음 생성될 때만** 자동 적용됩니다.

### 2. Backend만 실행

현재 작업 트리에는 `backend/.env.example`이 없으므로 파일을 복사하는 명령을 사용하지 않습니다. `backend/.env`를 직접 만들거나 환경 변수를 설정합니다.

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
```

`/health`는 애플리케이션, DB, Redis 상태를 함께 반환합니다. 테스트는 외부 PostgreSQL/Redis 대신 SQLite와 fakeredis를 사용합니다.

### 3. Web

```bash
cd web
npm install
npm run dev
```

Vite 개발 서버는 `http://localhost:5173`에서 실행되고 `/api/*`를 backend `http://localhost:8000`으로 프록시합니다. 웹은 독립 mock backend를 제공하지 않습니다.

### 4. Mobile

```bash
cd mobile
flutter pub get
flutter run --dart-define=USE_MOCK=true
```

실제 backend에 연결할 때는 실행 환경에 맞는 주소를 넣습니다.

```bash
flutter run \
  --dart-define=USE_MOCK=false \
  --dart-define=BACKEND_URL=http://<host>:8000
```

- Android emulator: `http://10.0.2.2:8000`
- iOS simulator/macOS: `http://localhost:8000`
- 실제 휴대폰: 노트북의 LAN IP

## API 계약

`contracts/openapi.yaml`은 backend, web, mobile이 공유하는 HTTP 계약입니다. 현재 backend와 계약은 **42개 operation ID로 정합**합니다.

계약을 확인하려면 루트에서 실행합니다.

```bash
python3 scripts/check_contract.py
```

backend endpoint를 추가하거나 변경할 때는 계약도 같은 변경에 반영하고 이 검사를 다시 실행합니다. 클라이언트는 계약에 없는 endpoint나 필드를 추측해 만들지 않습니다.

## 이메일 인증

회원가입과 기기 재등록 코드는 Redis에 저장됩니다.

1. `RESEND_API_KEY`가 있으면 Resend HTTPS API
2. 없고 `SMTP_USER`/`SMTP_PASSWORD`가 있으면 SMTP
3. 둘 다 없으면 개발용 로그 stub

Resend의 `resend_from`은 Resend에서 인증된 발신 주소여야 합니다. 발신 도메인 검증이 되지 않은 상태에서는 실제 메일 전송이 실패할 수 있습니다.

## 배포

- **Backend**: Render (`https://syncattend-6txb.onrender.com`)
- **Web**: Vercel (`https://syncattend.vercel.app`)
- `web/vercel.json`이 `/api/*`를 Render backend로 전달합니다.
- `backend/render_start.sh`는 현재 ORM의 `Base.metadata.create_all`을 실행한 뒤 seed 스크립트를 시도하고 Uvicorn을 시작합니다.

`create_all`은 이미 존재하는 테이블을 변경하지 않으므로, 기존 운영 DB의 스키마 변경을 자동 적용하는 마이그레이션으로 간주하면 안 됩니다. 장기 운영 DB에는 Alembic 또는 명시적인 마이그레이션 실행 절차가 필요합니다.

## 검증

변경한 영역에 맞춰 다음 명령을 실행합니다.

```bash
cd backend && .venv/bin/pytest -q
cd web && npm run build && npm test
cd mobile && flutter test && flutter analyze
python3 scripts/check_contract.py
```

문서에 테스트 통과 수치를 기록할 때는 과거 기준선이 아니라 **이번 실행의 실제 출력**을 사용합니다. Docker 전체 스택, 실제 Render/Vercel 배포, 실제 iOS/Android 오디오 수신은 별도 검증이며 실행하지 않았다면 통과했다고 보고하지 않습니다.

## 알려진 제한과 다음 점검

- backend 테스트는 SQLite 기반이므로 PostgreSQL의 타입·동시성·마이그레이션 문제를 모두 검출하지 못합니다.
- Docker Compose의 PostgreSQL 초기 SQL은 기존 named volume에 다시 적용되지 않습니다.
- ultrasonic audio 제품 프로토콜은 **18.5–20kHz**, 16 slots, 60ms symbol, slot 15 marker, `0–e` 8자리 hex nonce입니다. web emitter와 mobile decoder/config 기본값을 이 기준으로 정렬했지만, 소프트웨어 loopback과 일부 물리 loopback이 모든 실제 기기·교실 환경을 대표하지는 않습니다.
- 학생 웹의 timetable/inquiry 같은 일부 화면은 API 계약 범위를 넘어 로컬 데이터 또는 화면 수준 동작을 사용할 수 있으므로 실제 서버 기능과 구분해야 합니다.
- Resend 발신자 도메인 검증과 장기 운영 DB 마이그레이션 절차는 운영 전 확정해야 합니다.

상세 설계와 검증 기록은 `docs/`와 각 하위 디렉터리의 README를 확인합니다.

## 라이선스

[MIT License](./LICENSE) © 2026 Syncattend Team.
