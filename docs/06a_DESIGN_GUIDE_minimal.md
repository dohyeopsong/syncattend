# DESIGN GUIDE — Soft Campus (Web + App)

**Project**: Syncattend (SDAS) — V3
**Direction (updated 2026-10-14)**: **Soft Campus** — warm tinted ground + a single
soft indigo accent + rounder surfaces with soft layered shadows + pastel icon-badge
backgrounds. Same palette across the professor web (shadcn/ui + Tailwind) and the
student app (Flutter Material 3) for a unified, friendly look.

> Supersedes the earlier "Clean Minimal" guide (2026-09-25). The core principle —
> one accent, limited status colors, accessibility — is unchanged; the treatment
> is warmer and rounder to feel approachable for both students and professors.

---

## 1. Principles

1. **One accent color.** Soft indigo is the only brand color. Everything else is
   neutral (warm light gray ground / slate text / near-white cards). Emphasis
   comes from indigo, not from many colors.
2. **Soft shadows over heavy borders.** Prefer generous spacing, hairline borders
   (`1px` neutral at 60% opacity), and **soft layered shadows** over heavy boxes.
   Cards "float" on a warm tinted ground.
3. **Hierarchy via type + icon badges.** Use size/weight/slate-scale for
   hierarchy. Icons sit inside **colored pastel badge circles** (indigo/green/
   amber/red at 10% opacity) for a friendly, scannable feel.
4. **Status colors are limited to 3** (+ neutral): success / warning / danger.
5. **Rounded, calm.** `radius = 1rem` (16px) for cards, `0.75rem` (12px) for
   buttons and inputs. No sharp corners.
6. **Accessibility.** Maintain contrast (text on white ≥ 4.5:1). Never encode
   attendance status by color alone — always pair with a label/icon. All
   decorative motion is gated behind `prefers-reduced-motion`.

---

## 2. Color tokens (single source of truth)

HSL values for the web CSS variables (`web/src/index.css :root`). Hex for Flutter
(`mobile/lib/core/design.dart AppColors`).

| Role | HSL | Hex | Use |
|------|-----|-----|-----|
| **Accent / Primary (Indigo)** | `239 84% 67%` | `#6366F1` | primary buttons, active nav, key highlights, focus ring |
| Primary hover | `243 75% 59%` | `#4F46E5` | hover/pressed |
| Primary subtle bg | `239 84% 94%` | `#E8EAFE` | selected rows, chips, icon-badge bg |
| Foreground (text) | `215 28% 17%` | `#1E293B` | primary text — slate-800 |
| Muted foreground | `215 16% 47%` | `#64748B` | secondary text — slate-500 |
| **Background** | `230 25% 97%` | `#F6F8FC` | page bg — warm tinted blue-gray |
| Surface / Card | `0 0% 100%` | `#FFFFFF` | cards float on tinted ground |
| Muted / subtle bg | `210 40% 96%` | `#F1F5F9` | table header, section bg |
| Border | `214 32% 91%` | `#E2E8F0` | hairlines — slate-200 |
| **Success (Present)** | `142 71% 45%` | `#22C55E` | present/verified |
| **Warning (At-risk/Pending)** | `38 92% 50%` | `#F59E0B` | pending, risk warning |
| **Danger (Absent/Reject)** | `0 84% 60%` | `#EF4444` | absent, verify rejected |

### Pastel icon-badge backgrounds (app + web)

| Badge | Hex | Use |
|-------|-----|-----|
| Indigo badge bg | `#EEF0FF` | neutral/info icon circles |
| Green badge bg | `#DCFCE7` | success/present icon circles |
| Amber badge bg | `#FEF3C7` | warning/pending icon circles |
| Red badge bg | `#FEE2E2` | danger/absent icon circles |

### Soft shadows (web)

| Token | Value |
|-------|-------|
| `shadow-soft` | `0 2px 8px -2px rgba(30,41,59,0.06), 0 1px 3px -1px rgba(30,41,59,0.04)` |
| `shadow-soft-md` | `0 4px 16px -4px rgba(30,41,59,0.08), 0 2px 6px -2px rgba(30,41,59,0.04)` |
| `shadow-soft-lg` | `0 8px 32px -8px rgba(30,41,59,0.10), 0 4px 12px -4px rgba(30,41,59,0.05)` |

### Attendance status mapping (use everywhere, web + app)

| Status | Color | Label (always show) | Icon |
|--------|-------|---------------------|------|
| present / verified | Success green | "출석" | check-circle |
| pending / in-window | Warning amber | "대기" | clock |
| absent / rejected | Danger red | "결석"/사유 | x-circle |
| at-risk (3+ absences) | Warning amber banner | "위험" | alert-triangle |

---

## 3. Web (shadcn/ui + Tailwind) — `web/src/index.css`

The `:root` CSS variables are the source of truth. Tailwind maps each token to
`hsl(var(--token))` in `tailwind.config.js`.

```css
:root {
  --background: 230 25% 97%;          /* #F6F8FC warm tinted ground */
  --foreground: 215 28% 17%;          /* #1E293B slate-800 */
  --card: 0 0% 100%;                  /* #FFFFFF */
  --card-foreground: 215 28% 17%;

  --primary: 239 84% 67%;             /* #6366F1 softer indigo */
  --primary-foreground: 0 0% 100%;

  --secondary: 210 40% 96%;           /* #F1F5F9 */
  --secondary-foreground: 215 28% 17%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;    /* #64748B slate-500 */
  --accent: 239 84% 94%;              /* #E8EAFE indigo subtle */
  --accent-foreground: 239 84% 67%;

  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --warning: 38 92% 50%;
  --warning-foreground: 0 0% 100%;
  --success: 142 71% 45%;
  --success-foreground: 0 0% 100%;

  --border: 214 32% 91%;              /* #E2E8F0 */
  --input: 214 32% 91%;
  --ring: 239 84% 67%;
  --radius: 1rem;                     /* 16px — rounder, friendlier */
}
```

### Web layout conventions
- **Shell**: left sidebar (240px → 256px, `w-64`) with nav. Active nav item =
  indigo-tinted bg (`bg-primary/10`) + indigo text + `shadow-soft`. Each nav
  icon sits in a **8×8 rounded-lg badge** (indigo bg when active, muted bg
  otherwise).
- **Cards**: `rounded-2xl border border-border/60 bg-card shadow-soft p-6`.
  Soft shadow, not heavy.
- **Stat cards** (top of dashboard): each has a **colored icon badge**
  (10×10 `rounded-xl`, status color at `/10` opacity), big number
  (`text-2xl font-bold`), label. 4 across: 출석/대기/결석/미인증.
- **Buttons**: primary = indigo solid + `shadow-soft` + `active:scale-[0.98]`
  micro-interaction; `rounded-xl`. Secondary = `variant=outline`. Destructive
  = red only for irreversible actions.
- **Spacing scale**: 4 / 8 / 12 / 16 / 24 / 32 px. Section gap 24px.
- **Font**: `"Pretendard", system-ui, -apple-system, "Segoe UI", sans-serif`.
  Sizes: 12 caption / 14 body / 16 subtitle / 20 title / 24 page-title.

---

## 4. App (Flutter Material 3) — `mobile/lib/main.dart` + `mobile/lib/core/design.dart`

`AppColors` in `design.dart` is the source of truth. `main.dart` applies it via
`ThemeData`.

```dart
theme: ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xFF6366F1),  // softer indigo, same as web
    brightness: Brightness.light,
  ),
  scaffoldBackgroundColor: AppColors.mutedBg,  // #F6F8FC warm tinted ground
  cardTheme: CardThemeData(
    elevation: 0,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(16),  // rounder, friendlier
      side: BorderSide(color: AppColors.border.withValues(alpha: 0.6)),
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: AppColors.indigo,
      minimumSize: const Size(0, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
  ),
),
```

### App conventions
- **Attendance verify screen (most important):** center a large **circular
  countdown** for the 1-min window; below it show the 3-layer defense steps
  (QR 인식 → 음향 수신 → 서버 검증) that flip gray → green as each completes.
  On success, a single green check; on failure, amber "다시 시도" (never a red
  "결석" — failure ≠ absent, per design doc: professor-in-the-loop).
- **Icon badges**: icons sit inside **colored pastel circles** (72×72 for
  headers, 8×8 for inline) using `badgeIndigoBg`/`badgeGreenBg`/`badgeAmberBg`/
  `badgeRedBg` from `AppColors`.
- **Cards**: use `softCardDecoration()` from `design.dart` — white bg,
  `border` at 60% opacity, `shadowSoft`, 16px radius. Generous padding (16px).
- **Buttons**: FilledButton (indigo, 48px height, 12px radius) for primary;
  OutlinedButton for secondary.
- **Empty/permission states**: friendly one-line explanation + pastel icon
  badge + a single action (e.g., "마이크 권한 허용").

---

## 5. Do / Don't

**Do**
- Keep one accent (soft indigo `#6366F1`). Let warm neutrals dominate.
- Pair every status color with a text label + icon.
- Use soft shadows and hairlines instead of boxes-in-boxes.
- Put icons inside pastel badge circles for a friendly, scannable feel.
- Use `shadow-soft` / `AppColors.shadowSoft` on cards and primary buttons.

**Don't**
- Add gradients, multiple brand colors, or decorative illustrations.
- Encode meaning by color alone.
- Use sharp corners (min radius 12px for buttons, 16px for cards).
- Use raw `Colors.xxx.shade*` — always use `AppColors` tokens.

---

*§3 applies to the web app, §4 to the Flutter app. Tokens in §2 are the shared
source of truth — change them here first, then in code. The web CSS variables
(`web/src/index.css :root`) and Flutter `AppColors` (`mobile/lib/core/design.dart`)
must always match this document.*
