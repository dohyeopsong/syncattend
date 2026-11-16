// Timetable utilities for the student web app.
//
// Mirrors the Flutter Timetable helper (mobile/lib/models/contract_models.dart):
// overlap detection, weekly-grid bounds, and the 8-color pastel palette for
// course blocks. day_of_week is 0=Mon..6=Sun per the contract.

import type { CourseScheduleSlot, MyCourseItem } from "@/api/types";

export const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

// Pastel palette for course blocks (mirrors the Flutter 8-color set).
export const COURSE_COLORS = [
  { bg: "bg-indigo-100 dark:bg-indigo-950/50", border: "border-indigo-300 dark:border-indigo-800", text: "text-indigo-800 dark:text-indigo-200" },
  { bg: "bg-emerald-100 dark:bg-emerald-950/50", border: "border-emerald-300 dark:border-emerald-800", text: "text-emerald-800 dark:text-emerald-200" },
  { bg: "bg-amber-100 dark:bg-amber-950/50", border: "border-amber-300 dark:border-amber-800", text: "text-amber-800 dark:text-amber-200" },
  { bg: "bg-rose-100 dark:bg-rose-950/50", border: "border-rose-300 dark:border-rose-800", text: "text-rose-800 dark:text-rose-200" },
  { bg: "bg-sky-100 dark:bg-sky-950/50", border: "border-sky-300 dark:border-sky-800", text: "text-sky-800 dark:text-sky-200" },
  { bg: "bg-violet-100 dark:bg-violet-950/50", border: "border-violet-300 dark:border-violet-800", text: "text-violet-800 dark:text-violet-200" },
  { bg: "bg-teal-100 dark:bg-teal-950/50", border: "border-teal-300 dark:border-teal-800", text: "text-teal-800 dark:text-teal-200" },
  { bg: "bg-orange-100 dark:bg-orange-950/50", border: "border-orange-300 dark:border-orange-800", text: "text-orange-800 dark:text-orange-200" },
];

export function courseColor(index: number) {
  return COURSE_COLORS[index % COURSE_COLORS.length];
}

// Two slots overlap if they share a day and their period ranges intersect.
export function slotsOverlap(
  a: CourseScheduleSlot,
  b: CourseScheduleSlot,
): boolean {
  if (a.day_of_week !== b.day_of_week) return false;
  return a.start_period <= b.end_period && b.start_period <= a.end_period;
}

// Flatten a course's schedule slots into {course, slot} pairs for grid layout.
export interface CourseSlotView {
  course: MyCourseItem;
  slot: CourseScheduleSlot;
}

export function flattenSchedules(
  courses: MyCourseItem[],
): CourseSlotView[] {
  const views: CourseSlotView[] = [];
  for (const course of courses) {
    if (course.schedules && course.schedules.length > 0) {
      for (const slot of course.schedules) {
        views.push({ course, slot });
      }
    } else if (
      course.day_of_week != null &&
      course.start_period != null &&
      course.end_period != null
    ) {
      // Fallback to scalar schedule fields when no slot array is present.
      views.push({
        course,
        slot: {
          id: course.id,
          course_id: course.id,
          day_of_week: course.day_of_week,
          start_period: course.start_period,
          end_period: course.end_period,
        },
      });
    }
  }
  return views;
}

// Courses with no schedule metadata at all — shown as chips below the grid.
export function unscheduledCourses(
  courses: MyCourseItem[],
): MyCourseItem[] {
  return courses.filter(
    (c) =>
      (!c.schedules || c.schedules.length === 0) &&
      (c.day_of_week == null ||
        c.start_period == null ||
        c.end_period == null),
  );
}

// Max period across all slots (min 9 so the grid always shows a full day).
export function maxPeriod(courses: MyCourseItem[]): number {
  let max = 9;
  for (const { slot } of flattenSchedules(courses)) {
    max = Math.max(max, slot.end_period);
  }
  return max;
}

// Max day-of-week across all slots (min 5 = Mon–Fri).
export function maxDay(courses: MyCourseItem[]): number {
  let max = 4; // 0..4 = Mon..Fri
  for (const { slot } of flattenSchedules(courses)) {
    max = Math.max(max, slot.day_of_week);
  }
  return max;
}

// Find courses whose slots overlap with the given slot (client-side clash
// pre-check before hitting the enroll endpoint).
export function conflictingCourses(
  slot: { day_of_week: number; start_period: number; end_period: number },
  courses: MyCourseItem[],
): MyCourseItem[] {
  const result: MyCourseItem[] = [];
  for (const c of courses) {
    for (const s of c.schedules ?? []) {
      if (
        slot.day_of_week === s.day_of_week &&
        slot.start_period <= s.end_period &&
        s.start_period <= slot.end_period
      ) {
        result.push(c);
        break;
      }
    }
  }
  return result;
}
