import { cn } from "@/lib/utils";

// Display-only circular countdown ring. Renders `remaining/total` as an indigo
// arc over a neutral track with the remaining seconds in the middle. Pure
// presentation — it takes already-computed numbers and draws them; it does NOT
// own any timer, polling, or token-rotation logic (that lives in the store).
//
// Accessibility: the ring is decorative (aria-hidden); the seconds are also
// shown as text, and the caller pairs it with a visible label, so meaning is
// never carried by the ring/color alone.
export function CountdownRing({
  remaining,
  total,
  size = 72,
  strokeWidth = 6,
  className,
}: {
  remaining: number;
  total: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const safeTotal = total > 0 ? total : 1;
  const clamped = Math.max(0, Math.min(remaining, safeTotal));
  const fraction = clamped / safeTotal;

  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - fraction);

  // Color follows the same 3-status intent: calm indigo, amber when low.
  const lowTime = clamped <= 5;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={lowTime ? "hsl(var(--warning))" : "hsl(var(--primary))"}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset,stroke] duration-500 ease-linear motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-lg font-semibold tabular-nums">{clamped}</span>
        <span className="text-[10px] text-muted-foreground">초</span>
      </div>
    </div>
  );
}
