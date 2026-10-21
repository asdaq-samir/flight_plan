import type { ReactNode } from "react";
import { Ellipsis, Fuel } from "lucide-react";
import { cn } from "cn";
import RoundButton from "../../../components/RoundButton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { faaWords } from "../../../lib/advisories";
import type { FuelStop } from "../../../lib/api/types";
import { TEXT } from "../../../lib/text";

/** A field's place in words: its city, as the FAA spells it, in sentence
 *  case ("Knoxville"), else its name. */
function fuelStopPlace(stop: FuelStop): string {
  return faaWords(stop.city || stop.name);
}

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
        <span aria-hidden="true" className="inline-flex h-2.5 w-6 overflow-hidden rounded-[3px] bg-foreground/15">
          <span className={cn("h-full", tone === "low" ? "bg-destructive" : tone === "fuel" ? "bg-caution" : "bg-foreground/60")} style={{ width: `${Math.max(8, share * 100)}%` }} />
        </span>
      )}
      <span><span className="sr-only">Fuel in the tanks </span>{Math.floor(gal)} gal</span>
    </span>
  );
}

/**
 * A fuel stop the planner suggests, a row of FPL's route between the
 * flight's departure and where it lands, at the owner's pick (2026-10-21,
 * option A: "suggest fuel stops just like Tesla suggests fuel stops on the
 * way", and Tesla's own list as the way): the field and its town, then
 * what the airplane lands there with -- a gauge and the gallons -- the time
 * on the ground and when it lands, on one line. Its pin dashed until the
 * stops are added (FuelStopsAdd, after the last); its menu the other
 * fields it could be.
 */
export default function FuelStopRow({ stop, time, groundMin, usableGal, runway, choices, onChoose, last }: {
  stop: FuelStop;
  /** Its wind and the runway it favours, as the route's fields show them. */
  runway?: ReactNode;
  /** When it is landed at, by the flight's own minutes to it. */
  time: string;
  /** The minutes on the ground a stop takes (groundMinAt). */
  groundMin: number;
  /** The tanks' usable fuel, for the gauge. */
  usableGal: number | null;
  /** The other fields this stop could be, and one picked in its place. */
  choices?: FuelStop[];
  onChoose?: (stop: FuelStop) => void;
  last: boolean;
}) {
  const place = fuelStopPlace(stop);
  return (
    <li className="relative flex gap-2.5" data-testid="fuel-stop" data-ident={stop.ident}>
      {!last && <span aria-hidden="true" className="absolute top-3 bottom-0 left-[calc(0.875rem-1px)] w-0.5 bg-border" />}
      <div className="relative flex w-7 shrink-0 justify-center pt-0.5">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full border-2 border-dashed border-caution bg-background text-caution">
          <Fuel className="size-3.5" strokeWidth={2.4} />
        </span>
      </div>
      <section aria-label={`Suggested fuel stop, ${stop.ident}, ${place}`} className="min-w-0 flex-1 space-y-3 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 className={cn("truncate font-semibold", TEXT.row)}>{stop.ident} · {place}</h3>
            <span className={cn("flex items-center gap-1.5 text-muted-foreground tabular-nums", TEXT.note)}>
              <FuelGauge gal={stop.lands_with_gal} usable={usableGal} />
              <span aria-hidden="true">·</span>
              <Fuel className="size-3.5" aria-hidden="true" />
              <span><span className="sr-only">Refuelled in </span>{groundMin} min</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-foreground"><span className="sr-only">Lands at </span>{time}</span>
            </span>
          </div>
          {choices && choices.length > 0 && onChoose && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <RoundButton label={`${stop.ident}: other fields with fuel`} className="shrink-0 text-tint" data-testid="fuel-stop-other">
                  <Ellipsis className="size-5" aria-hidden="true" />
                </RoundButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72" data-testid="fuel-stop-choices">
                <DropdownMenuLabel className={cn("text-muted-foreground", TEXT.note)}>Another field with fuel</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {choices.map(c => (
                  <DropdownMenuItem key={c.ident} onSelect={() => onChoose(c)} className="flex flex-col items-start gap-0" data-testid="fuel-stop-choice">
                    <span className={cn("font-semibold", TEXT.detail)}>{c.ident} · {fuelStopPlace(c)}</span>
                    <span className={cn("text-muted-foreground tabular-nums", TEXT.note)}>
                      Lands with {Math.floor(c.lands_with_gal)} gal · +{Math.round(c.added_nm)} nm off the line
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {runway}
      </section>
    </li>
  );
}

/**
 * The suggested stops put in the route, one tap after the last of them,
 * as Tesla's trip is sent to the car: "Add fuel stop", or "Add 2 fuel
 * stops", in the tint.
 */
export function FuelStopsAdd({ count, onAdd, last }: { count: number; onAdd: () => void; last: boolean }) {
  return (
    <li className="relative flex gap-2.5">
      {!last && <span aria-hidden="true" className="absolute top-0 bottom-0 left-[calc(0.875rem-1px)] w-0.5 bg-border" />}
      <div className="w-7 shrink-0" />
      <div className="min-w-0 flex-1 pb-4">
        <button
          type="button" onClick={onAdd} data-testid="fuel-stop-keep"
          className={cn(
            "relative h-9 rounded-full bg-tint/12 px-4 font-semibold text-tint outline-none after:absolute after:-inset-1 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring",
            TEXT.detail,
          )}
        >
          {count === 1 ? "Add fuel stop" : `Add ${count} fuel stops`}
        </button>
      </div>
    </li>
  );
}
