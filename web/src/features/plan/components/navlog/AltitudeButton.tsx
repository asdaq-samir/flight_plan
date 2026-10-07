import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../../components/ResponsivePopover";
import { CHIP_TEXT, GLASS_BUTTON } from "../../../../components/mapChrome";
import type { AltitudeChoice, Leg, NavLogAltitude } from "../../../../lib/api/types";
import { TEXT } from "../../../../lib/text";
import { flightLevel } from "../../../../lib/units";
import { describeFuel, describeSteps, describeTime } from "../../format";
import AltitudeReasoning from "../AltitudeReasoning";

/** The cruising altitude the log flies: the highest of its legs once they
 *  are in, a point's own altitude among them (RouteBox), else of the
 *  plan's steps -- one figure, as an EFB's route has, where a plan that
 *  steps is read in the popover; null before there is one. */
function cruiseOf(nav: NavLogAltitude | null, legs: Leg[]): number | null {
  if (!nav || nav.flown === null) return null;
  const plan = nav.options.find(o => o.kind === nav.flown);
  const flown = legs.length ? legs.map(leg => leg.altitude_ft)
    : plan ? plan.steps.map(st => st.altitude_ft) : nav.altitude_ft !== null ? [nav.altitude_ft] : [];
  return flown.length ? Math.max(...flown) : null;
}

/** The pilot's own altitude, one number for the whole route: a row under
 *  the four plans, pressed while it is what the log flies -- typed as a
 *  flight level, three figures after "FL" over the dashes they fill
 *  (045 for 4,500 ft), sent in feet. Enter or Fly re-plans at it; the
 *  stock Input's 16px below md keeps a phone from zooming. */
function CustomAltitude({ alt, onAltChange, onSubmit, pressed }: {
  alt: string;
  onAltChange: (v: string) => void;
  onSubmit: () => void;
  pressed: boolean;
}) {
  // The figures as typed: "04" stays "04" on the way to 045.
  const [level, setLevel] = useState(() => (alt.trim() ? flightLevel(Number(alt)).slice(2) : ""));
  return (
    <form
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5",
        pressed ? "border-primary bg-primary text-primary-foreground" : "border-input",
      )}
      onSubmit={e => { e.preventDefault(); onSubmit(); }}
      aria-label="Custom altitude"
    >
      <span className={cn("font-semibold", TEXT.row)}>Custom</span>
      <div className="ml-auto flex h-8 items-center rounded-md border border-input bg-background pl-2 font-mono text-foreground">
        FL
        <Input
          value={level}
          onChange={e => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
            setLevel(digits);
            onAltChange(digits ? String(Number(digits) * 100) : "");
          }}
          placeholder="---"
          inputMode="numeric" maxLength={3}
          spellCheck={false}
          aria-label="Cruise altitude, flight level"
          className="h-full w-14 border-0 bg-transparent px-1 font-mono shadow-none focus-visible:ring-0 dark:bg-transparent"
          data-testid="custom-altitude"
        />
      </div>
      <Button
        type="submit" size="sm" variant={pressed ? "secondary" : "outline"}
        disabled={!alt.trim()} data-testid="custom-altitude-fly"
      >
        Fly
      </Button>
    </form>
  );
}

/**
 * The cruising altitude, a chip beside the aeroplane's, as the pilot
 * asked: the figure flown, which opens how it was chosen -- the four
 * plans, each with its time and fuel, the pilot's own, and why. It was
 * the nav log's Alt heading, out of sight with the panel down. Always
 * open to the pilot's own: before the plans are in, and on a route with
 * no legal altitude (`unflyable`), an altitude typed is flown as typed.
 */
export default function AltitudeButton({ nav, legs, problem, ownAltitude = true, tight = null, classB = null, onAltitudeChoiceChange, alt, onAltChange, onSubmit }: {
  nav: NavLogAltitude | null;
  legs: Leg[];
  /** No legal altitude on the route: where, why and the ways on
   *  (RouteProblem), each of which puts the popover away (`close`). The
   *  chip is red with it, at the pilot's ask. */
  problem?: (close: () => void) => ReactNode;
  /** An altitude of the pilot's own is offered: not under a Class B to the
   *  ground, where there is none. */
  ownAltitude?: boolean;
  /** A leg where no 500 ft step fits (vfr.altitude's tight altitude):
   *  where, at what, and the room either side. An amber mark on the chip. */
  tight?: string | null;
  /** Planned through Class B at the pilot's word, and the way back: a
   *  mark in the tint on the chip. */
  classB?: (() => void) | null;
  /** Picks one of the four plans, which re-plans. */
  onAltitudeChoiceChange: (choice: AltitudeChoice) => void;
  /** The pilot's own cruise altitude, typed (the Custom row), and the
   *  load that flies it. */
  alt: string;
  onAltChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cruise = cruiseOf(nav, legs);
  // When the winds could not be read, no altitude at all: it used to read
  // "0 ft · yours", with Custom pressed, for an altitude nobody typed.
  const why = problem ? "no legal altitude" : cruise !== null ? flightLevel(cruise)
    : nav?.flown === null ? "no altitude: no winds" : "not yet planned";
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <Button
          variant="outline" size="sm"
          className={cn(
            "gap-1 rounded-full px-2.5 font-normal tabular-nums pointer-coarse:px-1.5", GLASS_BUTTON, CHIP_TEXT,
            // Red with no legal altitude: the colour says it, where a mark
            // beside the figure cost the line its room -- a darker red in
            // the light and a lighter in the dark, 4.5:1 on the glass either
            // way. The dashes alone, with none yet.
            problem && "text-red-700 hover:text-red-700 dark:text-red-300 dark:hover:text-red-300",
          )}
          aria-label={`Cruising altitude, ${why}${!problem && tight ? ", tight" : ""}${!problem && classB ? ", through Class B" : ""}: how it was chosen`}
          data-testid="altitude-why"
        >
          {flightLevel(problem ? null : cruise)}
          {/* What the altitude was planned within, marked; its popover says. */}
          {!problem && tight && <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" data-testid="tight-altitude-flag" />}
          {!problem && classB && <span className="size-1.5 rounded-full bg-tint" aria-hidden="true" data-testid="class-b-accepted-flag" />}
        </Button>
      </ResponsivePopoverTrigger>
      {/* On a phone a sheet from the header's edge: as a popover it was
          70% of the screen, scrolling inside. */}
      <ResponsivePopoverContent title={problem ? "No legal altitude" : "Cruising altitude"} align="start" className="w-80">
        {problem && <div className="mb-4">{problem(() => setOpen(false))}</div>}
        {!problem && tight && (
          <p className={cn("mb-3 rounded-lg bg-amber-500/12 p-2.5 text-amber-800 dark:text-amber-300", TEXT.detail)} data-testid="tight-altitude">
            <span className="font-semibold">Tight altitude. </span>{tight}
          </p>
        )}
        {!problem && classB && (
          <div className={cn("mb-3 space-y-2 rounded-lg bg-tint/10 p-2.5", TEXT.detail)} data-testid="class-b-accepted">
            <p>Planned through Class B: you&apos;ll need a clearance to enter it.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(false); classB(); }}>Undo</Button>
          </div>
        )}
        {/* The four plans first, each a button with its time and fuel: the
            pilot picks one and the log re-plans on it. Then why. */}
        {(nav?.options.length || ownAltitude) && (
        <div className="mb-3 space-y-1.5" role="group" aria-label="Cruise altitude plans">
          <div className={cn("font-semibold uppercase tracking-wide text-muted-foreground", TEXT.note)}>
            {nav?.options.length ? "Four plans, or your own" : problem ? "Or your own, flown as typed" : "Your own"}
          </div>
          {!nav?.options.length && !problem && (
            <p className={cn("text-muted-foreground", TEXT.detail)}>The planner's four plans come with the nav log.</p>
          )}
          {nav?.options.map(o => (
            <Button
              key={o.kind} type="button" size="sm"
              variant={o.kind === nav.flown ? "default" : "outline"}
              aria-pressed={o.kind === nav.flown}
              // A choice in a list, as iOS draws one: its words in the
              // text's colour, the one flown filled in the tint -- not four
              // outlined buttons in blue -- and its words whole on the fill
              // (white at 80% on the blue was 4.1:1).
              className={cn("h-auto w-full justify-between gap-3 whitespace-normal py-1.5 text-left", o.kind !== nav.flown && "text-foreground")}
              onClick={() => onAltitudeChoiceChange(o.kind)}
              data-testid={`altitude-plan-${o.kind}`}
            >
              <span>
                <span className={cn("font-semibold capitalize", TEXT.row)}>{o.kind}</span>
                <span className={cn("block font-normal", TEXT.detail, o.kind !== nav.flown && "opacity-80")}>{describeSteps(o)}</span>
              </span>
              <span className={cn("shrink-0 text-right tabular-nums", TEXT.detail)}>
                {describeTime(o)}
                <span className={cn("block", o.kind !== nav.flown && "opacity-80")}>{describeFuel(o)}</span>
              </span>
            </Button>
          ))}
          {/* Flown, the popover goes: the chip then says the altitude. */}
          {ownAltitude && (
            <CustomAltitude alt={alt} onAltChange={onAltChange} onSubmit={() => { setOpen(false); onSubmit(); }} pressed={nav?.flown === "custom"} />
          )}
        </div>
        )}
        {nav && (
          <>
            <div className={cn("mb-2 font-semibold uppercase tracking-wide text-muted-foreground", TEXT.note)}>How the altitude was chosen</div>
            <AltitudeReasoning nav={nav} legs={legs} />
          </>
        )}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
