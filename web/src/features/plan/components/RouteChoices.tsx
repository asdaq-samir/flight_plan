import { Check } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../../components/ui/button";
import type { RouteOption, RouteOptions } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { isRoute, wayTime, wayTitle } from "../../../lib/routeWays";
import { TEXT } from "../../../lib/text";
import { grouped } from "../../../lib/units";

/** The weather strip's colours: the flight categories' (lib/map/
 *  flightCategory), a thunderstorm darker than IFR's red. */
const BAND_FILL: Record<string, string> = { vfr: "#1a7f37", mvfr: "#0a4fb3", ifr: "#b3261e", storm: "#7a0010" };
const BAND_WORDS: Record<string, string> = { vfr: "VFR", mvfr: "marginal", ifr: "IFR", storm: "thunderstorms" };

/** What the ranking weighs: good weather, the pilot's minimums kept to
 *  (the owner kept the cards and took away the label and the menu of
 *  what matters, "No need to have the label and filter for routes"). */
type Want = "minimums" | "wind" | "stops" | "low";
const WANTS = new Set<Want>(["minimums"]);

/** A way's cost for the ranking: its minutes, and what each want asked
 *  for weighed in minutes -- an hour a fuel stop, three-quarters of one a
 *  pass through marginal weather, two minutes a knot of headwind. */
function costOf(option: RouteOption, wants: Set<Want>): number {
  let cost = option.air_min + option.ground_min + option.crosses.length * 600;
  if (wants.has("minimums")) cost += option.marginal.length * 45;
  if (wants.has("stops")) cost += option.landings * 60;
  if (wants.has("wind")) cost -= (option.tail_kt ?? 0) * 2;
  if (wants.has("low") && (option.floor_ft ?? 0) > 6000) cost += 600;
  return cost;
}

/** "3 h 10 min", "45 min", as a way's own time (lib/routeWays' wayTime). */
function minutesWords(minutes: number): string {
  const h = Math.floor(Math.round(minutes) / 60), m = Math.round(minutes) % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** The weather a way meets, as a strip laid out by the time it is met. */
function Strip({ bands }: { bands: { kind: string; min: number }[] }) {
  const total = bands.reduce((sum, b) => sum + b.min, 0) || 1;
  const said = bands.filter((b, i, all) => all.findIndex(x => x.kind === b.kind) === i).map(b => BAND_WORDS[b.kind]).join(", ");
  return (
    <span role="img" aria-label={`Weather along the way: ${said}`} className="flex h-1 w-full overflow-hidden rounded-full">
      {bands.map((b, i) => <span key={i} style={{ flex: `${b.min / total} 1 0`, background: BAND_FILL[b.kind] }} />)}
    </span>
  );
}

/** One card, two short lines in the half sheet's room under the route
 *  box (some 84 points on a phone, the owner's "make the cards smaller so
 *  they fit"): its name and its time, one line of what it meets, and the
 *  weather strip under it. The one shown says its clock
 *  from departure to arrival in that line's place, and Use in its time's. */
function Card({ title, figure, line, lineInk, bands, minutes, depart, shown, used, best, onShow, action, testId }: {
  title: string;
  figure: string;
  line: string;
  lineInk?: string;
  bands?: { kind: string; min: number }[];
  minutes: number;
  depart: string | null;
  shown: boolean;
  used?: boolean;
  best?: boolean;
  onShow: () => void;
  action?: { label: string; run: () => void; testId: string };
  testId: string;
}) {
  const leave = depart ? new Date(depart) : new Date();
  const clock = shown && minutes > 0 ? `${clockTime(leave)} – ${clockTime(new Date(leave.getTime() + minutes * 60_000))}` : null;
  return (
    <div
      data-testid={testId} aria-current={shown || undefined}
      className={cn("relative flex h-full w-[54%] max-w-56 min-w-44 shrink-0 snap-start flex-col rounded-xl border bg-card",
        shown ? "border-2 border-primary" : "border-border")}
    >
      {/* The card's face shows it; Use, its own button at the top right. */}
      <button type="button" onClick={onShow} aria-pressed={shown} className="flex min-h-0 flex-1 flex-col justify-between gap-0.5 px-2.5 py-2 text-left outline-none">
        <span className={cn("flex w-full items-baseline justify-between gap-2", TEXT.note)}>
          <span className="flex min-w-0 items-center gap-1 font-semibold">
            <span className="truncate">{title}</span>
            {used ? <Check className="size-4 shrink-0 text-tint" aria-label="In use" />
              : best && !(shown && action) ? <span className="shrink-0 rounded-full bg-primary/12 px-1.5 text-tint">Best</span> : null}
          </span>
        </span>
        {/* The time in large figures on its own line, the name whole over
            it (the owner's screenshot: "Your Ro…", "Fas…" beside it). */}
        <span className="text-[1.375rem] leading-7 font-bold tabular-nums">{figure}</span>
        <span className={cn("truncate", TEXT.note, clock ? "text-muted-foreground tabular-nums" : lineInk ?? "text-muted-foreground")}>
          {clock ?? line}
        </span>
        {bands && bands.length > 0 ? <Strip bands={bands} /> : null}
      </button>
      {shown && action && (
        <Button size="sm" className="absolute top-1 right-1.5 h-6 rounded-full px-2.5" onClick={action.run} data-testid={action.testId}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * FPL's Routes (vfr.route_options), at the owner's picks of the routes
 * canvas ("Let's try your recommendation first but I also like B") and
 * of their size ("I want to see the options as well as the map. So let's
 * have the swipe able cards be the size of the space between route box and
 * calculations. Also avoid putting too much text", 2026-10-23): the ways
 * as cards side by side, as Maps lays out its routes, filling the half
 * sheet's body, each its name, its time, one short line and a strip of the
 * weather met along it. The pilot's own route first, what it crosses in
 * red; the straight line a card where the route has stops. A card tapped
 * is the one drawn strong on the map, with the clock at either end of its
 * strip and Use, which puts it in the route; the best, in good weather
 * first, named so. No heading or menu over them (the owner's "No need to
 * have the label and filter for routes"). Nothing
 * where the route is already the best of every kind and meets nothing.
 */
export default function RouteChoices({ found, stops, depart, ownMinutes, picked, onPreview, onPick, onDirect }: {
  found: RouteOptions | undefined;
  /** The route's own time en route as planned (the nav log's), its card's figure. */
  ownMinutes: number | null;
  /** The route's points between its ends, as the address has them. */
  stops: string[];
  /** When the flight leaves (the address's), for the strip's clock; now without one. */
  depart: string | null;
  /** The way shown on the map, by its kind ("direct" the straight line); null, the route itself. */
  picked: string | null;
  onPreview: (kind: string | null) => void;
  onPick: (option: RouteOption) => void;
  onDirect: () => void;
}) {
  if (!found) return null;
  const meets = stops.length ? found.current : found.direct;
  const others = found.options.filter(o => !isRoute(o, stops));
  if (!meets.length && !others.length) return null;
  const ranked = [...found.options].sort((a, b) => costOf(a, WANTS) - costOf(b, WANTS));
  const best = ranked[0];
  const current = found.current_along;
  const minutesOf = (bands?: { min: number }[]) => (bands ?? []).reduce((sum, b) => sum + b.min, 0);
  // One short line a card: what it crosses, else what it goes round, else its wind.
  const lineOf = (option: RouteOption): [string, string | undefined] => {
    if (option.crosses.length) return [`Crosses ${found.hazards[option.crosses[0]!]?.kind === "storm" ? "storms" : "weather"}`, "text-destructive-ink"];
    if (meets.some(h => !option.crosses.includes(h))) return ["Avoids the hazards", undefined];
    const tail = option.tail_kt ?? 0;
    if (tail >= 1) return [`Tailwind ${Math.round(tail)} kt`, undefined];
    if (tail <= -1) return [`Headwind ${Math.round(-tail)} kt`, undefined];
    return [`${option.landings ? `${option.landings} stop${option.landings > 1 ? "s" : ""}` : "No stops"} · ${grouped(Math.round(option.distance_nm))} nm`, undefined];
  };
  const crossesLine = meets.length
    ? `Crosses ${found.hazards[meets[0]!]?.kind === "storm" ? "storms" : found.hazards[meets[0]!]?.kind === "terrain" ? "high ground" : "weather"}`
    : "Clear";
  return (
    <section aria-label="Routes" className="flex flex-col pb-2" data-testid="route-choices">
      {/* The cards in the half sheet's room between the route box and
          the figures, so at half the map and the ways are both in sight. */}
      {/* As tall as the half sheet's body leaves (MapPanel's --half-body),
          less the room over and under them: up to the figures at the
          foot, at the owner's "a bit bigger just up to the calculations". */}
      <div
        className="-mx-4 flex h-[clamp(3.5rem,calc(var(--half-body,5rem)-0.75rem),9rem)] snap-x snap-mandatory gap-3 overflow-x-auto px-4 [scrollbar-width:none]"
        data-slides=""
      >
        <Card
          title="Your Route" figure={ownMinutes ? minutesWords(ownMinutes) : "—"} line={crossesLine}
          lineInk={meets.length ? "text-destructive-ink" : undefined} bands={current?.bands}
          minutes={minutesOf(current?.bands)} depart={depart} shown={picked === null} used
          onShow={() => onPreview(null)} testId="route-choice-current"
        />
        {ranked.map(option => {
          const [line, ink] = lineOf(option);
          const used = isRoute(option, stops);
          return (
            <Card
              key={option.kind} title={wayTitle(option)} figure={wayTime(option)} line={line} lineInk={ink}
              bands={option.bands} minutes={minutesOf(option.bands)} depart={depart}
              shown={picked === option.kind} used={used} best={option === best && !used}
              onShow={() => onPreview(option.kind)} testId={`route-choice-${option.kind}`}
              action={used ? undefined : { label: "Use", run: () => onPick(option), testId: "route-choice-use" }}
            />
          );
        })}
        {stops.length > 0 && !found.options.some(o => o.stops.length === 0) && (
          <Card
            title="Straight Line" figure="Direct" line={found.direct.length ? "Crosses hazards" : "Clear"}
            lineInk={found.direct.length ? "text-destructive-ink" : undefined} minutes={0} depart={depart}
            shown={picked === "direct"} onShow={() => onPreview("direct")} testId="route-choice-direct"
            action={{ label: "Use", run: onDirect, testId: "route-choice-direct-use" }}
          />
        )}
      </div>
    </section>
  );
}
