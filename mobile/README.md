# mobile/ — Flutter Student App (Owner B)

Owner **B**. Branch: `feature/student-app`. Consumes `../contracts/openapi.yaml` (READ-ONLY).

## Prereqs
Flutter SDK (>=3.4). Verify with `flutter doctor`. Platform folders (android/ios/…)
are already generated in this repo.

```bash
cd mobile
flutter pub get
```

## Run
```bash
# Mock mode (no backend needed) — defaults ON in debug builds:
flutter run --dart-define=USE_MOCK=true

# Against a real backend:
flutter run --dart-define=USE_MOCK=false --dart-define=BACKEND_URL=http://<host>:8000
# Android emulator maps host to 10.0.2.2 (default). iOS sim/device: localhost/LAN IP.

flutter analyze     # must be warning-free
flutter test        # unit + widget tests
```

## State management: Riverpod (chosen over Provider)
- Compile-safe provider graph; easy `overrideWith` for **mock mode** and tests.
- First-class `StreamProvider`/`FutureProvider` fit the **SSE risk-warning** stream,
  the async **device UUID** future, and auth/verify async flows.

## Architecture (`lib/`)
- `core/` — `config` (BACKEND_URL, USE_MOCK, audio band), `secure_store`
  (Keychain/Keystore), `device_identity` (app-generated UUID), `providers`.
- `models/contract_models.dart` — Dart mirror of `openapi.yaml` schemas.
- `api/` — `ApiClient` interface + `DioApiClient` (JWT interceptor, refresh-on-401,
  SSE parser) and `MockApiClient` (contract-shaped in-memory backend).
- `features/auth/` — login (JWT store), device registration (UUID bind),
  `@wku.ac.kr` email re-auth on binding conflict (409).
- `features/attendance/` — QR scanner + microphone FFT audio-nonce decode,
  1-minute auth-window countdown, `POST /attendance/verify`, permissions + fallback.
- `features/risk/` — SSE `/sse/students/{id}` risk-warning banner.
- `features/views/` — my attendance, timetable, inquiry.
- `features/home/` — bottom-nav shell with attendance entry + logout nudge.

## Identity defense (UUID device binding)
- App generates a random v4 UUID **once**, stored in Keychain (iOS) / Keystore
  (Android) via `flutter_secure_storage`. Restored on relaunch; attached to
  login/attendance requests.
- **No hardware/OS identifiers** (`device_info_plus`) — they change on reinstall/reset
  and cause false rejections (per docs/06_FRONTEND_DESIGN.md).
- A new/unknown UUID is **not auto-bound**: server returns 409 → app routes to
  `@wku.ac.kr` email re-auth (`/devices/reregister/*`).
- Manual reinstall-persistence check: see "Manual verification" below.

## Audio spike — coordinate with Owner C (highest risk, TR-0)
`features/attendance/audio_nonce_decoder.dart` implements the **decode** half.
Proposed protocol (CONFIRM with C's emitter before real-device tests):
- Band **18–20 kHz**, split into **16 tone slots** (4 bits/symbol).
- Symbol length **60 ms**; highest slot = **start marker**; nonce = hex nibbles.
- Only `bandLowHz`/`bandHighHz`/`toneSlots`/`symbolMs` need changing if the
  fallback band is adopted.

## Contract gaps to report to Owner A
- No student-facing `GET` for **my attendance history** or **timetable** or
  **inquiry** threads. These screens use local placeholders until endpoints exist.
- SSE student id: `/sse/students/{id}` needs the authenticated student's id; a
  `GET /me` (or id in the token/login response) would remove the `"me"` placeholder.

## Manual verification (record results here)
- [ ] Fresh install → login → device auto-registers (mock: any `@wku.ac.kr` + pw).
- [ ] Kill & relaunch → same UUID restored (no re-register prompt).
- [ ] iOS: reinstall app → Keychain retains UUID (survives reinstall).
- [ ] Android: clear app data → UUID regenerates → 409 → email re-auth flow.

## Boundaries
Edit only `mobile/`. Do not modify backend/web/contracts/infra. Request contract
changes from Owner A rather than hand-editing `openapi.yaml`.
