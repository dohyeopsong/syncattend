# Syncattend Dual Auth Smart Attendance  Academic Management System

## Vision

A smart campus platform (V3) that structurally deters proxy attendance by combining a
**dynamic QR code (time/identity)**, an **ultrasonic audio token (space/proximity)**, an
**identity-fraud defense layer (1-min window + server uniqueness + device binding)**, and a
**professor-in-the-loop** confirmation layer. It reduces professor administrative overhead
and stays reliable under peak class-start traffic, while meeting privacy obligations by design.

QR/audio prove a device is *in the room* (proximity) but not *that the operator owns the
account* (identity); the identity layer closes that gap. The goal is **not** "0% proxy
attendance" but to make it **structurally difficult and high-cost**, with the professor
performing final confirmation.

## Tech Stack Summary

- **Backend**: Python 3.12 / FastAPI (async), SQLAlchemy
- **Student App**: **Flutter** (native mobile) — QR scan + mic audio-token decode + secure UUID storage
- **Professor Dashboard**: React (web), TailwindCSS, shadcn/ui, Zustand
- **Databases**: PostgreSQL (persistent) + Redis (15s TTL tokens / cache)
- **Realtime**: SSE (Server-Sent Events) — lightweight, no persistent WebSocket
- **Infrastructure**: Docker, Vercel / Render (CI/CD), Supabase (optional)

## Requirements

### Active

- [ ] Dual-auth engine: 15s TTL dynamic QR (Redis) + ultrasonic audio-token issue/verify + cross-verification
- [ ] **Single-use nonce**: server rejects re-submission of already-used QR/audio nonces (relay-attack blocking)
- [ ] **[TOP RISK] Audio feasibility spike (M1–M2)**: verify laptop-speaker 18–20 kHz emission + student-device mic decode at classroom distance/noise; prepare fallback (audible-low band / screen-side signal)
- [ ] Professor PC ultrasonic audio-token emission module (18–20 kHz nonce, 15s rotation)
- [ ] Flutter student app: QR scanner + mic audio-token decode (FFT/band filter)
- [ ] Identity defense — 1-minute auth window (professor-opened, extendable)
- [ ] Identity defense — server uniqueness rule: one attendance per account & per device UUID per session
- [ ] Identity defense — device binding via app-generated UUID (flutter_secure_storage / flutter_udid, Keychain/Keystore)
- [ ] Identity defense — device change re-registration via school-email (@wku.ac.kr) verification
- [ ] Identity defense — **new/unknown UUID must pass email re-auth before first binding (NO auto-bind)**; guards the app-data-wipe → new-UUID boundary
- [ ] Front-end account-switch UX nudge (soft dialog only, NO hard cooldown/lock)
- [ ] Traffic: **peak-insert path** via Redis atomic ops (`SET NX`, counters) + lightweight append; **close-time** Delta-based Batch UPDATE
- [ ] Opt-out professor dashboard with Delta-based Batch UPDATE
- [ ] Attendance aggregation + cumulative-absence risk-group warning (SSE)
- [ ] Professor-in-the-loop fallback (signal/window failure ≠ auto-absent; extend/reopen window; correct)
- [ ] Privacy-by-Design: consent, data minimization, retention limits
- [ ] Testing, QA, and real-environment audio verification (noise/distance/device mic)
- [ ] Documentation and deployment (Vercel/Render, Docker)

### Deferred (v-next)

- AI medical-certificate (OCR/Vision) reading — excluded from core scope (sensitive health
  data, liability, OCR-misread risk). Certificates handled by manual professor review.
- Biometric attendance signing (Face ID / fingerprint, WebAuthn/FIDO principle) — optional
  extension; the 1-minute window already covers the primary case.
- Optional WebSocket upgrade for realtime (SSE is the core mechanism)

### Out of Scope

- BLE / Bluetooth beacon proximity (rejected: iOS Safari lacks Web Bluetooth; professor PC
  cannot emit BLE without extra hardware) — replaced by ultrasonic audio token
- Using `device_info_plus` OS identifiers (IDFV/SSAID) as a security binding key — they
  change on reinstall/factory reset; app-generated UUID is used instead
- Hard front-end log-out cooldown / session lock — duplicates the server rule and causes
  false positives for legitimate students
- Guaranteeing absolute (0%) proxy-attendance prevention

## Key Decisions

| Decision | Options Considered | Chosen | Rationale |
|----------|-------------------|--------|-----------|
| Student client | Web vs React Native vs Flutter | **Flutter native app** | Reliable mic/audio decode + secure UUID storage across iOS/Android |
| Proximity signal | BLE beacon vs Ultrasonic audio token | Ultrasonic audio token (18–20 kHz) | iOS-compatible; professor PC speaker, no extra hardware |
| **Audio feasibility** | Assume-works vs Verify-first | **Verify-first spike (M1–M2) + fallback** | Laptop-speaker/phone-mic ultrasonic reliability is unproven; TOP tech risk. Fallback: audible-low band / screen-side signal |
| **Relay blocking** | TTL-only vs Single-use nonce | **Single-use nonce + 15s TTL** | Server consumes each nonce once; already-used token re-submission rejected → relay receiver cannot reuse |
| **Peak traffic** | Direct DB write vs Redis atomic | **Redis atomic (`SET NX`/counter) insert + close-time Delta Batch** | Peak-insert (concurrent) and close-batch are different problems; split & optimize each to avoid row-lock contention |
| Multi-account fraud | Front-end lock vs Server rule | 1-min window + server uniqueness | Front-end is bypassable; server enforces one-per-account & one-per-UUID/session |
| Device identity | Hardware ID vs device_info_plus vs app UUID | App-generated UUID (Keychain/Keystore) | HW IDs blocked; OS IDs change on reinstall; app UUID is stable & app-controlled |
| **UUID wipe boundary** | Auto-bind new UUID vs Require re-auth | **Email re-auth required before binding any new UUID (no auto-bind)** | App-data wipe makes same phone look "new"; forcing re-auth blocks instant multi-account via UUID regeneration |
| device_info_plus for security | Use vs Not | **Not used for security** | OS IDs unstable; secondary fingerprint adds false positives / complexity, low value |
| Device change | Auto vs Re-register | School-email (@wku.ac.kr) re-registration | Ties identity to enrolled student; deters frequent device swapping; logs change history |
| Front-end lock | Hard cooldown vs UX nudge | UX nudge only | Hard lock duplicates server rule and false-blocks legitimate students |
| Biometric | Required vs Optional | Optional (future) | 1-min window already covers the primary case |
| Realtime nudges | WebSocket vs SSE/polling | SSE (single-shot push) | Avoids thousands of persistent connections for a brief attendance moment |
| AI cert reading | Include vs Defer | Defer to v-next | Sensitive health data, OCR misread, liability, over-scope for 6wk/3-person capstone |
| Traffic bottleneck | Full update vs Delta Batch | Redis cache + Delta Batch UPDATE | Only unverified (Delta) records updated; reduces lock/I-O |
| Framing of goal | "0% proxy" vs Structural deterrence | Structural deterrence + professor confirmation | Honest; residual relay / multi-phone risk acknowledged |

## Milestones

### M1: Foundation (Week 1)
- [ ] Docker dev environment, DB + auth skeleton (JWT)
- [ ] **[TOP RISK] Audio feasibility spike — start**: measure laptop-speaker 18–20 kHz emission + student-device mic decode at classroom distance/noise
- [ ] API specification finalized (incl. device-register / uniqueness / auth-window / single-use nonce)
- [ ] Mock Flutter student app / React professor dashboard UI prototypes

### M2: Auth Core (Week 2)
- [ ] **[TOP RISK] Audio feasibility spike — conclude**: decide ultrasonic vs fallback (audible-low band / screen-side signal)
- [ ] Dynamic QR + audio-token send/receive cross-verification API
- [ ] **Single-use nonce**: consume-on-verify, reject re-submitted QR/audio nonces (relay blocking)
- [ ] Redis session setup (15s TTL) + 1-minute auth window control
- [ ] Peak-insert path via Redis atomic ops (`SET NX` / counter)
- [ ] Server uniqueness rule (account & UUID per session)
- [ ] App-generated UUID binding + school-email re-registration API (new/unknown UUID requires email re-auth, no auto-bind)
- [ ] Professor PC speaker emission ↔ Flutter app mic decode integration

### M3: Attendance Features (Week 3)
- [ ] Attendance aggregation API
- [ ] Cumulative-absence risk-group logic + warning (SSE)
- [ ] Professor dashboard with Delta extraction logic

### M4: Frontend Integration (Week 4)
- [ ] End-to-end student + professor scenario wiring
- [ ] Professor-in-the-loop correction + window extend/reopen flow
- [ ] Account-switch UX nudge; integration debugging + integrated UI

### M5: Test & Hardening (Week 5)
- [ ] Security review (incl. device-binding / uniqueness bypass attempts), E2E tests
- [ ] Delta Batch UPDATE load test (concurrent traffic)
- [ ] Real-environment audio verification (classroom noise / distance / device mic)

### M6: Deploy & Docs (Week 6)
- [ ] Final deployment via Vercel + Render
- [ ] Privacy policy + deliverable documentation
- [ ] Demo scenario preparation

---

*Last updated: 2026-09-24 (V3 — Flutter native app, ultrasonic audio token, identity-fraud defense, SSE, Privacy-by-Design)*
