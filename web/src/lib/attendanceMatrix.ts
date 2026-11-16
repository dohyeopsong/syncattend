import type { AttendanceMatrix, AttendanceStatus } from "@/api/types";

// Cumulative attendance matrix helpers for the F-grade risk visualizations.
//
// The data comes from GET /courses/{id}/attendance/matrix (AttendanceMatrix).
// RiskGraphPanel (heatmap) and AbsenceRankChart (weekly trend line) share the
// same StudentRow[] so their numbers always agree.

/** 학생 한 명의 주차별 출결 기록. */
export interface StudentRow {
  student_id: string;
  student_number: string | null;
  name: string | null;
  /** 1~15주차 상태. null = 해당 주차에 수업 없음/미개설. */
  weeks: (AttendanceStatus | null)[];
}

export const WEEKS = 15;

/** 위험 가중치 — 결석 1.0, 미인증 0.7, 지각 0.3, 나머지 0. */
export const RISK_WEIGHT: Record<AttendanceStatus, number> = {
  present: 0,
  late: 0.3,
  early_leave: 0,
  absent: 1.0,
  pending: 0.7,
};

/** F 위험선 — 누적 가중 합계가 이 값 이상이면 F 위험. */
export const RISK_THRESHOLD = 5.0;

/** 학생 한 명의 위험 점수(가중 합계). */
export function riskScore(row: StudentRow): number {
  return row.weeks.reduce((sum, w) => sum + (w ? RISK_WEIGHT[w] : 0), 0);
}

/** 학생 한 명의 결석 누계. */
export function absentCount(row: StudentRow): number {
  return row.weeks.filter((w) => w === "absent").length;
}

/** 학생 한 명의 지각 누계. */
export function lateCount(row: StudentRow): number {
  return row.weeks.filter((w) => w === "late").length;
}

/**
 * Convert the API matrix response into the StudentRow[] shape the panels
 * consume. The backend already returns a 15-element `weeks` array per student
 * (index 0 = week 1, null = no session), so this is a direct mapping.
 */
export function matrixToRows(resp: AttendanceMatrix): StudentRow[] {
  return resp.students.map((s) => ({
    student_id: s.student_id,
    student_number: s.student_number,
    name: s.name,
    weeks: s.weeks,
  }));
}
