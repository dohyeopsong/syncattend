import { CheckCircle2, Clock, LogOut, Timer, XCircle } from "lucide-react";
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
  late: { label: "지각", badgeVariant: "warning", Icon: Timer },
  early_leave: { label: "조퇴", badgeVariant: "warning", Icon: LogOut },
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
//   aggregate     — server counts (total / present / late / early_leave /
//                   unverified[]), or null.
//   pendingDeltas — professor's queued corrections (studentId -> status),
//                   applied on batch close; used only for the "queued" tallies.
export interface AttendanceStats {
  total: number;
  // Server-side resolved counts (present / absent / late / early_leave).
  present: number;
  absent: number;
  late: number;
  earlyLeave: number;
  unverified: number;
  // Corrections queued in the opt-out review (not yet committed).
  pendingCorrections: number;
  // LIVE figures: reflect the professor's queued corrections on the unverified
  // list in real time. 미인증 중 [출석] 표시 → presentFinal, etc.
  presentFinal: number;
  absentFinal: number;
  lateFinal: number;
  earlyLeaveFinal: number;
  unverifiedFinal: number;
  // Whole-number percentages (rounded) for display.
  presentRate: number;
  absentFinalRate: number;
  lateFinalRate: number;
  earlyLeaveFinalRate: number;
  unverifiedFinalRate: number;
}

export function deriveAttendanceStats(
  aggregate: AttendanceAggregate | null,
  pendingDeltas: Record<string, AttendanceStatus> = {},
): AttendanceStats {
  const total = aggregate?.total ?? 0;
  const present = aggregate?.present ?? 0;
  const serverAbsent = aggregate?.absent ?? 0;
  const serverLate = aggregate?.late ?? 0;
  const serverEarlyLeave = aggregate?.early_leave ?? 0;
  const unverifiedList = aggregate?.unverified ?? [];

  // Among the unverified list, count how many the professor has queued as each
  // status (these move out of 미인증 into the live tiles).
  let deltaPresent = 0;
  let deltaAbsent = 0;
  let deltaLate = 0;
  let deltaEarlyLeave = 0;
  for (const u of unverifiedList) {
    const sid = typeof u === "string" ? u : u.student_id;
    const s = pendingDeltas[sid];
    if (s === "present") deltaPresent += 1;
    else if (s === "absent") deltaAbsent += 1;
    else if (s === "late") deltaLate += 1;
    else if (s === "early_leave") deltaEarlyLeave += 1;
  }

  const deltaValues = Object.values(pendingDeltas);
  const pendingCorrections = deltaValues.filter((s) => s === "pending").length;

  const presentFinal = present + deltaPresent;
  const absentFinal = serverAbsent + deltaAbsent;
  const lateFinal = serverLate + deltaLate;
  const earlyLeaveFinal = serverEarlyLeave + deltaEarlyLeave;
  const unverifiedFinal =
    unverifiedList.length -
    deltaPresent - deltaAbsent - deltaLate - deltaEarlyLeave;

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return {
    total,
    present,
    absent: serverAbsent,
    late: serverLate,
    earlyLeave: serverEarlyLeave,
    unverified: unverifiedList.length,
    pendingCorrections,
    presentFinal,
    absentFinal,
    lateFinal,
    earlyLeaveFinal,
    unverifiedFinal,
    presentRate: pct(presentFinal),
    absentFinalRate: pct(absentFinal),
    lateFinalRate: pct(lateFinal),
    earlyLeaveFinalRate: pct(earlyLeaveFinal),
    unverifiedFinalRate: pct(unverifiedFinal),
  };
}
