# web/ — React Professor Dashboard (Owner C)

Owner **C** — also owns `../infra/` and root shared config.

## Stack
React 18 + Vite + TypeScript + Zustand + Tailwind + shadcn/ui-style primitives
(`src/components/ui/*`) + react-router-dom.

## Screens (Opt-out professor dashboard)
- **Course & session** (`CoursePanel`): pick/create course, open a session with an auth window.
- **(a) Token emit** (`SessionTokenPanel`): rotating QR (`qr_token`) + a **real
  ultrasonic emitter** (`src/lib/ultrasonicEmitter.ts`, Web Audio API) that
  physically transmits `audio_nonce`; extend / close window; gain + band controls.

## Ultrasonic emitter (Stage-1) — protocol MUST match `mobile/` decoder
`src/lib/ultrasonicEmitter.ts` (`UltrasonicEmitter`) is the **emit** half of the
TR-0 spike. It is protocol-locked to
`mobile/lib/features/attendance/audio_nonce_decoder.dart` (owner B, READ-ONLY):
- Band **18–20 kHz**, **16 tone slots** (4 bits/symbol),
  `slotFrequency(slot) = bandLow + (band/slots)·(slot+0.5)` (slot CENTER).
- Symbol period **60 ms**; **slot 15 = start marker**; nonce = 8 hex nibbles,
  frame = `[marker, n0..n7]`. (Nibble `0xF` collides with the marker and is
  remapped to `0xE` defensively.)

### Adjacent-identical-nibble fix — chosen method: **(a) guard**
B reported that the decoder's oversampled run-segmentation can't distinguish two
identical *adjacent* nibbles from one longer tone. The nonce is backend-issued
(arbitrary hex), so the emitter can't force "adjacent differ" (option b). We use
option **(a) a guard**, implemented as an **intra-symbol silent gap**: within each
60 ms symbol the first `toneFraction` (default **0.6**) is the tone, the remainder
is silence. The decoder reads a `null` in the guard → flushes the run → identical
adjacent nibbles split into separate runs. Because each tone run stays ≈ one
symbol long, the decoder's `round(runLen/hopsPerSymbol)` repeat count stays **1**,
so this works with the **current decoder unchanged** (no `mobile/` edit required).
The 60 ms symbol period, slot map, and marker are all unchanged.

**Software loopback verification** (emitter PCM → JS port of the decoder's
slot-detection + oversampled run-segmentation, 20 dB additive noise + random
symbol-boundary jitter): **100%** full-nonce decode for `1a2b3c4d`, `aa11bb22`,
`77777777`, `0e0e0e0e`, `deadbeef`, `12344321` at **hopsPerSymbol = 4** (capture
default) and **= 8** (240/240 each). → **Stage-1 loopback ready** for a real
device run against B's `AudioLoopbackHarnessScreen`.

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
