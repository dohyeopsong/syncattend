# contracts/ — Shared API Contract (READ-ONLY except owner A)

`openapi.yaml` is the **single source of truth** for the HTTP contract between
`backend`, `mobile`, and `web`.

## Ownership
- **Only backend (owner A) may edit `openapi.yaml`.**
- `mobile` (B) and `web` (C) treat this folder as **read-only**. Generate clients
  from it; do not hand-edit the contract to work around backend gaps — request a
  contract change from A instead.

## What's covered
- Auth: JWT login/refresh
- Devices: app-generated UUID binding, `@wku.ac.kr` email re-registration (no auto-bind)
- Sessions: create (opens ~60s window), extend/reopen, close, current QR token + audio nonce (15s TTL, single-use)
- Attendance: cross-verify (window → QR×audio → single-use nonce → device match → uniqueness), live aggregate, Delta batch close, manual correction
- SSE: student risk-warning stream, professor live-attendance stream

## Suggested client generation (optional, run inside each app folder)
- Web (TS types): `npx openapi-typescript ../contracts/openapi.yaml -o src/api/schema.ts`
- Mobile (Dart): use `openapi_generator` / `swagger_parser` against `../contracts/openapi.yaml`
- Backend may validate with any OpenAPI linter (e.g. `redocly lint openapi.yaml`)
