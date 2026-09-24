# web/ — React Professor Dashboard (Owner C)

Owner **C** — also owns `../infra/` and root shared config.

## Stack
React 18 + Vite + TypeScript + Zustand + Tailwind + shadcn/ui-style primitives
(`src/components/ui/*`) + react-router-dom.

## Screens (Opt-out professor dashboard)
- **Course & session** (`CoursePanel`): pick/create course, open a session with an auth window.
- **(a) Token emit** (`SessionTokenPanel`): rotating QR (`qr_token`) + ultrasonic
  `audio_nonce` via `getSessionToken` polling; extend / close window.
- **(b) Attendance review** (`AttendanceTable`): Opt-out absentee-centric list from
  `getSessionAttendance`; verified students are auto-present, only the unverified are
  reviewed. Inline present/absent corrections.
- **(c) Delta batch close** (`AttendanceTable`): queued corrections applied via
  `batchCloseAttendance` (deltas only).
- **(d) Realtime monitor** (`RealtimeRiskPanel`): live aggregate via SSE
  (`/sse/sessions/{id}`) with a derived risk banner.

Privacy-by-Design: no raw location data is fetched or shown; proximity is reflected
only as a pass/fail (boolean) via the contract's cross-verify result.

## Run (local)
```bash
cd web
npm install
npm run dev          # http://localhost:5173
```
Dev server proxies `/api/*` → backend `http://localhost:8000`.

## Build
```bash
npm run build        # tsc -b && vite build -> dist/
```

## Boundaries
- Reads the API contract from `../contracts/` (READ-ONLY).
- Does not edit `backend/`, `mobile/`, `contracts/`.
