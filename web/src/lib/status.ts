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
  // Server-side present (verified through the real path).
  present: number;
  unverified: number;
  // Corrections queued in the opt-out review (not yet committed).
  pendingCorrections: number;
  absentCorrections: number;
  // LIVE figures: reflect the professor's queued corrections on the unverified
  // list in real time. 미인증 중 [출석] 표시 → presentFinal, [결석] 표시 →
  // absentFinal, 미표시 → unverifiedFinal. These drive the review summary tiles
  // so clicking [출석]/[결석] moves the student between tiles immediately.
  presentFinal: number;
  absentFinal: number;
  unverifiedFinal: number;
  // present / total, 0..1 (0 when total is 0).
  presentShare: number;
  // unverified / total, 0..1 (0 when total is 0).
  unverifiedShare: number;
  // Whole-number percentages (rounded) for display.
  presentRate: number;
  unverifiedRate: number;
  absentFinalRate: number;
  unverifiedFinalRate: number;
}

export function deriveAttendanceStats(
  aggregate: AttendanceAggregate | null,
  pendingDeltas: Record<string, AttendanceStatus> = {},
): AttendanceStats {
  const total = aggregate?.total ?? 0;
  const present = aggregate?.present ?? 0;
  const serverAbsent = aggregate?.absent ?? 0;
  const unverifiedList = aggregate?.unverified ?? [];

  // Among the unverified list, count how many the professor has queued as
  // present vs absent (these move out of 미인증 into the live tiles).
  // unverified entries are objects {student_id, student_number, name}; the
  // Delta/batch key is the internal student_id (UUID).
  let deltaPresent = 0;
  let deltaAbsent = 0;
  for (const u of unverifiedList) {
    const sid = typeof u === "string" ? u : u.student_id;
    const s = pendingDeltas[sid];
    if (s === "present") deltaPresent += 1;
    else if (s === "absent") deltaAbsent += 1;
  }

  const deltaValues = Object.values(pendingDeltas);
  const pendingCorrections = deltaValues.filter((s) => s === "pending").length;
  const absentCorrections = deltaValues.filter((s) => s === "absent").length;

  const presentFinal = present + deltaPresent;
  const absentFinal = serverAbsent + deltaAbsent;
  const unverifiedFinal = unverifiedList.length - deltaPresent - deltaAbsent;

  const presentShare = total > 0 ? presentFinal / total : 0;
  const unverifiedShare = total > 0 ? unverifiedFinal / total : 0;
  const absentShare = total > 0 ? absentFinal / total : 0;

  return {
    total,
    present,
    unverified: unverifiedList.length,
    pendingCorrections,
    absentCorrections,
    presentFinal,
    absentFinal,
    unverifiedFinal,
    presentShare,
    unverifiedShare,
    presentRate: Math.round(presentShare * 100),
    unverifiedRate: Math.round(unverifiedShare * 100),
    absentFinalRate: Math.round(absentShare * 100),
    unverifiedFinalRate: Math.round(unverifiedShare * 100),
  };
}
