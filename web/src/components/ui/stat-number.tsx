import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A number that briefly animates (fade/rise) whenever its value changes, so
// live SSE count updates read as "updated" without a jarring jump. The
// animation utility (.animate-count-in) is defined in index.css and is fully
// disabled under `prefers-reduced-motion: reduce`. The value itself is always
// rendered as plain text, so nothing depends on motion.
export function StatNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const [tick, setTick] = useState(0);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setTick((t) => t + 1);
    }
  }, [value]);

  return (
    <span
      // Re-mount the span on change so the CSS animation replays.
      key={tick}
      className={cn("tabular-nums animate-count-in", className)}
    >
      {value}
    </span>
  );
}
