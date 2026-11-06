import { useState } from "react";
import { MapPin, Plane } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import { SearchField, SearchResults } from "../../../components/PanelCapsule";
import { Button } from "../../../components/ui/button";
import { TEXT } from "../../../lib/text";
import type { RecentAirport } from "../../../lib/preferences";
import { useFirstFlight } from "../hooks/useFirstFlight";
import type { RouteParts } from "./RouteBox";

/**
 * "Your first flight": a card over the map, above the sheet's pill, the
 * first time the planner opens with no route on this device (the owner's
 * canvas, 2026-11-03; useFirstFlight): one line of what Wingtip does, a
 * destination field with the airport search the route's box and the
 * search bar use (useAirportSearch, through PanelCapsule's field and
 * results), Plan it, and the three steps under it -- Route, Nav log,
 * Brief. Planned, the card is gone for good, the nav log opens and one
 * tip points at the Brief (lib/tips "brief"). Where the app has no
 * position and no last departure, a second field asks where from.
 */
export default function FirstFlight({ routed, onPlan, onPlanned }: {
  routed: boolean;
  onPlan: (parts: RouteParts) => void;
  onPlanned: () => void;
}) {
  const { shown, needsFrom, planning, problem, planIt, dismiss } = useFirstFlight({ routed, onPlan, onPlanned });
  const [dest, setDest] = useState<RecentAirport | null>(null);
  const [from, setFrom] = useState<RecentAirport | null>(null);
  if (!shown) return null;
  const ready = !!dest && (!needsFrom || !!from);
  return (
    <section
      aria-labelledby="first-flight-title" data-testid="first-flight"
      // Over the map, up from the sheet's pill (--map-inset-bottom, as the
      // map's buttons stand off it), in from the screen's sides as the
      // sheet is; one column on a phone, the sheet's width beside it.
      className={cn(
        "absolute right-3 bottom-[calc(max(env(safe-area-inset-bottom),var(--sheet-cover,var(--map-inset-bottom,0px)))+0.75rem)] left-[calc(0.75rem+var(--map-inset-left,0px))] z-[1000] mx-auto flex max-w-md flex-col gap-3 rounded-[18px] bg-card/95 p-4 text-card-foreground shadow-[0_2px_14px_rgb(0_0_0/0.14)] backdrop-blur-xl",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Plane className="size-6 shrink-0 text-tint" aria-hidden />
        <h2 id="first-flight-title" className={cn("min-w-0 flex-1 font-semibold", TEXT.heading)}>Your first flight</h2>
        <CloseButton label="Not now" className="-my-1 -mr-1" onClick={dismiss} data-testid="first-flight-close" />
      </div>
      <p className={cn("text-foreground/80", TEXT.prose)}>
        Where to? Wingtip plans from where you are: the route, the checkpoints you'll see from the air, the nav log and a weather brief.
      </p>
      <AirportField label="Destination" placeholder="Airport, town or ident" picked={dest} onPick={setDest} testId="first-flight-dest" />
      {needsFrom && (
        <AirportField label="From" placeholder="Where you take off" icon={MapPin} picked={from} onPick={setFrom} testId="first-flight-from" />
      )}
      {problem && <p role="alert" className={cn("text-destructive", TEXT.detail)} data-testid="first-flight-problem">{problem}</p>}
      <Button
        type="button" size="lg" className="h-12 rounded-[14px] font-semibold" disabled={!ready || planning}
        onClick={() => { if (dest) void planIt(dest.ident, from?.ident ?? null); }} data-testid="first-flight-plan"
      >
        {planning ? "Planning…" : "Plan it"}
      </Button>
      <ol className={cn("flex flex-wrap gap-x-2 text-muted-foreground", TEXT.note)} aria-label="The three steps">
        <li><span className="font-semibold text-foreground">Step 1 of 3 · Route</span></li>
        <li aria-hidden>·</li>
        <li>Nav log</li>
        <li aria-hidden>·</li>
        <li>Brief</li>
      </ol>
    </section>
  );
}

/** One field of the card: the search bar's field and, while something
 *  is typed, the airports that answer it (PanelCapsule); the one picked
 *  shown in the field as "Madison, KMSN", its results put away. */
function AirportField({ label, placeholder, icon, picked, onPick, testId }: {
  label: string;
  placeholder: string;
  icon?: typeof MapPin;
  picked: RecentAirport | null;
  onPick: (airport: RecentAirport | null) => void;
  testId: string;
}) {
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const value = picked ? `${picked.municipality ? `${picked.municipality}, ` : ""}${picked.ident}` : typed;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn("px-1 text-muted-foreground", TEXT.note)}>{label}</span>
      <SearchField
        value={value} placeholder={placeholder} label={label} testId={testId} icon={icon}
        onChange={v => { onPick(null); setTyped(v); setOpen(true); }}
        onFocus={() => setOpen(true)} onCancel={() => setOpen(false)} onSubmit={() => undefined}
        onClear={() => { onPick(null); setTyped(""); }}
      />
      {open && !picked && typed.trim() && (
        <div className="max-h-56 overflow-y-auto" data-testid={`${testId}-results`}>
          <SearchResults query={typed} onPick={a => { onPick(a); setTyped(""); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}
