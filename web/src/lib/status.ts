import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { AttendanceStatus } from "@/api/types";

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
