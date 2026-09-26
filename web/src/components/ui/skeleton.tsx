import * as React from "react";
import { cn } from "@/lib/utils";

// Neutral placeholder block. The shimmer animation is defined in index.css and
// is automatically disabled under `prefers-reduced-motion: reduce` (falls back
// to a flat muted block). Purely decorative — never the only signal of state.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton", className)}
      {...props}
    />
  );
}

export { Skeleton };
