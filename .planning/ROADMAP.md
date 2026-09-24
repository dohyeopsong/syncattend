# Syncattend Dual Auth Smart Attendance  Academic Management System - Roadmap

**V3** — Dynamic QR (time/identity) + Ultrasonic audio token (space/proximity) +
Identity-fraud defense (1-min window + server uniqueness + device binding) +
Professor confirmation (human). Student app = **Flutter native**; professor = React web.
6 milestones over 6 weeks (3-person vertical-slice team).

## M1 — Foundation (Week 1)
- [ ] Docker dev environment
- [ ] **[TOP RISK] Audio feasibility spike — start** (laptop-speaker 18–20 kHz emission + student-device mic decode at classroom distance/noise)
- [ ] DB schema (incl. device_bindings, attendance uniqueness) + JWT auth skeleton
- [ ] API specification finalized (device-register / uniqueness / auth-window / single-use nonce)
- [ ] Mock Flutter student app / React professor dashboard UI prototypes

## M2 — Auth Core (Week 2)
- [ ] **[TOP RISK] Audio feasibility spike — conclude** (decide ultrasonic vs fallback: audible-low band / screen-side signal)
- [ ] Dynamic QR (15s TTL, Redis) issue API
- [ ] Ultrasonic audio-token (nonce) issue + verify API
- [ ] **Single-use nonce**: consume-on-verify; reject re-submitted QR/audio nonces (relay blocking)
- [ ] QR × audio cross-verification logic
- [ ] 1-minute auth window control (professor-opened, extendable)
- [ ] Peak-insert path via Redis atomic ops (`SET NX` / counter) to avoid row-lock contention
- [ ] Server uniqueness rule: one attendance per account & per device UUID per session
- [ ] App-generated UUID device binding + school-email (@wku.ac.kr) re-registration API (new/unknown UUID requires email re-auth, no auto-bind)
- [ ] Professor PC speaker emission ↔ Flutter app mic decode integration

## M3 — Attendance Features (Week 3)
- [ ] Attendance aggregation API
- [ ] Cumulative-absence risk-group warning (SSE)
- [ ] Professor Opt-out dashboard + Delta extraction

## M4 — Frontend Integration (Week 4)
- [ ] Full student + professor scenario wiring
- [ ] Professor-in-the-loop correction + window extend/reopen flow
- [ ] Account-switch UX nudge (soft, no hard lock)
- [ ] Integrated UI + bug fixing

## M5 — Test & Hardening (Week 5)
- [ ] Security review (device-binding / uniqueness bypass attempts), E2E tests
- [ ] Delta Batch UPDATE load test
- [ ] Real-environment audio verification (noise / distance / device mic)

## M6 — Deploy & Docs (Week 6)
- [ ] Deploy via Vercel + Render
- [ ] Privacy-by-Design policy documentation
- [ ] Deliverables + demo scenario

---

*Generated: 2026-09-17 · Updated: 2026-09-24 (V3 — Flutter + identity defense)*
