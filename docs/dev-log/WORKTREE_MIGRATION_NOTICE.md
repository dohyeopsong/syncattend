# 작업 방식 안내 — 3개 터미널 병렬 작업 (2026-09-24 갱신)

> **모든 터미널(CLI)에 붙여넣어 현재 작업 방식을 맞추기 위한 안내입니다.**
> 지금은 **한 명이 터미널 3개를 동시에 띄워** backend / mobile / web 세 파트를
> 병렬로 개발하는 **프로토타입 단계**입니다. (팀 프로젝트지만 아직 합류 전)
>
> 예전에는 단일 클론 하나를 여러 CLI가 공유하며 `git checkout`으로 브랜치를 갈아끼워
> 커밋이 계속 꼬였습니다. **이제는 브랜치를 갈아끼우지 않고, 모두 같은 `main`에서
> 각자 자기 폴더만 편집하는 방식(방법 1)으로 통일합니다.**

## 현재 구조

| 항목 | 값 |
|------|-----|
| 작업 폴더 | `~/Dev/syncattend` (모든 터미널이 **동일 폴더** 공유) |
| 브랜치 | `main` (단일 — 갈아끼우지 않음) |
| 원격 `origin` | https://github.com/dohyeopsong/syncattend.git (**public**) |
| 원격 `old-origin` | https://github.com/dohyeopsong/syncattend-old.git (이전 저장소, 백업용) |

| 터미널 | 담당 파트 | 편집 가능 폴더 |
|--------|-----------|----------------|
| 터미널 1 | **A 백엔드** | `backend/`, `contracts/` |
| 터미널 2 | **B 모바일** | `mobile/` |
| 터미널 3 | **C 웹/인프라** | `web/`, `infra/`, `.github/` |

## 절대 규칙 (모든 터미널 공통)
1. **`git checkout`으로 브랜치를 바꾸지 않는다.** 셋 다 항상 `main`에 머문다.
2. **커밋할 때 `git add .` 금지.** 반드시 자기 담당 경로만 지정해서 스테이징한다.
   ```
   git add backend/ contracts/   # 터미널 1 (A)
   git add mobile/               # 터미널 2 (B)
   git add web/ infra/ .github/  # 터미널 3 (C)
   ```
3. 자기 담당 폴더 밖의 파일이 변경 목록에 보이면 **커밋하지 말고 먼저 확인**한다.
4. `contracts/openapi.yaml`·`backend/migrations/`는 **A만**, `infra/`·`.github/`는 **C만** 편집.
5. **push 하기 전 항상** `git fetch` 후 상태를 확인한다 (아래 push 절차 참고).

## push 절차 (경합 방지 — 중요)
세 터미널이 같은 `main`을 공유하므로, 거의 동시에 push하면 두 번째부터
"먼저 pull 하라"며 거절될 수 있다. 그럴 땐 아래 순서로 처리한다.
```
git add <자기 담당 경로>
git commit -m "feat(<파트>): 설명"
git pull --rebase origin main    # 원격의 최신 변경을 내 커밋 아래로 재정렬
git push origin main
```
> `--rebase`를 쓰면 불필요한 merge 커밋 없이 히스토리가 깔끔하게 이어진다.
> 서로 다른 폴더만 만졌다면 rebase 중 충돌이 날 일은 거의 없다.

---

## 공통 (내가 어느 터미널인지 확인) — 먼저 실행
```
git rev-parse --show-toplevel   # ~/Dev/syncattend 여야 함
git branch --show-current       # main
git remote -v                   # origin -> .../syncattend.git 확인
git fetch && git status         # origin/main 과 동기화 상태 확인
```
그런 다음 아래 "네 트랙" 지시를 따르라. 자기 담당 폴더 밖 파일은 스테이징하지 마라.

## 터미널 1 — CLI A 백엔드 (`backend/`, `contracts/`)
```
너는 CLI A(백엔드)다. 폴더 ~/Dev/syncattend, 브랜치 main 고정. 브랜치 바꾸지 마라.
검증:
  git branch --show-current       # main
  git status                      # backend/contracts 외 변경이 섞이면 커밋 말고 보고
빌드/테스트:
  cd backend && python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt && pytest -q
  uvicorn app.main:app --reload --port 8000
커밋/푸시:
  git add backend/ contracts/
  git commit -m "feat(backend): ..."
  git pull --rebase origin main && git push origin main
```

## 터미널 2 — CLI B 모바일 (`mobile/`)
```
너는 CLI B(모바일)다. 폴더 ~/Dev/syncattend, 브랜치 main 고정. 브랜치 바꾸지 마라.
검증:
  git branch --show-current       # main
  git status                      # mobile 외 변경(backend/web)이 섞이면 커밋 말고 보고
빌드/테스트:
  cd mobile && flutter pub get && flutter test
커밋/푸시:
  git add mobile/
  git commit -m "feat(mobile): ..."
  git pull --rebase origin main && git push origin main
```

## 터미널 3 — CLI C 웹/인프라 (`web/`, `infra/`, `.github/`)
```
너는 CLI C(웹 대시보드+인프라)다. 폴더 ~/Dev/syncattend, 브랜치 main 고정. 브랜치 바꾸지 마라.
검증:
  git branch --show-current       # main
  git status                      # web/infra/.github 외 변경이 섞이면 커밋 말고 보고
빌드:
  cd web && npm install && npm run build
커밋/푸시:
  git add web/ infra/ .github/
  git commit -m "feat(web): ..."
  git pull --rebase origin main && git push origin main
```

---

## 참고 — 나중에 파트를 격리하고 싶으면 (방법 2: worktree)
지금은 위의 단일 `main` 방식으로 충분하다. 그러나 각 파트를 독립 브랜치로
격리하고 PR 리뷰로 합치고 싶어지면 아래처럼 worktree로 전환할 수 있다.
```
git branch feature/backend
git branch feature/mobile
git branch feature/web
git worktree add ~/Dev/syncattend-mobile feature/mobile
git worktree add ~/Dev/syncattend-web    feature/web
# 원본 ~/Dev/syncattend 는 feature/backend 로 checkout
```
→ 터미널마다 완전히 독립된 폴더가 생겨 checkout/push 경합이 사라진다.
   대신 각 브랜치를 main으로 병합(PR)하는 단계가 추가된다. 전환 시 이 문서를 다시 갱신할 것.
