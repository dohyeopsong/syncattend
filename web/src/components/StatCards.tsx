import { useSessionStore } from "@/store/session";
import { useAttendanceStore } from "@/store/attendance";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Clock, XCircle, HelpCircle } from "lucide-react";

// Dashboard stat cards (design guide §3): 4 across — 출석 / 대기 / 결석 / 미인증.
// label (muted, text-sm) + big number (text-2xl font-semibold) + icon.
export function StatCards() {
  const session = useSessionStore((s) => s.session);
  const aggregate = useAttendanceStore((s) => s.aggregate);
  const pendingDeltas = useAttendanceStore((s) => s.pendingDeltas);

  const total = aggregate?.total ?? 0;
  const present = aggregate?.present ?? 0;
  const unverified = aggregate?.unverified.length ?? 0;

  // Pending corrections queued by the professor (from the opt-out review).
  const deltaValues = Object.values(pendingDeltas);
  const pending = deltaValues.filter((s) => s === "pending").length;
  const absent = deltaValues.filter((s) => s === "absent").length;

  const stats = [
    {
      label: "출석",
      value: present,
      Icon: CheckCircle2,
      tone: "text-success",
    },
    { label: "대기", value: pending, Icon: Clock, tone: "text-warning" },
    { label: "결석", value: absent, Icon: XCircle, tone: "text-destructive" },
    {
      label: "미인증",
      value: unverified,
      Icon: HelpCircle,
      tone: "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map(({ label, value, Icon, tone }) => (
        <Card key={label} className="p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{label}</span>
            <Icon className={`h-4 w-4 ${tone}`} />
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {session ? value : "—"}
          </div>
          {label === "출석" && session && total > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              전체 {total}명 중 {Math.round((present / total) * 100)}%
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
