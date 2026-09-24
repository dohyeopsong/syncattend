# DESIGN GUIDE — Clean Minimal (Web + App)

**Project**: Syncattend (SDAS) — V3
**Direction (decided 2026-09-25)**: **Clean minimal** — white/neutral base + a single
indigo accent + 3 status colors. Same palette across the professor web (shadcn/ui +
Tailwind) and the student app (Flutter Material 3) for a unified demo look.

> Scope note: this is a capstone, not a product launch. Keep styling simple and
> consistent; do not over-engineer. Timetable/extra services are deferred.

---

## 1. Principles

1. **One accent color.** Indigo is the only brand color. Everything else is
   neutral (white / grays / near-black text). Emphasis comes from indigo, not
   from many colors.
2. **Whitespace over borders.** Prefer generous spacing and light hairline
   borders (`1px` neutral) + subtle shadow (`shadow-sm`) over heavy boxes.
3. **Hierarchy via type, not color.** Use size/weight/gray-scale for hierarchy;
   avoid colored text except for status.
4. **Status colors are limited to 3** (+ neutral): success / warning / danger.
5. **Rounded, calm.** `radius = 0.5rem` (8px) everywhere; no sharp corners.
6. **Accessibility.** Maintain contrast (text on white ≥ 4.5:1). Never encode
   attendance status by color alone — always pair with a label/icon.

---

## 2. Color tokens (single source of truth)

HSL values so they drop straight into the web CSS variables. Hex given for Flutter.

| Role | HSL | Hex | Use |
|------|-----|-----|-----|
| **Accent / Primary (Indigo)** | `243 75% 59%` | `#4F46E5` | primary buttons, active nav, key highlights, focus ring |
| Primary hover | `244 55% 51%` | `#4338CA` | hover/pressed |
| Primary subtle bg | `243 100% 97%` | `#EEF2FF` | selected rows, chips, info surfaces |
| Foreground (text) | `222 47% 11%` | `#111827` | primary text |
| Muted foreground | `215 16% 47%` | `#6B7280` | secondary text, captions |
| Background | `0 0% 100%` | `#FFFFFF` | page bg |
| Surface / Card | `0 0% 100%` | `#FFFFFF` | cards (rely on border+shadow) |
| Muted / subtle bg | `210 40% 98%` | `#F8FAFC` | table header, section bg |
| Border | `214 32% 91%` | `#E5E7EB` | hairlines, dividers, inputs |
| **Success (Present)** | `142 71% 45%` | `#22C55E` | present/verified |
| **Warning (At-risk/Pending)** | `38 92% 50%` | `#F59E0B` | pending, risk warning |
| **Danger (Absent/Reject)** | `0 84% 60%` | `#EF4444` | absent, verify rejected |

### Attendance status mapping (use everywhere, web + app)
| Status | Color | Label (always show) | Icon |
|--------|-------|---------------------|------|
| present / verified | Success green | "출석" | check-circle |
| pending / in-window | Warning amber | "대기" | clock |
| absent / rejected | Danger red | "결석"/사유 | x-circle |
| at-risk (3+ absences) | Warning amber banner | "위험" | alert-triangle |

---

## 3. Web (shadcn/ui + Tailwind) — apply to `web/src/index.css`

Update the `:root` CSS variables to the indigo accent (current file uses the
default near-black primary). Owner C applies this; keep the existing variable
names (already wired in `tailwind.config.js`).

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;

  --primary: 243 75% 59%;            /* indigo #4F46E5 */
  --primary-foreground: 210 40% 98%;

  --secondary: 210 40% 98%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 98%;
  --muted-foreground: 215 16% 47%;
  --accent: 243 100% 97%;            /* indigo subtle #EEF2FF */
  --accent-foreground: 243 75% 59%;

  --destructive: 0 84% 60%;          /* danger */
  --destructive-foreground: 210 40% 98%;
  --warning: 38 92% 50%;             /* warning */
  --warning-foreground: 0 0% 100%;

  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 243 75% 59%;               /* focus ring = indigo */
  --radius: 0.5rem;
}
```
(Add a `--success: 142 71% 45%` token + a `success` color in `tailwind.config.js`
if you want a themed success utility; otherwise use `text-green-600` sparingly.)

### Web layout conventions
- **Shell**: left sidebar (nav) + top bar + content. Sidebar item active = indigo
  text + `bg-accent`.
- **Cards**: `rounded-lg border bg-card shadow-sm p-6`. No heavy drop shadows.
- **Stat cards** (top of dashboard): label (muted, `text-sm`) + big number
  (`text-2xl font-semibold`) + optional delta. 4 across: 출석/대기/결석/미인증.
- **Data table** (attendance / opt-out): muted header row, hairline row dividers,
  status shown as a small colored **badge + label** (not just a dot).
- **Buttons**: primary = indigo solid; secondary = `variant=outline`; destructive
  = red only for irreversible actions (close session, mark absent).
- **Spacing scale**: 4 / 8 / 12 / 16 / 24 / 32 px. Section gap 24px.
- **Font**: system-ui stack (already set). Sizes: 12 caption / 14 body / 16 subtitle
  / 20 title / 24 page-title.

---

## 4. App (Flutter Material 3) — apply to `mobile/lib/main.dart`

Owner B applies. Replace the bare `colorSchemeSeed: Colors.indigo` with an explicit
seed + Material 3 so the app matches the web indigo exactly.

```dart
theme: ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xFF4F46E5),   // same indigo as web
    brightness: Brightness.light,
  ),
  scaffoldBackgroundColor: const Color(0xFFFFFFFF),
  cardTheme: CardTheme(
    elevation: 0,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
      side: const BorderSide(color: Color(0xFFE5E7EB)), // hairline border
    ),
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Colors.white,
    foregroundColor: Color(0xFF111827),
    elevation: 0,
    scrolledUnderElevation: 0.5,
  ),
),
```

### App conventions
- **Attendance verify screen (most important):** center a large **circular
  countdown** for the 1-min window; below it show two status chips — "QR" and
  "음향(audio)" — that flip gray → green as each signal is captured. Use a subtle
  **pulse animation** on the audio chip while listening. On success, a single
  green check; on failure, amber "다시 시도" (never a red "결석" — failure ≠ absent,
  per design doc: professor-in-the-loop).
- **Status colors**: reuse the same green/amber/red as the table above, always
  with a Korean label.
- **Cards/lists**: white surface, hairline border (`#E5E7EB`), 12px radius, no
  heavy shadow. Generous padding (16px).
- **Buttons**: FilledButton (indigo) for primary; OutlinedButton for secondary.
- **Empty/permission states**: friendly one-line explanation + a single action
  (e.g., "마이크 권한 허용"). Explain *why* (attendance proximity check).

---

## 5. Do / Don't

**Do**
- Keep one accent (indigo). Let neutrals dominate.
- Pair every status color with a text label + icon.
- Use whitespace and hairlines instead of boxes-in-boxes.

**Don't**
- Add gradients, multiple brand colors, or decorative illustrations.
- Encode meaning by color alone.
- Build timetable/extra services now (deferred — capstone scope).

---

*Owners: C applies §3 (web), B applies §4 (app). Tokens in §2 are the shared
source of truth — change them here first, then in code.*
