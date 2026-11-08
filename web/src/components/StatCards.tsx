import { useSessionStore } from "@/store/session";
import { useAttendanceStore } from "@/store/attendance";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deriveAttendanceStats } from "@/lib/status";
import {
  CheckCircle2,
  Clock,
  XCircle,
  HelpCircle,
  MousePointerClick,
  Timer,
  LogOut,
} from "lucide-react";

// Dashboard stat cards (design guide §3): 4 across — 출석 / 대기 / 결석 / 미인증.
// Each card: muted label + icon on one row, big number below (text-2xl
// font-semibold). Status colors limited to the guide's 3 (+ neutral); meaning
// is always carried by the Korean label + icon, never color alone.
export function StatCards() {
  const session = useSessionStore((s) => s.session);
  const aggregate = useAttendanceStore((s) => s.aggregate);
  const pendingDeltas = useAttendanceStore((s) => s.pendingDeltas);

  // Single source of truth for every derived figure (see lib/status.ts).
  const { total, present, absent, late, earlyLeave, unverified, pendingCorrections, presentRate } =
    deriveAttendanceStats(aggregate, pendingDeltas);

  // Session open but aggregate not yet fetched → show skeletons so numbers
  // don't pop in / jump. No session → neutral guidance placeholder.
  const isLoading = !!session && !aggregate;

  const stats = [
    { label: "출석", value: present, Icon: CheckCircle2, tone: "text-success", bg: "bg-success/10" },
    { label: "지각", value: late, Icon: Timer, tone: "text-warning", bg: "bg-warning/10" },
    { label: "조퇴", value: earlyLeave, Icon: LogOut, tone: "text-warning", bg: "bg-warning/10" },
    { label: "결석", value: absent, Icon: XCircle, tone: "text-destructive", bg: "bg-destructive/10" },
    {
      label: "대기",
      value: pendingCorrections,
      Icon: Clock,
      tone: "text-muted-foreground",
      bg: "bg-muted",
    },
    {
      label: "미인증",
      value: unverified,
      Icon: HelpCircle,
      tone: "text-muted-foreground",
      bg: "bg-muted",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map(({ label, value, Icon, tone, bg }) => (
        <Card key={label} className="p-5 transition-shadow hover:shadow-soft-md">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
              <Icon className={`h-5 w-5 shrink-0 ${tone}`} />
            </div>
            <span className="text-sm font-medium text-muted-foreground">
              {label}
            </span>
          </div>

          {isLoading ? (
            <Skeleton className="mt-3 h-8 w-14" />
          ) : (
            <div className="mt-3 text-2xl font-bold tabular-nums leading-none">
              {session ? (
                value
              ) : (
                <span className="inline-flex items-center gap-1.5 text-base font-normal text-muted-foreground">
                  <MousePointerClick className="h-4 w-4" /> 대기
                </span>
              )}
            </div>
          )}

          {/* Present-rate caption (only meaningful for 출석 with a live total). */}
          {label === "출석" && session && !isLoading && total > 0 && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              전체 {total}명 중 <span className="font-medium text-foreground">{presentRate}%</span>
            </div>
          )}
          {label === "출석" && !session && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              강좌를 선택하고 세션을 여세요
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
