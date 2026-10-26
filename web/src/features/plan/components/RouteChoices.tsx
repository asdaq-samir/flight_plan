import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../../components/ui/button";
import type { RouteOption, RouteOptions } from "../../../lib/api/types";
import { clockTime, minutesWords } from "../../../lib/clock";
import { gridScale, isRoute, offered, routesOffered, wayTitle } from "../../../lib/routeWays";
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

/** The weather a way meets, as a strip laid out by the time it is met. */
function Strip({ bands }: { bands: { kind: string; min: number }[] }) {
  const total = bands.reduce((sum, b) => sum + b.min, 0) || 1;
  const said = bands.filter((b, i, all) => all.findIndex(x => x.kind === b.kind) === i).map(b => BAND_WORDS[b.kind]).join(", ");
  return (
    <span role="img" aria-label={`Weather along the way: ${said}`} className="absolute inset-x-4 bottom-1.5 flex h-1 overflow-hidden rounded-full">
      {bands.map((b, i) => <span key={i} style={{ flex: `${b.min / total} 1 0`, background: BAND_FILL[b.kind] }} />)}
    </span>
  );
}

/** One card, as Maps lays out a route: its time in large figures, its
 *  arrival and miles, and its name -- or what it crosses, in amber -- with
 *  Use at the right where it is not the route already; the weather met
 *  along it a thin strip at its foot. */
function Card({ minutes, arrive, nm, landings = 0, waterNm = 0, name, warning, bands, used, best, onUse, testId, listed = false, shown = false, onShow }: {
  minutes: number | null;
  arrive: string | null;
  nm: number | null;
  /** Its fuel stops, said with its miles. */
  landings?: number;
  /** Its miles out of a glide's reach of dry land (vfr.water). */
  waterNm?: number;
  name: string;
  warning: string | null;
  bands?: { kind: string; min: number }[];
  used?: boolean;
  best?: boolean;
  onUse?: () => void;
  testId: string;
  /** In the list all the way up, one under another, white on the sheet's
   *  grey with the one shown ringed in the tint, as Maps lists its routes
   *  with its sheet up; else one of the swiped row at half. */
  listed?: boolean;
  shown?: boolean;
  onShow?: () => void;
}) {
  return (
    <div
      data-testid={testId} aria-current={listed && shown ? true : undefined}
      // One height in the list all the way up and in the row at half: the
      // sheet's room all the way up shared by the cards in it (--full-body,
      // MapPanel), at the owner's "Adjust height to fit them in full card,
      // keep that height in half card as well".
      style={{ height: "var(--route-card)" }}
      className={cn("relative flex w-full shrink-0 items-center gap-3 rounded-3xl px-4",
        listed ? cn("bg-card", shown ? "border-2 border-primary shadow-[0_2px_12px_rgba(0,122,255,0.15)]" : "border-2 border-transparent")
          : "snap-center bg-foreground/6")}
    >
      {/* All the way up the card's face shows its way, Use its own button over it. */}
      {listed && onShow && <button type="button" aria-label={`Show ${name}`} aria-pressed={shown} onClick={onShow} className="absolute inset-0 rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-ring" />}
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="text-[1.625rem] leading-8 font-bold tabular-nums">{minutes ? minutesWords(minutes) : "—"}</span>
        <span className={cn("truncate text-muted-foreground tabular-nums", TEXT.note)}>
          {[arrive && `${arrive} ETA`, nm && `${grouped(Math.round(nm))} nm`, landings ? `${landings} fuel stop${landings > 1 ? "s" : ""}` : null,
            waterNm ? `${grouped(waterNm)} nm over water` : null].filter(Boolean).join(" · ")}
        </span>
        {/* What it meets in amber, a caution for the pilot to weigh, not
            red: the planner warns and never refuses (the owner's "change
            from red to amber", 2026-10-25). */}
        <span className={cn("truncate", TEXT.note, warning ? "text-caution-ink" : "text-muted-foreground")}>
          {warning ? `${name} · ${warning}` : best ? `${name} · Best` : name}
        </span>
      </div>
      {used ? <Check className="size-6 shrink-0 text-tint" aria-label="In use" />
        : onUse && (
          <Button className="relative h-12 shrink-0 rounded-2xl px-5 text-[1.0625rem] font-bold" onClick={onUse} data-testid={`${testId}-use`}>Use</Button>
        )}
      {bands && bands.length > 0 && <Strip bands={bands} />}
    </div>
  );
}

/**
 * FPL's Routes (vfr.route_options), as Maps offers its routes, at the
 * owner's screenshot of Maps' directions: one card a time the route box's
 * width, swiped to the next with a dot for each under them, the card in
 * sight the way drawn strong on the map; each its time in large figures,
 * its arrival and miles and its name -- what it crosses in red -- and Use
 * at its right, which puts it in the route. Four routes, at the owner's
 * "We should have 4 routes: your route, your route with fuel stops, best
 * weather with fuel stops, fastest with fuel stops": the pilot's own first
 * (the owner's "Keep yours, flag issues"), it with the planner's fuel
 * stops put in where it needs any, then the best weather's and the
 * fastest, one card where they are the same way. In the half sheet's
 * room between the route box and the figures at its foot. Nothing where
 * the route is already the best of every kind, needs no fuel and meets
 * nothing.
 */
export default function RouteChoices({ found, stops, depart, ownMinutes, ownGround = 0, ownNm, withFuel, onUseFuel, onUseOwn, full = false, picked, onPreview, onPick }: {
  found: RouteOptions | undefined;
  /** The route with the planner's fuel stops put in (the totals' fuel
   *  stops), its time and miles as they come to; null where it needs none. */
  withFuel: { minutes: number; nm: number; landings: number } | null;
  onUseFuel: () => void;
  /** The route as it is kept, the cards put away. */
  onUseOwn: () => void;
  /** The sheet all the way up: the cards a list, one under another (the
   *  owner's screenshot of Maps with its sheet up, "When card is full"). */
  full?: boolean;
  /** The route's own time en route and miles as planned (the nav log's). */
  ownMinutes: number | null;
  /** Its minutes on the ground at its own stops, told with its air time
   *  as the ways' are (their ground_min). */
  ownGround?: number;
  ownNm: number | null;
  /** The route's points between its ends, as the address has them. */
  stops: string[];
  /** When the flight leaves (the address's), for each card's arrival; now without one. */
  depart: string | null;
  /** The way shown on the map, by its kind ("fuel" the route with its fuel stops); null, the route itself. */
  picked: string | null;
  onPreview: (kind: string | null) => void;
  onPick: (option: RouteOption) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const aiming = useRef<{ left: number; until: number } | null>(null);
  const later = useRef(0);
  // The owner's four (2026-10-23): the route, the route with its fuel
  // stops, the best weather's and the fastest, each with its fuel stops.
  const ways = found ? found.options.filter(offered) : [];
  const ranked = [...ways].sort((a, b) => (a.kinds.includes("weather") ? 0 : 1) - (b.kinds.includes("weather") ? 0 : 1));
  const best = [...ways].sort((a, b) => costOf(a, WANTS) - costOf(b, WANTS))[0];
  const meets = found ? (stops.length ? found.current : found.direct) : [];
  // The cards in order, by the kind each shows: the route itself (null),
  // it with its fuel stops ("fuel"), the ways.
  const keys: (string | null)[] = [null, ...(withFuel ? ["fuel"] : []), ...ranked.map(o => o.kind)];
  const at = Math.max(0, keys.indexOf(picked));
  const keysKey = keys.join(",");
  // A way picked on the map brings its card into sight.
  useEffect(() => {
    const el = strip.current;
    const card = el?.children[at] as HTMLElement | undefined;
    if (!el || !card) return;
    const left = card.offsetLeft - el.offsetLeft - 12;
    if (Math.abs(el.scrollLeft - left) <= 4) return;
    // The cards it passes on the way are not swiped to: the row's own
    // scrolls are let be till it is there (or a second has gone, a finger
    // having taken it), where they each showed their way and the last
    // put back the one before the way picked (route-choices.spec).
    aiming.current = { left, until: performance.now() + 1000 };
    el.scrollTo({ left, behavior: "smooth" });
  }, [at, keysKey]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); window.clearTimeout(later.current); }, []);
  // How far down the panel's body the cards start, under the route box:
  // at half they are to end, their dots under them, above the flight's
  // figures (the owner's "make sure I can see the three dots").
  const showing = !!found && routesOffered(found, stops, !!withFuel);
  const section = useRef<HTMLElement>(null);
  const [above, setAbove] = useState<number | null>(null);
  useEffect(() => {
    const el = section.current;
    let scroller = el?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!el || !scroller) return;
    const body = scroller;
    const read = () => setAbove(Math.round(el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop));
    read();
    const sized = new ResizeObserver(read);
    sized.observe(body);
    if (body.firstElementChild) sized.observe(body.firstElementChild);
    return () => sized.disconnect();
  }, [showing, full]);
  if (!found) return null;
  if (!routesOffered(found, stops, !!withFuel)) return null;
  // The planner's ways are timed on its coarse grid, the route by its nav
  // log: each way's air time scaled by how the two differ on the route
  // itself, so the four are told alike -- the "Fastest" came out slower
  // than the route with its fuel stops, on two clocks (the owner's
  // screenshot, 2026-10-24).
  const scale = gridScale(found, ownMinutes);
  const leave = depart ? new Date(depart) : new Date();
  const arrive = (minutes: number | null) => (minutes ? clockTime(new Date(leave.getTime() + minutes * 60_000)) : null);
  const kindWords = (i: number) => (found.hazards[i]?.kind === "storm" ? "storms" : found.hazards[i]?.kind === "terrain" ? "high ground" : "weather");
  // What a way meets, the first thing: a hazard crossed, or no field with
  // fuel in reach of it (the planner's "fuel" hazard).
  const warningOf = (crosses: number[]) => {
    const i = crosses[0];
    if (i === undefined) return null;
    return found.hazards[i]?.kind === "fuel" ? "No fuel stop in reach" : `Crosses ${kindWords(i)}`;
  };
  const own = ownMinutes === null ? null : ownMinutes + ownGround;
  // A swipe that comes to rest on a card shows its way on the map.
  const settled = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = strip.current;
      const first = el?.children[0] as HTMLElement | undefined;
      if (!el || !first) return;
      const aim = aiming.current;
      if (aim) {
        if (Math.abs(el.scrollLeft - aim.left) > 4 && performance.now() < aim.until) {
          // Looked at again once the aim has run out: a finger that stops
          // the row short of it fires no scroll after this one.
          window.clearTimeout(later.current);
          later.current = window.setTimeout(settled, aim.until - performance.now() + 16);
          return;
        }
        aiming.current = null;
        if (Math.abs(el.scrollLeft - aim.left) <= 4) return;
      }
      const index = Math.round(el.scrollLeft / (first.offsetWidth + 12));
      const kind = keys[Math.min(keys.length - 1, Math.max(0, index))] ?? null;
      if (kind !== picked) onPreview(kind);
    });
  };
  const cards = (
    <>
        <Card
          minutes={own} arrive={arrive(own)} nm={ownNm} waterNm={found.current_along?.water_nm} name="Your Route"
          warning={warningOf(meets)} bands={found.current_along?.bands}
          onUse={onUseOwn} testId="route-choice-current" listed={full} shown={picked === null} onShow={() => onPreview(null)}
        />
        {withFuel && (
          <Card
            minutes={withFuel.minutes} arrive={arrive(withFuel.minutes)} nm={withFuel.nm} landings={withFuel.landings} waterNm={found.own?.water_nm} name="Your Route with Fuel"
            warning={null} onUse={onUseFuel} testId="route-choice-fuel"
            listed={full} shown={picked === "fuel"} onShow={() => onPreview("fuel")}
          />
        )}
        {ranked.map(option => {
          const used = isRoute(option, stops);
          const minutes = option.air_min * scale + option.ground_min;
          return (
            <Card
              key={option.kind} minutes={minutes} arrive={arrive(minutes)} nm={option.distance_nm} landings={option.landings} waterNm={option.water_nm} name={wayTitle(option)}
              warning={warningOf(option.crosses)}
              bands={option.bands} used={used} best={option === best && !used}
              onUse={used ? undefined : () => onPick(option)} testId={`route-choice-${option.kind}`}
              listed={full} shown={picked === option.kind} onShow={() => onPreview(option.kind)}
            />
          );
        })}

    </>
  );
  // The cards' height: the sheet's room all the way up, less the gaps,
  // shared by them; a card's three lines at the least, 4.5 rem.
  // No taller than the room at half under the route box, less the dots'
  // 1 rem with their gap and padding (--half-body, MapPanel; the body
  // runs up under the head, --panel-head, where it is see-through): the same
  // height in both, as the owner asked, the dots in sight at half.
  const share = `calc((var(--full-body, 32rem) - ${keys.length - 1} * 0.75rem - 1rem) / ${keys.length})`;
  const room = above === null ? null : `calc(var(--half-body, 20rem) + var(--panel-head, 0px) - ${above}px - 1rem)`;
  const cardHeight = { "--route-card": room ? `max(4.5rem, min(${share}, ${room}))` : `max(4.5rem, ${share})` } as CSSProperties;
  if (full) {
    return (
      <section ref={section} aria-label="Routes" style={cardHeight} className="flex flex-col gap-3 pb-4" data-testid="route-choices">
        {cards}
      </section>
    );
  }
  return (
    <section ref={section} aria-label="Routes" style={cardHeight} className="flex flex-col gap-1.5 pb-1" data-testid="route-choices">
      {/* The route box's width, one at a time (the owner's "make them same
          width as the route box and then they can be swiped"), each the
          height it has in the list all the way up, the dots under them. */}
      <div
        ref={strip} onScroll={settled}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 [scrollbar-width:none]"
        data-slides=""
      >
        {cards}
      </div>
      <div className="flex justify-center gap-2" aria-hidden="true">
        {keys.map((key, i) => <span key={key ?? "own"} className={cn("size-1.5 rounded-full", i === at ? "bg-foreground/70" : "bg-foreground/20")} />)}
      </div>
    </section>
  );
}
