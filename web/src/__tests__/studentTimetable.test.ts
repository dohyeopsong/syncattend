// @vitest-environment jsdom

// Tests for the ported student timetable utilities.
//
// Mirrors the Flutter Timetable helper behavior: overlap detection, weekly-grid
// bounds, and client-side clash pre-check used by the 수강신청 catalog.

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  conflictingCourses,
  flattenSchedules,
  maxDay,
  maxPeriod,
  slotsOverlap,
  unscheduledCourses,
} from "@/lib/studentTimetable";
import type { CourseScheduleSlot, DayOfWeek, MyCourseItem } from "@/api/types";
import { TimetablePage } from "@/pages/student/TimetablePage";
import { useStudentCoursesStore } from "@/store/studentCourses";

function slot(
  day: DayOfWeek,
  start: number,
  end: number,
  id = `s-${day}-${start}-${end}`,
): CourseScheduleSlot {
  return {
    id,
    course_id: "c1",
    day_of_week: day,
    start_period: start,
    end_period: end,
  };
}

function course(
  overrides: Partial<MyCourseItem> = {},
): MyCourseItem {
  return {
    id: "c1",
    professor_id: "p1",
    name: "자료구조",
    code: "CS101",
    department: "컴퓨터공학과",
    professor_name: "김교수",
    day_of_week: null,
    start_period: null,
    end_period: null,
    location: "공학관 101",
    credits: 3,
    schedules: [],
    ...overrides,
  };
}

describe("slotsOverlap", () => {
  it("returns false for different days", () => {
    expect(slotsOverlap(slot(0, 1, 2), slot(1, 1, 2))).toBe(false);
  });

  it("returns true when ranges intersect", () => {
    expect(slotsOverlap(slot(0, 1, 3), slot(0, 3, 5))).toBe(true);
  });

  it("returns false for adjacent non-overlapping ranges", () => {
    expect(slotsOverlap(slot(0, 1, 2), slot(0, 3, 4))).toBe(false);
  });
});

describe("flattenSchedules", () => {
  it("expands multi-slot schedules into views", () => {
    const c = course({
      schedules: [slot(0, 1, 2), slot(2, 3, 4)],
    });
    const views = flattenSchedules([c]);
    expect(views).toHaveLength(2);
    expect(views[0].slot.day_of_week).toBe(0);
    expect(views[1].slot.day_of_week).toBe(2);
  });

  it("falls back to scalar fields when no slot array", () => {
    const c = course({
      schedules: [],
      day_of_week: 1,
      start_period: 1,
      end_period: 2,
    });
    const views = flattenSchedules([c]);
    expect(views).toHaveLength(1);
    expect(views[0].slot.day_of_week).toBe(1);
  });
});

describe("grid bounds", () => {
  it("maxPeriod defaults to 9", () => {
    expect(maxPeriod([course()])).toBe(9);
  });

  it("maxPeriod grows with the latest end_period", () => {
    const c = course({ schedules: [slot(0, 1, 11)] });
    expect(maxPeriod([c])).toBe(11);
  });

  it("maxDay defaults to 4 (Mon–Fri)", () => {
    expect(maxDay([course()])).toBe(4);
  });

  it("maxDay grows to include Saturday (5)", () => {
    const c = course({ schedules: [slot(5, 1, 2)] });
    expect(maxDay([c])).toBe(5);
  });
});

describe("unscheduledCourses", () => {
  it("lists courses with no schedule metadata", () => {
    const scheduled = course({ schedules: [slot(0, 1, 2)] });
    const unscheduled = course({ id: "c2", schedules: [] });
    expect(unscheduledCourses([scheduled, unscheduled])).toEqual([unscheduled]);
  });

  it("treats scalar-only schedule as scheduled", () => {
    const c = course({
      schedules: [],
      day_of_week: 0,
      start_period: 1,
      end_period: 2,
    });
    expect(unscheduledCourses([c])).toHaveLength(0);
  });
});

describe("conflictingCourses", () => {
  it("finds an enrolled course that overlaps the candidate slot", () => {
    const enrolled = course({
      id: "enrolled-1",
      schedules: [slot(0, 1, 3)], // Mon 1~3
    });
    const candidate = { day_of_week: 0, start_period: 3, end_period: 5 }; // Mon 3~5 — overlaps at 3
    expect(conflictingCourses(candidate, [enrolled])).toEqual([enrolled]);
  });

  it("returns empty when no enrolled course overlaps", () => {
    const enrolled = course({
      id: "enrolled-1",
      schedules: [slot(0, 1, 2)],
    });
    const candidate = { day_of_week: 0, start_period: 3, end_period: 4 };
    expect(conflictingCourses(candidate, [enrolled])).toHaveLength(0);
  });
});

describe("TimetablePage empty state", () => {
  beforeEach(() => {
    useStudentCoursesStore.setState({
      myCourses: [],
      myCoursesStatus: "loading",
      myCoursesError: null,
      catalog: [],
      catalogStatus: "idle",
      catalogError: null,
      enrollingId: null,
      loadMyCourses: vi.fn(async () => {}),
      loadCatalog: vi.fn(async () => {}),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the timetable and opens course search while courses are loading", () => {
    render(createElement(TimetablePage));

    expect(screen.getByText("내 시간표")).toBeInTheDocument();
    expect(screen.getByText("월")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "강좌 찾기" }));

    expect(
      screen.getByRole("dialog", { name: "강좌 찾기" }),
    ).toBeInTheDocument();
  });
});
