import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../../components/ui/button";
import type { RouteOption, RouteOptions } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { isRoute, wayTime, wayTitle } from "../../../lib/routeWays";
import { GROUP_HEADING, TEXT } from "../../../lib/text";
import { grouped } from "../../../lib/units";

/** A hazard's words inside a line: "Thunderstorms forecast" as
 *  "thunderstorms forecast", an ident (KDLH, P-56) as it is. */
function inLine(words: string[]): string {
  return words.join("; ").replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
}

/** The weather strip's colours: the flight categories' (lib/map/
 *  flightCategory), a thunderstorm darker than IFR's red. */
const BAND_FILL: Record<string, string> = { vfr: "#1a7f37", mvfr: "#0a4fb3", ifr: "#b3261e", storm: "#7a0010" };
const BAND_WORDS: Record<string, string> = { vfr: "VFR", mvfr: "marginal", ifr: "IFR", storm: "thunderstorms" };

/** What the pilot can ask of the ways, each on or off (the owner's pick B,
 *  "What matters on this flight", 2026-10-23): toggles, not a slider. */
const WANTS = [
  { key: "minimums", label: "Good Weather" },
  { key: "wind", label: "Tailwinds" },
  { key: "stops", label: "Fewest Stops" },
  { key: "low", label: "Below 6,000 ft" },
] as const;
type Want = (typeof WANTS)[number]["key"];

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

/** The weather a way meets, as a strip laid out by the time it is met. */
function Strip({ bands, tall = false }: { bands: { kind: string; min: number }[]; tall?: boolean }) {
  const total = bands.reduce((sum, b) => sum + b.min, 0) || 1;
  const said = bands.filter((b, i, all) => all.findIndex(x => x.kind === b.kind) === i).map(b => BAND_WORDS[b.kind]).join(", ");
  return (
    <span role="img" aria-label={`Weather along the way: ${said}`} className={cn("flex w-full overflow-hidden rounded-[4px]", tall ? "h-5" : "h-1.5")}>
      {bands.map((b, i) => (
        <span key={i} style={{ flex: `${b.min / total} 1 0`, background: BAND_FILL[b.kind] }}
          className={cn("flex items-center justify-center font-semibold text-white", tall && TEXT.caption)}>
          {tall && b.min / total > 0.18 && b.kind !== "vfr" ? BAND_WORDS[b.kind] : null}
        </span>
      ))}
    </span>
  );
}

/**
 * FPL's Routes (vfr.route_options), at the owner's pick of the routes
 * canvas ("Let's try your recommendation first but I also like B",
 * 2026-10-23): the ways side by side as cards, as Maps lays out its
 * routes, each with its time, its stops and miles and a strip of the
 * weather met along it; what matters on this flight as toggles over them,
 * which order them; a card tapped is the one shown on the map and under
 * the cards, with the weather by the clock as it would be met, and Use
 * puts it in the route. The pilot's own route is the first card, with
 * what it crosses (the owner's "Keep yours, flag issues"); the straight
 * line one tap away. Nothing where the route is already the best of every
 * kind and meets nothing.
 */
export default function RouteChoices({ found, stops, depart, picked, onPreview, onPick, onDirect }: {
  found: RouteOptions | undefined;
  /** The route's points between its ends, as the address has them. */
  stops: string[];
  /** When the flight leaves (the address's), for the strip's clock; now without one. */
  depart: string | null;
  /** The way shown on the map and under the cards, by its kind; null, the route itself. */
  picked: string | null;
  onPreview: (kind: string | null) => void;
  onPick: (option: RouteOption) => void;
  onDirect: () => void;
}) {
  const [wants, setWants] = useState<Set<Want>>(() => new Set<Want>(["minimums"]));
  if (!found) return null;
  const name = (i: number) => found.hazards[i]?.name ?? "";
  const meets = stops.length ? found.current : found.direct;
  const others = found.options.filter(o => !isRoute(o, stops));
  if (!meets.length && !others.length) return null;
  const ranked = [...found.options].sort((a, b) => costOf(a, wants) - costOf(b, wants));
  const best = ranked[0];
  const shown = picked ? found.options.find(o => o.kind === picked) ?? null : null;
  const current = found.current_along;
  const flip = (want: Want) => setWants(was => {
    const next = new Set(was);
    if (next.has(want)) next.delete(want);
    else next.add(want);
    return next;
  });
  // The strip under the cards: the way picked, else the route itself, by
  // the clock from the departure.
  const strip = shown?.bands ?? current?.bands ?? [];
  const minutes = strip.reduce((sum, b) => sum + b.min, 0);
  const leave = depart ? new Date(depart) : new Date();
  const ticks = minutes ? [0, 1 / 3, 2 / 3, 1].map(f => clockTime(new Date(leave.getTime() + f * minutes * 60_000))) : [];
  const ends = found.ends.map(name);
  return (
    <section aria-labelledby="route-choices-title" className="flex flex-col gap-3 pb-4" data-testid="route-choices">
      <h3 id="route-choices-title" className={cn("px-1", GROUP_HEADING)}>Routes</h3>
      {/* What matters on this flight: toggles; thunderstorms kept clear of whatever. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="What matters on this flight">
        {WANTS.map(w => (
          <Button
            key={w.key} size="sm" variant={wants.has(w.key) ? "default" : "outline"} aria-pressed={wants.has(w.key)}
            className="rounded-full" onClick={() => flip(w.key)} data-testid={`route-want-${w.key}`}
          >
            {w.label}
          </Button>
        ))}
      </div>
      {/* The ways side by side, the pilot's own first: a tap shows one. */}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" data-slides="">
        <button
          type="button" onClick={() => onPreview(null)} aria-pressed={picked === null} data-testid="route-choice-current"
          className={cn("flex w-44 shrink-0 snap-start flex-col items-start gap-1 rounded-2xl border bg-card p-3 text-left",
            picked === null ? "border-2 border-primary" : "border-border")}
        >
          <span className={cn("font-semibold", TEXT.note)}>Your Route</span>
          {current && <Strip bands={current.bands} />}
          <span className={cn(TEXT.detail, meets.length ? "text-destructive-ink" : "text-muted-foreground")}>
            {meets.length ? `Crosses ${inLine(meets.map(name))}` : "Meets nothing on the way"}
          </span>
        </button>
        {ranked.map(option => {
          const used = isRoute(option, stops);
          const round = meets.filter(h => !option.crosses.includes(h)).map(name);
          const tail = option.tail_kt ?? 0;
          return (
            <button
              key={option.kind} type="button" onClick={() => onPreview(option.kind)} aria-pressed={picked === option.kind}
              data-testid={`route-choice-${option.kind}`}
              className={cn("flex w-44 shrink-0 snap-start flex-col items-start gap-1 rounded-2xl border bg-card p-3 text-left",
                picked === option.kind ? "border-2 border-primary" : "border-border")}
            >
              <span className={cn("flex w-full items-center justify-between gap-1 font-semibold", TEXT.note)}>
                <span>{wayTitle(option)}</span>
                {used && <Check className="size-4 shrink-0 text-tint" aria-label="In use" />}
              </span>
              <span className="text-[1.5rem] leading-7 font-bold tabular-nums">{wayTime(option)}</span>
              <span className={cn("text-muted-foreground", TEXT.detail)}>
                {option.landings ? `${option.landings} fuel stop${option.landings > 1 ? "s" : ""}` : "No stops"} · {grouped(Math.round(option.distance_nm))} nm
              </span>
              {option.bands && option.bands.length > 0 && <Strip bands={option.bands} />}
              <span className={cn(TEXT.note, option.crosses.length ? "text-destructive-ink" : option.marginal.length ? "text-caution-ink" : "text-muted-foreground")}>
                {option.crosses.length ? `Crosses ${inLine(option.crosses.map(name))}`
                  : round.length ? `Round ${inLine(round)}`
                  : tail >= 1 ? `Tailwind ${Math.round(tail)} kt`
                  : tail <= -1 ? `Headwind ${Math.round(-tail)} kt` : "Calm winds"}
              </span>
              {option === best && !used && <span className={cn("font-semibold text-tint", TEXT.note)}>Best for this flight</span>}
            </button>
          );
        })}
      </div>
      {/* The weather by the clock along the one shown, as it would be met. */}
      {strip.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="route-weather-strip">
          <span className={cn("text-muted-foreground", TEXT.note)}>Weather along the way, as you get there</span>
          <Strip bands={strip} tall />
          <div className={cn("flex justify-between text-muted-foreground tabular-nums", TEXT.note)}>
            {ticks.map((t, i) => <span key={i}>{t}</span>)}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        {stops.length > 0 && !found.options.some(o => o.stops.length === 0) && (
          <Button variant="outline" className="flex-1 text-tint" onClick={onDirect} data-testid="route-choice-direct">Straight Line</Button>
        )}
        {shown && !isRoute(shown, stops) && (
          <Button className="flex-1" onClick={() => onPick(shown)} data-testid="route-choice-use">Use {wayTitle(shown)}</Button>
        )}
      </div>
      {(ends.length > 0 || found.unchecked.length > 0) && (
        <p className={cn("px-1 text-muted-foreground", TEXT.note)}>
          {[...ends, ...found.unchecked.map(what => `Not checked: ${what}`)].join(" · ")}
        </p>
      )}
    </section>
  );
}
