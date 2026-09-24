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

### Spike feasibility results (software loopback, `test/audio_decode_spike_test.dart`)
Deterministic DSP loopback: a synthesized emitter (same protocol) → additive
white Gaussian noise / amplitude attenuation / start-boundary jitter → decoder.
This validates the FFT + band-filter + slot-detection + framing pipeline; it
does **not** yet prove physical mic/speaker hardware (that requires a device run
— see "Real-device checklist" below). Measured 2026-09-24, Flutter 3.47.5:

| Condition | Full-nonce decode success |
|-----------|---------------------------|
| Clean channel (no noise) | **100%** (50/50) |
| Additive noise, SNR +30 dB | 100% (40/40) |
| Additive noise, SNR +20 dB | 100% (40/40) |
| Additive noise, SNR +12 dB | 100% (40/40) |
| Additive noise, SNR +6 dB | 100% (40/40) |
| Additive noise, SNR 0 dB | 100% (40/40) |
| Additive noise, SNR −6 dB | 100% (40/40) |
| Amplitude ↓ (distance proxy), ~36→10 dB eff. SNR | 100% at every step (30/30) |
| **Symbol-boundary jitter, naive 1-window/symbol** | **42.5%** (17/40) |
| **Symbol-boundary jitter, oversampled ×8 robust decode** | **100%** (40/40) |

**Interpretation.** Single-tone-per-symbol FFT detection is extremely robust to
broadband noise (tone energy concentrates in one bin; noise spreads across all
bins), so the SNR envelope is not the limiting factor. The real risk is **symbol
clock / phase alignment**: a receiver not aligned to the emitter's symbol
boundaries drops to ~42% with the naive decoder.

**Fixes applied (this decoder):**
1. **FFT sizing bug fixed.** The FFT window was sized `ceil`-pow2 (4096) while the
   capture layer emits `symbolMs` windows (2646 samples) — so *every* real decode
   returned null. Now uses the largest pow2 that fits **inside** one symbol
   (`_fftSizeForSymbol` → 2048), so a full symbol yields a full FFT frame.
2. **Oversampled robust decode** (`decodeStreamOversampled`, used by
   `AudioCaptureService.start`, default `hopsPerSymbol: 4`, test proven at ×8):
   emits overlapping windows (hop = symbol/N), run-segments the slot readings,
   and recovers symbols regardless of start alignment → 100% under the jitter
   that broke the naive path.

**Open protocol requirement → report to Owner C:** run-segmentation cannot tell
two identical *adjacent* nibbles from one longer tone. The emitter must either
insert a short inter-symbol guard/marker tone, or use an encoding where adjacent
symbols always differ. Until then the decoder splits over-long runs as a
best-effort heuristic.

**Fallback hook (TR-0):** if real-device ultrasonic proves infeasible, only
`bandLowHz`/`bandHighHz` (→ lower audible band) or an on-screen assist code path
need changing; the slot map, framing, and robust decode are band-agnostic.

### Real-device checklist (still TODO — needs hardware)
Use the on-device harness `AudioLoopbackHarnessScreen`
(`lib/features/attendance/audio_loopback_harness_screen.dart`) to measure the
real acoustic path (physical speaker → air → mic) — this cannot be automated in
CI. It reuses the same `AudioCaptureService`/decoder as attendance (no new
dependency). Steps: enter the expected nonce → start → have owner C's emitter
play the 18–20 kHz frames → read the live success rate → record it below.

- [ ] Loopback: C's emitter (speaker) → this app (mic) at 1 m, quiet room. Rate: ____%
- [ ] Classroom distance sweep (front row / mid / back) + ambient chatter. Rate: ____%
- [ ] Record measured success rate here per distance/noise condition.
- NOTE (this environment): only macOS-desktop / Chrome run targets are available
  (no Android/iOS emulator or device, no mic entitlement), so physical loopback
  numbers are pending a hardware run; the software DSP spike above stands in for
  the automated portion.

### Stage-0 hardware feasibility (physical emit+receive, measured 2026-09-24)
Before the app-based Stage-1 loopback, we verified the *prerequisite* physical
question with a tone generator (`docs/dev-log/stage0_ultrasonic_tone.py`) on the
laptop speaker and a spectrum-analyzer app on the phone. This is NOT the full
nonce decode — it only proves the acoustic channel exists in the target band.

- Hardware: laptop = **MacBook Air (Mac14,15 / M2)** built-in speaker, output
  48 kHz; phone = **iPhone** + spectrum-analyzer app. Volume ~81%, quiet room.
- **Sweep 12→22 kHz:** spectral line visible up to **~25 kHz** → speaker emits
  and phone mic receives across the entire ultrasonic band of interest. ✅
- **Steps 15/16/17/18/19/20 kHz:** all **clearly visible** peaks at close range. ✅
- **Distance (19 kHz, open space):** still "moderate" peak at **~10 m**. ✅
  (Good classroom coverage; also means the signal carries far in open air.)
- **Wall attenuation (19 kHz):** with the door **closed**, at a spot ~5 m away
  behind the door, the signal was **noticeably weaker** than in-room. → supports
  the design premise that walls/doors attenuate the token, giving a proximity
  basis. ⚠️ Caveat: that point was also ~5 m from the speaker, so distance decay
  and wall blocking are not fully separated in this single measurement; a
  same-distance in-room vs. through-door comparison is still worth doing.

**Verdict:** the project's #1 technical risk (TR-0, jev 0.83 — "can a laptop
speaker emit 18–20 kHz that a phone mic decodes?") passes at the hardware level.
Next: Stage-1 (C's emitter plays real nonce frames → this app decodes → live
success rate), then fill the checklist rates above.



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
