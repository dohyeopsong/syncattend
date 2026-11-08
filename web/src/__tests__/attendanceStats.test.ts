import { describe, expect, it } from "vitest";
import { deriveAttendanceStats } from "@/lib/status";
import type { AttendanceAggregate, AttendanceStatus } from "@/api/types";

// deriveAttendanceStats is the single source of truth for every derived
// attendance figure the dashboard shows (StatCards / AttendanceTable /
// RealtimeRiskPanel). These tests lock the values to the exact formulas the
// panels use, so the numbers can never drift between panels.

// Helper: build an aggregate whose unverified list is a set of student ids,
// expanded into the UnverifiedStudent object shape the API returns.
const agg = (
  total: number,
  present: number,
  unverified: string[],
  extra: Partial<AttendanceAggregate> = {},
): AttendanceAggregate => ({
  session_id: "sess-1",
  total,
  present,
  absent: 0,
  late: 0,
  early_leave: 0,
  unverified: unverified.map((student_id) => ({ student_id })),
  ...extra,
});

describe("deriveAttendanceStats", () => {
  it("returns zeros for a null aggregate (no session)", () => {
    const s = deriveAttendanceStats(null);
    expect(s.total).toBe(0);
    expect(s.present).toBe(0);
    expect(s.absent).toBe(0);
    expect(s.late).toBe(0);
    expect(s.earlyLeave).toBe(0);
    expect(s.unverified).toBe(0);
    expect(s.pendingCorrections).toBe(0);
    expect(s.presentFinal).toBe(0);
    expect(s.absentFinal).toBe(0);
    expect(s.lateFinal).toBe(0);
    expect(s.earlyLeaveFinal).toBe(0);
    expect(s.unverifiedFinal).toBe(0);
    expect(s.presentRate).toBe(0);
    expect(s.absentFinalRate).toBe(0);
    expect(s.lateFinalRate).toBe(0);
    expect(s.earlyLeaveFinalRate).toBe(0);
    expect(s.unverifiedFinalRate).toBe(0);
  });

  it("counts total/present/late/early_leave/unverified from the aggregate", () => {
    const s = deriveAttendanceStats(
      agg(5, 1, ["stu-4", "stu-5"], { late: 1, early_leave: 1, absent: 0 }),
    );
    expect(s.total).toBe(5);
    expect(s.present).toBe(1);
    expect(s.late).toBe(1);
    expect(s.earlyLeave).toBe(1);
    expect(s.unverified).toBe(2);
  });

  it("matches the present-rate formula: round(present/total*100)", () => {
    // 1/3 = 33.33% -> 33
    expect(deriveAttendanceStats(agg(3, 1, ["a", "b"])).presentRate).toBe(33);
    // 2/3 = 66.66% -> 67
    expect(deriveAttendanceStats(agg(3, 2, ["c"])).presentRate).toBe(67);
    expect(deriveAttendanceStats(agg(4, 4, [])).presentRate).toBe(100);
  });

  it("guards divide-by-zero (total 0 -> rates are 0, not NaN)", () => {
    const s = deriveAttendanceStats(agg(0, 0, []));
    expect(s.presentRate).toBe(0);
    expect(s.unverifiedFinalRate).toBe(0);
  });

  it("tallies queued pending corrections from pendingDeltas (StatCards)", () => {
    const deltas: Record<string, AttendanceStatus> = {
      "stu-2": "present",
      "stu-3": "absent",
      "stu-4": "pending",
      "stu-5": "absent",
    };
    const s = deriveAttendanceStats(agg(5, 1, ["stu-2", "stu-3"]), deltas);
    expect(s.pendingCorrections).toBe(1); // only stu-4 is "pending"
  });

  it("defaults pendingDeltas to empty (RealtimeRiskPanel calls with aggregate only)", () => {
    const s = deriveAttendanceStats(agg(2, 2, []));
    expect(s.pendingCorrections).toBe(0);
  });

  it("live tiles move unverified students to present/absent/late/early_leave", () => {
    // 5 enrolled, 1 server-present, 4 unverified. Professor marks one present,
    // one absent, one late, one early_leave → all move out of 미인증 live.
    const deltas: Record<string, AttendanceStatus> = {
      "stu-2": "present",
      "stu-3": "absent",
      "stu-4": "late",
      "stu-5": "early_leave",
    };
    const s = deriveAttendanceStats(
      agg(5, 1, ["stu-2", "stu-3", "stu-4", "stu-5"]),
      deltas,
    );
    expect(s.presentFinal).toBe(2); // 1 server + 1 marked
    expect(s.absentFinal).toBe(1);
    expect(s.lateFinal).toBe(1);
    expect(s.earlyLeaveFinal).toBe(1);
    expect(s.unverifiedFinal).toBe(0); // 4 - 4 marked
    expect(s.presentRate).toBe(40); // 2/5
    expect(s.absentFinalRate).toBe(20); // 1/5
    expect(s.lateFinalRate).toBe(20); // 1/5
    expect(s.earlyLeaveFinalRate).toBe(20); // 1/5
  });
});
