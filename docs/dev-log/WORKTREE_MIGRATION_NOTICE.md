# Git worktree 전환 안내 (2026-09-24)

> **다른 터미널(CLI)에 붙여넣어 현재 상태를 검증·전환시키기 위한 프롬프트입니다.**
> 지금까지 단일 클론 하나를 3개 CLI가 공유하며 브랜치를 갈아끼워 작업해서 커밋이 계속 꼬였습니다.
> 이를 해결하기 위해 **저장소를 초기화하고 git worktree로 브랜치별 독립 폴더를 새로 구성**했습니다.

## 새 구조

| 폴더 | 브랜치 | Track | 원격 트래킹 |
|------|--------|-------|-------------|
| `~/Dev/syncattend-...`(원본 폴더) | `feature/backend` | **A 백엔드** | ✅ origin/feature/backend |
| `~/Dev/syncattend-mobile` | `feature/student-app` | **B 모바일** | ✅ origin/feature/student-app |
| `~/Dev/syncattend-web` | `feature/dashboard-infra` | **C 웹/인프라** | ✅ origin/feature/dashboard-infra |

## 이번에 정리된 것
- 이전 백엔드 작업은 PR #2로 **`main`에 병합 완료** (auth 엔진 + attendance/courses API, 테스트 36개 통과).
- 여기저기 흩어졌던 stash 4개(대부분 백엔드 A 소유)를 정리해 올바른 위치로 이동.
- 꼬였던 로컬 브랜치/중복 worktree를 삭제하고 `main` 기준으로 worktree 3개를 새로 생성.
- B/C의 미푸시 커밋은 없음(모두 origin에 백업됨) → 유실 없이 초기화.

## 새 규칙 (중요)
1. **각 CLI는 오직 자기 폴더에서만** `git add` / `commit` / `push` 한다.
2. **`git checkout`으로 브랜치를 갈아끼우지 않는다.** 폴더가 곧 브랜치다.
3. 자기 폴더 밖(다른 track의) 파일이 변경 목록에 보이면 커밋하지 말고 먼저 알린다.
4. `contracts/openapi.yaml`·`backend/migrations/`는 **A만** 편집. `infra/`·`.github/`는 **C만** 편집.

---

## 공통 (내가 어느 터미널인지 모를 때 먼저 실행)
```
git rev-parse --show-toplevel   # 현재 작업 폴더
git branch --show-current       # 현재 브랜치
git worktree list               # 전체 worktree
```
그런 다음 아래 "네 트랙" 지시를 따르라. 다른 폴더/브랜치는 절대 건드리지 마라.

---

## CLI A — 백엔드 (`~/Dev/syncattend-...` 원본 폴더, `feature/backend`)
```
너는 CLI A(백엔드)다. 네 폴더는 원본 클론 폴더, 브랜치는 feature/backend 다.
이전 백엔드 작업은 이미 main에 병합됐고(PR #2), feature/backend 는 그 main에서 새로 딴 브랜치다.

검증:
  git branch --show-current       # feature/backend
  git status                      # 깨끗해야 함 (web/tsconfig.tsbuildinfo 같은 산출물은 무시)
  git log --oneline -3            # b8a93d2 (PR #2 머지) 가 베이스
  git fetch && git status         # origin/feature/backend 와 동기화

테스트/서버 (이 폴더의 backend/.venv 재사용):
  cd backend && source .venv/bin/activate
  pytest -q                       # 36 passed 확인
  uvicorn app.main:app --reload --port 8000

이후 백엔드/contracts 작업은 전부 이 폴더에서만 하고, 준비되면 git push (업스트림 이미 설정됨).
```

## CLI B — 모바일 (`~/Dev/syncattend-mobile`, `feature/student-app`)
```
너는 CLI B(모바일)다. 네 폴더는 ~/Dev/syncattend-mobile, 브랜치는 feature/student-app 다.
예전에 이 브랜치 워킹트리에 백엔드 A 변경이 잘못 얹혔던 건 모두 정리됐다. 지금은 모바일 것만 있어야 한다.

검증:
  cd ~/Dev/syncattend-mobile
  git branch --show-current       # feature/student-app
  git status                      # backend/web 파일이 섞이면 커밋하지 말고 보고
  git log --oneline -3
  git fetch && git status         # origin 과 동기화

빌드/테스트:
  cd mobile && flutter pub get && flutter test

mobile/ 외 폴더가 변경 목록에 보이면 커밋 전에 먼저 알려라.
```

## CLI C — 웹/인프라 (`~/Dev/syncattend-web`, `feature/dashboard-infra`)
```
너는 CLI C(웹 대시보드+인프라)다. 네 폴더는 ~/Dev/syncattend-web, 브랜치는 feature/dashboard-infra 다.

검증:
  cd ~/Dev/syncattend-web
  git branch --show-current       # feature/dashboard-infra
  git status                      # web/infra/.github 외 파일이 섞이면 보고
  git log --oneline -5
  git fetch && git status         # origin 과 동기화

빌드:
  cd web && npm install && npm run build

web/ infra/ .github/ 외 폴더가 변경 목록에 보이면 커밋 전에 먼저 알려라.
```
