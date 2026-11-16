// Risk-warning banner (browser side).
//
// Mirrors the Flutter RiskWarningBanner (mobile/lib/features/risk/
// risk_warning.dart): a colored banner below the app bar that surfaces the
// latest SSE risk warning for the calling student. Color + icon + text together
// (never color alone).

import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { RiskWarning } from "@/api/types";

const LEVEL_STYLE: Record<
  RiskWarning["level"],
  { bg: string; border: string; text: string; Icon: typeof Info }
> = {
  danger: {
    bg: "bg-destructive/10",
    border: "border-destructive/30",
    text: "text-destructive",
    Icon: ShieldAlert,
  },
  warning: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-700 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  info: {
    bg: "bg-primary/10",
    border: "border-primary/30",
    text: "text-primary",
    Icon: Info,
  },
};

export function RiskWarningBanner({
  warning,
}: {
  warning: RiskWarning | null;
}) {
  if (!warning) return null;
  const style = LEVEL_STYLE[warning.level] ?? LEVEL_STYLE.info;
  const { Icon } = style;
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border ${style.border} ${style.bg} px-3.5 py-2.5 text-sm ${style.text}`}
      role="status"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">{warning.message}</p>
        <p className="mt-0.5 text-xs opacity-80">
          (누적 결석 {warning.absences})
        </p>
      </div>
    </div>
  );
}
