import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { AttendanceAggregate, AttendanceStatus } from "@/api/types";

// Single source of truth for attendance status presentation (design guide §2).
// Meaning is NEVER encoded by color alone — always paired with a Korean label
// and an icon.
export type StatusKey = AttendanceStatus;

export interface StatusMeta {
  label: string;
  badgeVariant: "success" | "warning" | "destructive";
  Icon: typeof CheckCircle2;
}

export const STATUS_META: Record<StatusKey, StatusMeta> = {
  present: { label: "출석", badgeVariant: "success", Icon: CheckCircle2 },
  pending: { label: "대기", badgeVariant: "warning", Icon: Clock },
  absent: { label: "결석", badgeVariant: "destructive", Icon: XCircle },
};

export function statusMeta(key: StatusKey): StatusMeta {
  return STATUS_META[key];
}

// ------------------------------------------------------------ stats (SSOT)
// Single source of truth for every derived attendance figure the dashboard
// shows. StatCards / AttendanceTable / RealtimeRiskPanel MUST read from here
// instead of recomputing, so the numbers can never drift between panels.
//
// Inputs:
//   aggregate     — server counts (total / present / unverified[]), or null.
//   pendingDeltas — professor's queued corrections (studentId -> status),
//                   applied on batch close; used only for the "queued" tallies.
export interface AttendanceStats {
  total: number;
  present: number;
  unverified: number;
  // Corrections queued in the opt-out review (not yet committed).
  pendingCorrections: number;
  absentCorrections: number;
  // present / total, 0..1 (0 when total is 0).
  presentShare: number;
  // unverified / total, 0..1 (0 when total is 0).
  unverifiedShare: number;
  // Whole-number percentages (rounded) for display.
  presentRate: number;
  unverifiedRate: number;
}

export function deriveAttendanceStats(
  aggregate: AttendanceAggregate | null,
  pendingDeltas: Record<string, AttendanceStatus> = {},
): AttendanceStats {
  const total = aggregate?.total ?? 0;
  const present = aggregate?.present ?? 0;
  const unverified = aggregate?.unverified.length ?? 0;

  const deltaValues = Object.values(pendingDeltas);
  const pendingCorrections = deltaValues.filter((s) => s === "pending").length;
  const absentCorrections = deltaValues.filter((s) => s === "absent").length;

  const presentShare = total > 0 ? present / total : 0;
  const unverifiedShare = total > 0 ? unverified / total : 0;

  return {
    total,
    present,
    unverified,
    pendingCorrections,
    absentCorrections,
    presentShare,
    unverifiedShare,
    presentRate: Math.round(presentShare * 100),
    unverifiedRate: Math.round(unverifiedShare * 100),
  };
}
