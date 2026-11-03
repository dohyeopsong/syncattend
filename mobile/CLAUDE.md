# CLAUDE.md — mobile/ (CLI B)

Flutter student app. You are **CLI B**: you own `mobile/` only.

## Setup & run
```bash
flutter pub get
flutter test
flutter analyze
flutter run                   # --dart-define=BACKEND_URL=... when the backend is not default
```
Baseline 2026-10-15: **86 passed, 2 skipped**, `flutter analyze` clean.

## Rules
- `contracts/openapi.yaml` is **read-only** for you. Build API calls from the contract;
  if an endpoint is missing (e.g. the `/courses/{id}/schedules` family), request it
  from CLI A instead of guessing the shape.
- Do not edit `backend/`, `web/`, or `infra/`.
- Preserve the device-binding flow: app-generated UUID + `@wku.ac.kr` re-registration.
- A change is done only when `flutter test` passes and `flutter analyze` is clean —
  report pass/fail/skip counts.
