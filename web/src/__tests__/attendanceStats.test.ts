import { describe, expect, it } from "vitest";
import { deriveAttendanceStats } from "@/lib/status";
import type { AttendanceAggregate, AttendanceStatus } from "@/api/types";

// deriveAttendanceStats is the single source of truth for every derived
// attendance figure the dashboard shows (StatCards / AttendanceTable /
// RealtimeRiskPanel). These tests lock the values to the exact formulas the
// panels used before consolidation, so the "regression 0" guarantee holds.

const agg = (
  total: number,
  present: number,
  unverified: string[],
): AttendanceAggregate => ({
  session_id: "sess-1",
  total,
  present,
  unverified,
});

describe("deriveAttendanceStats", () => {
  it("returns zeros for a null aggregate (no session)", () => {
    const s = deriveAttendanceStats(null);
    expect(s).toEqual({
      total: 0,
      present: 0,
      unverified: 0,
      pendingCorrections: 0,
      absentCorrections: 0,
      presentShare: 0,
      unverifiedShare: 0,
      presentRate: 0,
      unverifiedRate: 0,
    });
  });

  it("counts total/present/unverified from the aggregate", () => {
    const s = deriveAttendanceStats(agg(3, 1, ["stu-2", "stu-3"]));
    expect(s.total).toBe(3);
    expect(s.present).toBe(1);
    expect(s.unverified).toBe(2);
  });

  it("matches the previous present-rate formula: round(present/total*100)", () => {
    // 1/3 = 33.33% -> 33 (AttendanceTable & StatCards showed this exact value)
    expect(deriveAttendanceStats(agg(3, 1, ["a", "b"])).presentRate).toBe(33);
    // 2/3 = 66.66% -> 67
    expect(deriveAttendanceStats(agg(3, 2, ["c"])).presentRate).toBe(67);
    expect(deriveAttendanceStats(agg(4, 4, [])).presentRate).toBe(100);
  });

  it("matches the previous unverified-share/rate formula: round(unverified/total*100)", () => {
    // RealtimeRiskPanel risk thresholds compare the 0..1 share.
    const s = deriveAttendanceStats(agg(4, 1, ["x", "y"])); // 2/4
    expect(s.unverifiedShare).toBeCloseTo(0.5, 10);
    expect(s.unverifiedRate).toBe(50);
  });

  it("guards divide-by-zero (total 0 -> shares/rates are 0, not NaN)", () => {
    const s = deriveAttendanceStats(agg(0, 0, []));
    expect(s.presentShare).toBe(0);
    expect(s.unverifiedShare).toBe(0);
    expect(s.presentRate).toBe(0);
    expect(s.unverifiedRate).toBe(0);
  });

  it("tallies queued pending/absent corrections from pendingDeltas (StatCards)", () => {
    const deltas: Record<string, AttendanceStatus> = {
      "stu-2": "present",
      "stu-3": "absent",
      "stu-4": "pending",
      "stu-5": "absent",
    };
    const s = deriveAttendanceStats(agg(5, 1, ["stu-2", "stu-3"]), deltas);
    expect(s.pendingCorrections).toBe(1);
    expect(s.absentCorrections).toBe(2);
  });

  it("defaults pendingDeltas to empty (RealtimeRiskPanel calls with aggregate only)", () => {
    const s = deriveAttendanceStats(agg(2, 2, []));
    expect(s.pendingCorrections).toBe(0);
    expect(s.absentCorrections).toBe(0);
  });
});
