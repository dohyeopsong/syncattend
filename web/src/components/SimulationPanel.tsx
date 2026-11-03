import { useState } from "react";
import { Users, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { useCoursesStore } from "@/store/courses";
import { useSessionStore } from "@/store/session";
import { useAttendanceStore } from "@/store/attendance";
import { simulateBots, cleanupBots } from "@/api/client";
import type { SimulateBotsResult, BotCleanupResult } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

// Virtual bot population (COURSE-scoped). The professor picks a course, creates
// N bots — they enroll as 미인증 course students immediately (visible in the
// roster + dashboard total) — then opens a session: the present bots verify
// through the REAL path after a random delay, so 출석 trickles into the
// realtime dashboard (SSE) one-by-one. "봇 정리" removes ALL bots at once.
// Flow: 강좌 선택 → 봇 만들기(미인증 대기) → 세션 시작(딜레이 출석) → 실시간
// 모니터링 → 세션 종료(팝업) → 봇 정리.
export function SimulationPanel() {
  const courses = useCoursesStore((s) => s.courses);
  const courseId = useCoursesStore((s) => s.selectedCourseId);
  const fetchEnrollments = useCoursesStore((s) => s.fetchEnrollments);

  const session = useSessionStore((s) => s.session);
  const fetchAggregate = useAttendanceStore((s) => s.fetchAggregate);

  const course = courses.find((c) => c.id === courseId) ?? null;
  const sessionForThisCourse =
    session && session.course_id === courseId ? session : null;
  const active = sessionForThisCourse?.status === "open";

  const [count, setCount] = useState(20);
  const [ratio, setRatio] = useState(0.7);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(25);
  const [running, setRunning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<SimulateBotsResult | null>(null);
  const [cleanup, setCleanup] = useState<BotCleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!courseId) return;
    setRunning(true);
    setError(null);
    setCleanup(null);
    try {
      const res = await simulateBots(courseId, {
        count,
        present_ratio: ratio,
        delay_min: delayMin,
        delay_max: delayMax,
      });
      setResult(res);
      // Bots enrolled synchronously → refresh the roster so they appear at once.
      await fetchEnrollments(courseId);
      // If a session is already open, its aggregate also reflects them now.
      if (sessionForThisCourse) {
        await fetchAggregate(sessionForThisCourse.session_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function clean() {
    if (!courseId) return;
    setCleaning(true);
    setError(null);
    try {
      const res = await cleanupBots(courseId);
      setCleanup(res);
      setResult(null);
      await fetchEnrollments(courseId);
      if (sessionForThisCourse) {
        await fetchAggregate(sessionForThisCourse.session_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> 가상 학생(봇) 시뮬레이션
        </CardTitle>
        <CardDescription>
          강좌를 선택해 가상 학생을 생성합니다. 봇은 즉시 수강생 명단(미인증)에
          등록되고, 세션을 시작하면 출석 비율만큼 랜덤 딜레이로 출석합니다.
          실시간 모니터링(SSE)이 실시간으로 변합니다. 종료 후 "봇 정리"로
          삭제하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!course ? (
          <EmptyState
            Icon={Users}
            title="강좌를 먼저 선택하세요"
            description="강좌 관리에서 강좌를 선택하면 이 강좌에 가상 학생을 생성해 대시보드를 채울 수 있습니다."
          />
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">선택된 강좌:</span>
              <Badge variant="default">{course.name}</Badge>
              {!active && (
                <Badge variant="secondary">세션 시작 시 출석 시작</Badge>
              )}
              {active && (
                <Badge variant="success">세션 진행 중 · 실시간 출석</Badge>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>가상 학생 수</span>
                  <span className="font-mono">{count}명</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>출석 인증 비율</span>
                  <span className="font-mono">{Math.round(ratio * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ratio}
                  onChange={(e) => setRatio(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <p className="text-[11px] text-muted-foreground">
                  나머지는 미인증(검토 대기)으로 남아 출석 마감 테스트에 쓰입니다.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>최소 딜레이</span>
                  <span className="font-mono">{delayMin}초</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={1}
                  value={delayMin}
                  onChange={(e) =>
                    setDelayMin(Math.min(Number(e.target.value), delayMax))
                  }
                  className="w-full accent-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>최대 딜레이</span>
                  <span className="font-mono">{delayMax}초</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={1}
                  value={delayMax}
                  onChange={(e) =>
                    setDelayMax(Math.max(Number(e.target.value), delayMin))
                  }
                  className="w-full accent-primary"
                />
                <p className="text-[11px] text-muted-foreground">
                  세션 시작 후 각 봇이 이 구간의 무작위 시간만큼 기다린 뒤
                  출석합니다. 실시간 대시보드가 점진적으로 차오릅니다.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void run()} disabled={running}>
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> 생성 중…
                  </>
                ) : (
                  <>
                    <Users className="h-4 w-4" /> 봇 {count}명 생성
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => void clean()}
                disabled={cleaning}
              >
                {cleaning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> 정리 중…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" /> 봇 정리
                  </>
                )}
              </Button>
            </div>

            {error && <p className="text-sm text-destructive">오류: {error}</p>}

            {result && (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>
                    {active
                      ? `${result.present}명이 ${delayMin}~${delayMax}초 딜레이로 백그라운드에서 출석합니다. 대시보드가 실시간으로 채워집니다.`
                      : `${result.present}명이 세션 시작 후 ${delayMin}~${delayMax}초 딜레이로 출석합니다. 전체(${result.total_bots})·미인증은 이미 수강생 명단에 반영됩니다.`}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
                    <div className="text-2xl font-bold">{result.total_bots}</div>
                    <div className="text-xs text-muted-foreground">전체 봇</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-success/5 p-3 text-center">
                    <div className="text-2xl font-bold text-success">
                      {result.present}
                    </div>
                    <div className="text-xs text-muted-foreground">출석 예정</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-warning/5 p-3 text-center">
                    <div className="text-2xl font-bold text-warning">
                      {result.unverified}
                    </div>
                    <div className="text-xs text-muted-foreground">미인증</div>
                  </div>
                </div>
              </>
            )}

            {cleanup && (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                가상 봇 {cleanup.removed}명과 출결 데이터를 삭제했습니다.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
