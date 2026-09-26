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
    day_of_week: "",
    start_period: "",
    end_period: "",
    location: "",
    credits: "",
    ...overrides,
  };
}

describe("periodError — start must not exceed end", () => {
  it("flags start > end with the Korean validation message", () => {
    const err = periodError(makeForm({ start_period: "5", end_period: "3" }));
    expect(err).toBe("시작 교시는 종료 교시보다 앞서야 합니다.");
  });

  it("accepts start < end", () => {
    expect(periodError(makeForm({ start_period: "1", end_period: "3" }))).toBeNull();
  });

  it("accepts start == end (single-period course)", () => {
    expect(periodError(makeForm({ start_period: "2", end_period: "2" }))).toBeNull();
  });

  it("returns null when either period is blank (nothing to validate yet)", () => {
    expect(periodError(makeForm({ start_period: "3", end_period: "" }))).toBeNull();
    expect(periodError(makeForm({ start_period: "", end_period: "3" }))).toBeNull();
    expect(periodError(makeForm())).toBeNull();
  });
});

describe("formToPayload — blank strings become null, numbers are coerced", () => {
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
  });

  it("treats whitespace-only strings as null", () => {
    const payload = formToPayload(makeForm({ name: "X", code: "   ", location: "\t" }));
    expect(payload.code).toBeNull();
    expect(payload.location).toBeNull();
  });

  it("coerces numeric/day fields and trims string fields", () => {
    const payload = formToPayload(
      makeForm({
        name: "자료구조",
        code: "  SW2001  ",
        department: "소프트웨어학과",
        professor_name: "김교수",
        day_of_week: "3",
        start_period: "4",
        end_period: "6",
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
