import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Unified empty-state block (design guide §5: friendly one-line explanation,
// neutral surface, single accent). No decorative illustrations per the guide's
// Don'ts — just a muted icon, a title, and a short line of guidance. Meaning is
// conveyed by text + icon, never color alone.
export function EmptyState({
  Icon,
  title,
  description,
  className,
  action,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
