import { describe, expect, it } from "vitest";
import {
  matrixToRows,
  riskScore,
  absentCount,
  lateCount,
  RISK_THRESHOLD,
  WEEKS,
} from "@/lib/attendanceMatrix";
import type { AttendanceMatrix, AttendanceStatus } from "@/api/types";

// The F-grade risk panel + weekly trend chart both consume matrixToRows().
// These tests lock the mapping from the API response to StudentRow[] and the
// risk-score formula, so the two panels can never drift.

function row(
  weeks: (AttendanceStatus | null)[],
): ReturnType<typeof matrixToRows>[number] {
  return { student_id: "s", student_number: null, name: null, weeks };
}

const resp: AttendanceMatrix = {
  course_id: "c1",
  course_name: "자료구조",
  weeks: [1, 2, 3],
  students: [
    {
      student_id: "s1",
      student_number: "20240001",
      name: "가학생",
      // week1 absent, week2 late, week3 present, rest null
      weeks: ["absent", "late", "present", ...Array(WEEKS - 3).fill(null)],
    },
    {
      student_id: "s2",
      student_number: "20240002",
      name: "나학생",
      // 5 absences -> at F-risk (RISK_THRESHOLD = 5.0)
      weeks: ["absent", "absent", "absent", "absent", "absent", ...Array(WEEKS - 5).fill(null)],
    },
  ],
};

describe("matrixToRows", () => {
  it("maps the API response 1:1 into StudentRow[] (15-element weeks)", () => {
    const rows = matrixToRows(resp);
    expect(rows).toHaveLength(2);
    expect(rows[0].student_id).toBe("s1");
    expect(rows[0].student_number).toBe("20240001");
    expect(rows[0].name).toBe("가학생");
    expect(rows[0].weeks).toHaveLength(WEEKS);
    expect(rows[0].weeks[0]).toBe("absent");
    expect(rows[0].weeks[2]).toBe("present");
    expect(rows[0].weeks[3]).toBeNull();
  });
});

describe("riskScore / counts", () => {
  it("weights absent=1.0, late=0.3, pending=0.7, present/early_leave/null=0", () => {
    expect(riskScore(row(["absent", "late", "present", "pending", "early_leave", null]))).toBe(
      1.0 + 0.3 + 0 + 0.7 + 0 + 0,
    );
  });

  it("flags a student at or above the F-risk threshold", () => {
    const rows = matrixToRows(resp);
    expect(riskScore(rows[1])).toBeGreaterThanOrEqual(RISK_THRESHOLD);
    expect(riskScore(rows[0])).toBeLessThan(RISK_THRESHOLD);
  });

  it("counts absences and lates per student", () => {
    const rows = matrixToRows(resp);
    expect(absentCount(rows[0])).toBe(1);
    expect(lateCount(rows[0])).toBe(1);
    expect(absentCount(rows[1])).toBe(5);
    expect(lateCount(rows[1])).toBe(0);
  });
});
