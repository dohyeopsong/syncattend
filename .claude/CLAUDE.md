# Syncattend Dual Auth Smart Attendance  Academic Management System - Claude Code Configuration

A smart campus platform (V3) that structurally deters proxy attendance by combining a
time-limited dynamic QR code (time/identity) with an ultrasonic audio token (space/proximity),
an identity-fraud defense layer (1-minute window + server uniqueness + device binding),
and a professor-in-the-loop confirmation layer. It features an integrated timetable dashboard
for efficient academic management.

> V3 supersedes the earlier BLE dual-auth design: the student client moves to a Flutter native
> app, and BLE is replaced by an 18–20 kHz ultrasonic audio token emitted by the professor PC
> speaker and decoded by the app mic. Identity fraud (one device, many accounts) is defended by
> a ~60s auth window + server-side "one attendance per account & per device UUID per session"
> rule + app-generated UUID device binding (Keychain/Keystore) + school-email (@wku.ac.kr)
> re-registration. Front-end is a UX nudge only (no hard lock); biometric is optional.
> `device_info_plus` is NOT used for security. Realtime nudges use SSE (not persistent
> WebSocket). AI medical-certificate reading is out of core scope (v-next). Privacy-by-Design
> is a first-class requirement.

---

## Language Settings

- **Default Response**: Korean
- **Code Comments**: English
- **Commit Messages**: English (Conventional Commits)
- **Documentation**: Korean + English technical terms

---

---

---

## Safety Rules

### Dangerous Commands (Require User Confirmation)

| Command | Risk | Description |
|---------|------|-------------|
| `rm -rf` | HIGH | Recursive force delete |
| `git reset --hard` | HIGH | Discard uncommitted changes |
| `DROP TABLE` | CRITICAL | Delete database table |
| `DROP DATABASE` | CRITICAL | Delete database |

---

## Forbidden Actions

- Direct push to main/develop branch
- Hardcoded secrets/API keys
- Execute dangerous commands without confirmation

---

**Profile**: web | **Updated**: 2026-09-24 (V3)
