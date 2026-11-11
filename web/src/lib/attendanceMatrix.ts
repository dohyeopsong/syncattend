import type { AttendanceStatus } from "@/api/types";

// Shared dummy attendance matrix for the F-grade risk visualizations.
//
// 15주차 × 학생(35명) 더미 출결 데이터. RiskGraphPanel(히트맵)과
// AbsenceRankChart(결석 랭킹 막대)가 같은 데이터를 공유해 숫자가 일치한다.
//
// ⚠️ CLI A가 "강좌별 학생 누적 출결" API를 추가하면 buildMatrix()를 실제
// 응답을 파싱하는 코드로 교체. 반환형 StudentRow[]만 유지하면 두 컴포넌트
// 모두 수정 없이 동작한다.

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

// 결정적 의사난수 — 새로고침마다 바뀌지 않게.
function makeRng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function pickStatus(rand: () => number): AttendanceStatus {
  const r = rand();
  if (r < 0.78) return "present";
  if (r < 0.86) return "late";
  if (r < 0.9) return "early_leave";
  if (r < 0.97) return "absent";
  return "pending";
}

/**
 * 더미 출결 매트릭스 생성. 35명 × 15주. 일부 학생은 고의로 결석을 많이
 * 만들어 F 위험 사례를 보여준다.
 * TODO(API): 실제 누적 출결 API 응답으로 교체.
 */
export function buildMatrix(): StudentRow[] {
  const rand = makeRng(42);
  return Array.from({ length: 35 }, (_, i) => {
    const highRisk = i === 4 || i === 12 || i === 21 || i === 30;
    const weeks: (AttendanceStatus | null)[] = Array.from(
      { length: WEEKS },
      (_, w) => {
        if (w > 9 && rand() < 0.3) return null;
        if (highRisk) {
          const r = rand();
          if (r < 0.4) return "absent";
          if (r < 0.55) return "late";
          return "present";
        }
        return pickStatus(rand);
      },
    );
    const n = i + 1;
    return {
      student_id: `s${n}`,
      student_number: `2024${String(1000 + n).padStart(4, "0")}`,
      name: `학생${n}`,
      weeks,
    };
  });
}
