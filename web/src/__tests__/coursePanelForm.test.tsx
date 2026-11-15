// @vitest-environment jsdom
//
// Component/pure-logic tests for the professor CoursePanel form helpers.
// Runs in a jsdom environment (opt-in via the docblock above) so the
// `useDebounced` React hook can be exercised with @testing-library/react's
// renderHook. The pure functions (periodError, formToPayload) need no DOM but
// live in the same module, so they are covered here too.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  periodError,
  formToPayload,
  useDebounced,
  type CourseForm,
} from "@/components/CoursePanel";

// Base form with every field blank — tests override only what they exercise.
function makeForm(overrides: Partial<CourseForm> = {}): CourseForm {
  return {
    name: "",
    code: "",
    department: "",
    professor_name: "",
    slots: [],
    location: "",
    credits: "",
    semester_start_date: "",
    ...overrides,
  };
}

// Helper: a complete slot (day + both periods).
function slot(day: string, start: string, end: string) {
  return { day_of_week: day, start_period: start, end_period: end };
}

describe("periodError — per-slot validation", () => {
  it("flags start > end within a slot", () => {
    const err = periodError(makeForm({ slots: [slot("2", "5", "3")] }));
    expect(err).toBe("시작 교시는 종료 교시보다 앞서야 합니다.");
  });

  it("accepts start < end", () => {
    expect(periodError(makeForm({ slots: [slot("2", "1", "3")] }))).toBeNull();
  });

  it("accepts start == end (single-period course)", () => {
    expect(periodError(makeForm({ slots: [slot("2", "2", "2")] }))).toBeNull();
  });

  it("flags a partially filled slot (day but no periods)", () => {
    expect(periodError(makeForm({ slots: [slot("2", "", "")] }))).toBe(
      "요일·시작 교시·종료 교시를 모두 선택하세요.",
    );
  });

  it("returns null when there are no slots", () => {
    expect(periodError(makeForm())).toBeNull();
  });

  it("skips fully-blank slots and validates the rest", () => {
    expect(
      periodError(
        makeForm({ slots: [slot("", "", ""), slot("1", "2", "1")] }),
      ),
    ).toBe("시작 교시는 종료 교시보다 앞서야 합니다.");
  });
});

describe("formToPayload — blank strings become null, schedules emitted", () => {
  it("maps every blank optional field to null and trims name", () => {
    const payload = formToPayload(makeForm({ name: "  소프트웨어공학  " }));
    expect(payload.name).toBe("소프트웨어공학");
    expect(payload.code).toBeNull();
    expect(payload.department).toBeNull();
    expect(payload.professor_name).toBeNull();
    expect(payload.day_of_week).toBeNull();
    expect(payload.start_period).toBeNull();
    expect(payload.end_period).toBeNull();
    expect(payload.location).toBeNull();
    expect(payload.credits).toBeNull();
    // No complete slots → empty schedules array.
    expect(payload.schedules).toEqual([]);
  });

  it("treats whitespace-only strings as null", () => {
    const payload = formToPayload(
      makeForm({ name: "X", code: "   ", location: "\t" }),
    );
    expect(payload.code).toBeNull();
    expect(payload.location).toBeNull();
  });

  it("coerces a complete slot into a schedules entry + mirrored scalar", () => {
    const payload = formToPayload(
      makeForm({
        name: "자료구조",
        code: "  SW2001  ",
        department: "소프트웨어학과",
        professor_name: "김교수",
        slots: [slot("3", "4", "6")],
        location: "공학관 302",
        credits: "3",
      }),
    );
    expect(payload.code).toBe("SW2001");
    expect(payload.day_of_week).toBe(3);
    expect(payload.start_period).toBe(4);
    expect(payload.end_period).toBe(6);
    expect(payload.credits).toBe(3);
    expect(payload.professor_name).toBe("김교수");
    expect(payload.schedules).toEqual([
      { day_of_week: 3, start_period: 4, end_period: 6 },
    ]);
  });

  it("emits multiple slots and mirrors the scalar from the first complete one", () => {
    const payload = formToPayload(
      makeForm({
        name: "운영체제",
        slots: [slot("1", "3", "4"), slot("0", "1", "2")],
      }),
    );
    expect(payload.schedules).toHaveLength(2);
    // First complete slot in row order is (화 3~4) → scalar mirrors it.
    expect(payload.day_of_week).toBe(1);
    expect(payload.start_period).toBe(3);
    expect(payload.end_period).toBe(4);
  });

  it("drops incomplete slots from the schedules payload", () => {
    const payload = formToPayload(
      makeForm({ name: "X", slots: [slot("1", "3", "4"), slot("2", "", "")] }),
    );
    expect(payload.schedules).toEqual([
      { day_of_week: 1, start_period: 3, end_period: 4 },
    ]);
  });
});

describe("useDebounced — value settles only after the delay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounced("a", 200));
    expect(result.current).toBe("a");
  });

  it("does not update before the delay elapses, then updates once", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounced(value, 200),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    // still stale before the timer fires
    expect(result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("b");
  });

  it("resets the timer on rapid successive changes (only last value wins)", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounced(value, 200),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender({ value: "c" }); // resets the 200ms window
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // 300ms of wall time, but only 150ms since the last change → still stale
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe("c");
  });
});
