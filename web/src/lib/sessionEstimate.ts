// Local (client-side) session week + slot estimation.
//
// Mirrors the backend's app/services/session_estimate.py + app/periods.py so the
// open-session modal can pre-fill the week + slot WITHOUT a network round-trip.
// This keeps the modal responsive even when the backend is slow/unavailable —
// the professor sees the estimate immediately and can confirm/edit before
// creating the session.

import type { CourseScheduleSlot } from "@/api/types";

// Period rules (identical to app/periods.py).
const PERIOD_START_HOUR = 9; // 1교시 starts at 09:00
const PERIOD_MINUTES = 60; // each period is 60 minutes
const MIN_PERIOD = 1;
const MAX_PERIOD = 12; // 12교시: 20:00~21:00

// Week bounds (a semester is 15 weeks).
const MIN_WEEK = 1;
const MAX_WEEK = 15;

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

/** Current time in KST (Asia/Seoul), regardless of the user's local timezone. */
export function nowKST(): Date {
  // new Date() with toLocaleString gives us KST wall-clock components without
  // pulling in a tz library. We build a fresh Date from the parts so downstream
  // .getHours()/.getDay() etc. read KST values.
  const now = new Date();
  const kstParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string =>
    kstParts.find((p) => p.type === type)?.value ?? "0";
  // Intl hour12:false can still emit "24" at midnight; normalize to 0.
  const hour = Number(get("hour")) % 24;
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    hour,
    Number(get("minute")),
    Number(get("second")),
  );
}

/**
 * Academic week number (1..15) for `today` given `semesterStart` (the Monday of
 * week 1). Returns null if semesterStart is null or `today` is outside weeks
 * 1..15 (before semester start, or past week 15).
 */
export function weekNumberFor(
  today: Date,
  semesterStart: string | null,
): number | null {
  if (!semesterStart) return null;
  const start = new Date(semesterStart + "T00:00:00");
  if (isNaN(start.getTime())) return null;
  // Align both dates to their Monday so the diff is in whole weeks even if the
  // start_date is not itself a Monday.
  const todayMon = new Date(today);
  todayMon.setDate(todayMon.getDate() - ((todayMon.getDay() + 6) % 7));
  const startMon = new Date(start);
  startMon.setDate(startMon.getDate() - ((startMon.getDay() + 6) % 7));
  const deltaDays = Math.floor(
    (todayMon.getTime() - startMon.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (deltaDays < 0) return null; // before the semester starts
  const week = Math.floor(deltaDays / 7) + 1;
  if (week < MIN_WEEK || week > MAX_WEEK) return null;
  return week;
}

/**
 * The class period (1..12) whose time band contains `now`, or null.
 * Period N occupies [09:00 + (N-1)h, 09:00 + N*h). Returns null outside
 * 09:00..21:00.
 */
export function currentPeriod(now: Date): number | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = PERIOD_START_HOUR * 60;
  if (minutes < startMinutes) return null;
  const elapsed = minutes - startMinutes;
  const period = Math.floor(elapsed / PERIOD_MINUTES) + 1;
  if (period < MIN_PERIOD || period > MAX_PERIOD) return null;
  return period;
}

/** Human label for a slot, e.g. '월 1교시' or '화 2~3교시'. */
export function slotLabel(slot: CourseScheduleSlot): string {
  const day = DAY_LABELS[slot.day_of_week] ?? "?";
  if (slot.start_period === slot.end_period) {
    return `${day} ${slot.start_period}교시`;
  }
  return `${day} ${slot.start_period}~${slot.end_period}교시`;
}

export interface LocalEstimate {
  weekNumber: number | null;
  scheduleId: string | null;
  scheduleLabel: string | null;
}

/**
 * Estimate (week_number, schedule_id, schedule_label) for a new session using
 * the current KST time + the course's semester_start_date + its weekly slots.
 * Pure + synchronous — no network. All three can be null when estimation is
 * impossible (no semester_start, no matching slot, out of semester range).
 */
export function estimateLocally(
  semesterStart: string | null,
  slots: CourseScheduleSlot[],
): LocalEstimate {
  const now = nowKST();
  const weekNumber = weekNumberFor(now, semesterStart);
  const period = currentPeriod(now);
  // JS getDay(): Sun=0..Sat=6. Convert to Mon=0..Sun=6 to match
  // CourseSchedule.day_of_week.
  const todayDow = (now.getDay() + 6) % 7;

  let matched: CourseScheduleSlot | null = null;
  if (period !== null) {
    matched =
      slots.find(
        (s) =>
          s.day_of_week === todayDow &&
          s.start_period <= period &&
          s.end_period >= period,
      ) ?? null;
  }

  return {
    weekNumber,
    scheduleId: matched?.id ?? null,
    scheduleLabel: matched ? slotLabel(matched) : null,
  };
}
