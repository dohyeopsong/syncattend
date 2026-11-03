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
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/30 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-soft">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
