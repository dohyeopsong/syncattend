import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, LayoutGrid } from "lucide-react";
import { WEEKS, type StudentRow } from "@/lib/attendanceMatrix";
import { useCoursesStore } from "@/store/courses";
import { useAttendanceStore } from "@/store/attendance";
import type { AttendanceStatus } from "@/api/types";

// 주차별 출결 추이 선그래프 (15주 × 3 시리즈).
//
// 가로=1~15주, 세로=인원 수. 출석(초록)/지각(노랑)/결석(빨강) 세 선으로
// 시간 흐름에 따른 출결 변화를 보여준다. SVG로 직접 그려 차트 라이브러리
// 의존성 없이 가볍게 렌더링. 마크 스펙: 2px 선, >=8px 마커, 호버 툴팁,
// 범례는 항상 표시(3 시리즈).
//
// 데이터: lib/attendanceMatrix.ts 의 matrixToRows() 결과를 주차별로 집계.
// 매트릭스는 GET /courses/{course_id}/attendance/matrix 응답을 파싱한 것으로,
// RiskGraphPanel과 store를 통해 공유된다.

type SeriesKey = "present" | "late" | "absent";

interface Series {
  key: SeriesKey;
  label: string;
  color: string; // SVG stroke 색 (마크만 색)
  tone: string; // tailwind 텍스트 토큰 (텍스트는 토큰만)
}

const SERIES: Series[] = [
  { key: "present", label: "출석", color: "oklch(0.627 0.194 149.214)", tone: "text-success" },
  { key: "late", label: "지각", color: "oklch(0.769 0.188 70.08)", tone: "text-warning" },
  { key: "absent", label: "결석", color: "oklch(0.577 0.245 27.325)", tone: "text-destructive" },
];

// 매트릭스를 주차별 시리즈 카운트로 집계.
function buildWeeklyCounts(rows: StudentRow[]): Record<SeriesKey, number[]> {
  const counts: Record<SeriesKey, number[]> = {
    present: Array(WEEKS).fill(0),
    late: Array(WEEKS).fill(0),
    absent: Array(WEEKS).fill(0),
  };
  for (const row of rows) {
    row.weeks.forEach((w, wi) => {
      if (w === "present") counts.present[wi] += 1;
      else if (w === "late") counts.late[wi] += 1;
      else if (w === "absent") counts.absent[wi] += 1;
    });
  }
  return counts;
}

// SVG 좌표계 (viewBox). 차트 본체 영역.
const VB_W = 720;
const VB_H = 280;
const PAD_L = 36;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 28;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

function xFor(weekIdx: number): number {
  // 1주~15주를 플롯 영역에 균등 분할.
  return PAD_L + (weekIdx / (WEEKS - 1)) * PLOT_W;
}

function yFor(value: number, max: number): number {
  if (max <= 0) return PAD_T + PLOT_H;
  return PAD_T + PLOT_H - (value / max) * PLOT_H;
}

export function AbsenceRankChart() {
  const courseId = useCoursesStore((s) => s.selectedCourseId);
  const matrix = useAttendanceStore((s) => s.matrix);
  const matrixLoading = useAttendanceStore((s) => s.matrixLoading);
  const matrixError = useAttendanceStore((s) => s.matrixError);
  const fetchMatrix = useAttendanceStore((s) => s.fetchMatrix);

  // Same shared matrix as RiskGraphPanel — fetch is deduped by the store.
  useEffect(() => {
    if (courseId) void fetchMatrix(courseId);
  }, [courseId, fetchMatrix]);

  const [hoverWeek, setHoverWeek] = useState<number | null>(null);

  const rows = matrix ?? [];
  const counts = buildWeeklyCounts(rows);
  const max = Math.max(
    1,
    ...SERIES.flatMap((s) => counts[s.key]),
  );
  // Y축을 깔끔한 단위로. 최대값 위로 올림.
  const yMax = Math.ceil(max / 5) * 5;
  const yTicks = 4;
  const tickValues = Array.from(
    { length: yTicks + 1 },
    (_, i) => Math.round((yMax / yTicks) * i),
  );

  // 각 시리즈의 폴리라인 포인트.
  const paths = SERIES.map((s) => ({
    ...s,
    points: counts[s.key].map((v, wi) => `${xFor(wi)},${yFor(v, yMax)}`).join(" "),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" /> 주차별 출결 추이
        </CardTitle>
        <CardDescription>
          15주 동안의 출석·지각·결석 인원 추이. 세 선이 벌어질수록 출결
          양극화가 심한 주차입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!courseId && (
          <EmptyState
            Icon={LayoutGrid}
            title="강좌를 선택하세요"
            description="선택한 강좌의 주차별 출결 추이가 표시됩니다."
          />
        )}
        {courseId && matrixLoading && <Skeleton className="h-64 rounded-xl" />}
        {courseId && !matrixLoading && matrixError && (
          <EmptyState
            Icon={TrendingUp}
            title="불러오지 못했습니다"
            description={matrixError}
          />
        )}
        {courseId && !matrixLoading && !matrixError && rows.length === 0 && (
          <EmptyState
            Icon={LayoutGrid}
            title="출결 기록이 없습니다"
            description="이 강좌에 아직 수강생 또는 세션 기록이 없습니다."
          />
        )}
        {courseId && !matrixLoading && !matrixError && rows.length > 0 && (
          <>
        {/* Legend — 항상 표시 (3 시리즈). 색은 마크만, 텍스트는 토큰. */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="h-0.5 w-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span
                className={`h-2 w-2 rounded-full ${s.tone}`}
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>

        {/* Line chart — SVG. 호버 시 세로 가이드 + 툴팁. */}
        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="h-auto w-full min-w-[480px]"
            role="img"
            aria-label="주차별 출결 추이 선그래프"
          >
            {/* Y축 그리드라인 — hairline, recessive. */}
            {tickValues.map((tv) => (
              <g key={tv}>
                <line
                  x1={PAD_L}
                  x2={VB_W - PAD_R}
                  y1={yFor(tv, yMax)}
                  y2={yFor(tv, yMax)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 6}
                  y={yFor(tv, yMax) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {tv}
                </text>
              </g>
            ))}

            {/* X축 주차 라벨. */}
            {Array.from({ length: WEEKS }, (_, i) => (
              <text
                key={i}
                x={xFor(i)}
                y={VB_H - PAD_B + 14}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {i + 1}
              </text>
            ))}
            <text
              x={VB_W / 2}
              y={VB_H - 2}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              주차
            </text>

            {/* Hover 세로 가이드. */}
            {hoverWeek !== null && (
              <line
                x1={xFor(hoverWeek)}
                x2={xFor(hoverWeek)}
                y1={PAD_T}
                y2={PAD_T + PLOT_H}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {/* 폴리라인 — 2px, round join/cap. */}
            {paths.map((p) => (
              <polyline
                key={p.key}
                points={p.points}
                fill="none"
                stroke={p.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* 마커 — >=8px (r=4), surface ring 2px. */}
            {paths.map((p) =>
              counts[p.key].map((v, wi) => (
                <circle
                  key={`${p.key}-${wi}`}
                  cx={xFor(wi)}
                  cy={yFor(v, yMax)}
                  r={4}
                  fill={p.color}
                  className="stroke-card"
                  strokeWidth={2}
                />
              )),
            )}

            {/* 투명한 넓은 hit 영역 — 마우스가 정확히 점에 안 닿아도 호버. */}
            {Array.from({ length: WEEKS }, (_, i) => {
              const halfStep = PLOT_W / (WEEKS - 1) / 2;
              return (
                <rect
                  key={i}
                  x={xFor(i) - halfStep}
                  y={PAD_T}
                  width={halfStep * 2}
                  height={PLOT_H}
                  fill="transparent"
                  onMouseEnter={() => setHoverWeek(i)}
                  onMouseLeave={() => setHoverWeek(null)}
                />
              );
            })}
          </svg>
        </div>

        {/* Hover 툴팁 — 해당 주차 3 시리즈 값. */}
        {hoverWeek !== null ? (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="font-medium">{hoverWeek + 1}주차</span>
            <span className="ml-3 text-muted-foreground">
              출석 <span className="font-semibold text-success">{counts.present[hoverWeek]}</span>명
            </span>
            <span className="ml-3 text-muted-foreground">
              지각 <span className="font-semibold text-warning">{counts.late[hoverWeek]}</span>명
            </span>
            <span className="ml-3 text-muted-foreground">
              결석 <span className="font-semibold text-destructive">{counts.absent[hoverWeek]}</span>명
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            그래프에 마우스를 올리면 해당 주차의 출결 인원이 표시됩니다.
          </p>
        )}

        {/* Data source notice */}
        <p className="text-[11px] text-muted-foreground">
          ※ 선택한 강좌의 누적 출결 데이터입니다.
        </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// 사용하지 않는 import 방지 — AttendanceStatus는 타입 가드에 쓰일 수 있으나
// 현재 buildWeeklyCounts 내에서 리터럴 비교하므로 참조만 유지.
export type { AttendanceStatus };
