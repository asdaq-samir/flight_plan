import { cn } from "cn";
import { TEXT } from "../../../lib/text";

/**
 * The fuel in the tanks as a gauge and its gallons, as Tesla's trip planner
 * draws a charger's battery on arrival (the owner's screenshot, 2026-10-21):
 * the share of the tanks left, filled. A fuel stop's in the caution's
 * orange, one under the reserve the flight is held to in red.
 */
export function FuelGauge({ gal, usable, tone }: { gal: number; usable: number | null; tone?: "fuel" | "low" }) {
  const share = usable ? Math.max(0, Math.min(1, gal / usable)) : null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 font-semibold tabular-nums", TEXT.note,
        tone === "low" ? "text-destructive-ink" : tone === "fuel" ? "text-caution-ink" : "text-muted-foreground")}
      data-testid="fuel-gauge"
    >
      {share !== null && (
        // Drawn as a gauge, its edge in the words' colour and the share
        // left filled in it, as iOS draws a battery: a grey bar on a grey
        // track read as text blacked out (the owner's "your canvas looks
        // much prettier than the actual app", 2026-10-26).
        <span aria-hidden="true" className="inline-flex h-3 w-6 rounded-[3.5px] border-[1.5px] border-current p-px opacity-90">
          <span className="h-full rounded-[1.5px] bg-current" style={{ width: `${Math.max(10, share * 100)}%` }} />
        </span>
      )}
      <span><span className="sr-only">Fuel in the tanks </span>{Math.floor(gal)} gal</span>
    </span>
  );
}
