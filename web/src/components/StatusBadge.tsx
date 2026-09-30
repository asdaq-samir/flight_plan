import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge } from "./ui/badge";

/** Green up, red down, grey unknown -- and amber, pulsing, for
 *  something under way (a training run). */
export type Tone = "up" | "down" | "checking" | "running";

const TONES: Record<Tone, string> = {
  up: "bg-emerald-500",
  down: "bg-destructive",
  checking: "bg-muted-foreground/40",
  running: "animate-pulse bg-amber-500",
};

/**
 * The app's one status badge: an outlined pill with a dot in the
 * state's colour and the state in words -- a service up or down, how a
 * training run went, the model serving, a flight category (in the FAA's
 * own colour, `color`). The words say what the colour does. It stands
 * where four looks said the same kind of thing: grey chips, outlined
 * pills, dark badges and badges filled in their colour, LIFR's magenta
 * 3.2:1 under its white letters.
 */
export default function StatusBadge({ tone, color, className, children }: {
  tone?: Tone;
  color?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", className)}>
      <span
        aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", tone && TONES[tone])}
        style={color ? { backgroundColor: color } : undefined}
      />
      {children}
    </Badge>
  );
}
