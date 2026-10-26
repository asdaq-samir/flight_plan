import { useEffect, useRef } from "react";
import { Coffee, Fuel, Minus, Mountain } from "lucide-react";
import { cn } from "cn";
import IconButton from "../../../components/IconButton";
import { ADD_CAPSULE, GLASS_BUTTON } from "../../../components/mapChrome";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { placeWords } from "../../../lib/advisories";
import type { FuelStop } from "../../../lib/api/types";
import { TEXT } from "../../../lib/text";
import { grouped } from "../../../lib/units";
import { StopGlance } from "./StopServices";
import { COURSE_MAGENTA } from "../../../lib/map/chartColors";

/** The route's magenta line on through a stop suggested and not yet in the
 *  route, dashed as its chip and its pump are (ProceduresRoute's
 *  ROUTE_LINE, solid between the route's own points). */
const SUGGESTED_LINE = { borderColor: COURSE_MAGENTA } as const;

/** A field's place in words: its city, as a town is spelt ("Eau Claire"),
 *  else its name. */
function fuelStopPlace(stop: FuelStop): string {
  return placeWords(stop.city || stop.name);
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
export default function FuelStopRow({ stop, reason = "fuel", time, groundMin, usableGal, choices, onChoose, onOpen, last }: {
  stop: FuelStop;
  /** A stop for fuel the tanks need, or a break about half way on a long
   *  flight they hold (the suggestion's `reason`): a cup, not the pump. */
  reason?: "fuel" | "break";
  /** When it is landed at, by the flight's own minutes to it. */
  time: string;
  /** The minutes on the ground a stop takes (groundMinAt). */
  groundMin: number;
  /** The tanks' usable fuel, for the gauge. */
  usableGal: number | null;
  /** The other fields this stop could be, and one picked in its place. */
  choices?: FuelStop[];
  onChoose?: (stop: FuelStop) => void;
  /** The field's card opened on it, with its figures and what is there on
   *  the ground (PlaceCard's `stop`): the row's words a tap. */
  onOpen?: () => void;
  last: boolean;
}) {
  const place = fuelStopPlace(stop);
  const Glyph = reason === "break" ? Coffee : Fuel;
  const what = reason === "break" ? "stop for a break" : "fuel stop";
  const pump = (
    <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full border-2 border-dashed border-caution bg-background text-caution">
      <Glyph className="size-3.5" strokeWidth={2.4} />
    </span>
  );
  return (
    <li className="relative flex gap-2.5" data-testid="fuel-stop" data-ident={stop.ident}>
      {!last && <span aria-hidden="true" className="absolute top-3 bottom-0 left-[calc(0.875rem-1px)] w-0 border-l-2 border-dashed" style={SUGGESTED_LINE} />}
      {/* Its pump is its menu of the other fields, as an airport's symbol
          is its menu (the owner's "Use the airport icon as the more
          button instead of having one to the right"). */}
      <div className="relative flex w-7 shrink-0 justify-center pt-0.5">
        {choices && choices.length > 0 && onChoose ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button" aria-label={`${stop.ident}: other fields ${reason === "break" ? "on the way" : "with fuel"}`} data-testid="fuel-stop-other" data-point-mark=""
                // The glass button an airport's symbol is (PointMenu).
                className={cn("relative -mx-1 grid size-9 place-items-center rounded-full outline-none after:absolute after:-inset-1 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", GLASS_BUTTON)}
              >
                {pump}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72" data-testid="fuel-stop-choices">
              <DropdownMenuLabel className={cn("text-muted-foreground", TEXT.note)}>{reason === "break" ? "Another field on the way" : "Another field with fuel"}</DropdownMenuLabel>
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
        ) : <span className="grid size-7 place-items-center">{pump}</span>}
      </div>
      {/* Laid out as the route's airports are (ProceduresRoute's block):
          its ident and the fuel it lands with, its time; its town and the
          time to refuel, its elevation; no runway, at the owner's ask ("No
          need to show runway when asking to add fuel stop"). */}
      <section aria-label={`Suggested ${what}, ${stop.ident}, ${place}`} className="relative grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 pb-4">
        {/* The whole of its words the way to the field's card, as an
            airport's line unfolds its runways (ProceduresRoute's
            field-toggle): stretched over them, under its pump's menu. */}
        {onOpen && (
          <button
            type="button" onClick={onOpen} data-testid="fuel-stop-open"
            aria-label={`${stop.ident}, ${place}: what is there`}
            className="absolute inset-x-0 -top-1 bottom-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
          {/* The room an airport's arrow takes before its ident, so the
              idents of the list line up (the owner's screenshot). */}
          <span aria-hidden="true" className="-ml-0.5 w-4 shrink-0" />
          <h3 className={cn("truncate font-semibold", TEXT.row)}>{stop.ident}</h3>
          <FuelGauge gal={stop.lands_with_gal} usable={usableGal} tone="fuel" />
        </div>
        <span className={cn("col-start-2 row-start-1 justify-self-end font-semibold tabular-nums", TEXT.detail)}><span className="sr-only">Lands at </span>{time}</span>
        <span className={cn("col-start-1 row-start-2 flex min-w-0 items-center gap-1 text-muted-foreground", TEXT.note)}>
          <span className="truncate">{place}</span>
          <span aria-hidden="true">·</span>
          <Glyph className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="shrink-0 tabular-nums"><span className="sr-only">{reason === "break" ? "On the ground " : "Refuelled in "}</span>{groundMin} min</span>
        </span>
        {stop.elevation_ft != null && (
          <span className={cn("col-start-2 row-start-2 inline-flex items-center gap-0.5 justify-self-end text-muted-foreground tabular-nums", TEXT.detail)}>
            <Mountain className="size-3.5 shrink-0" aria-hidden="true" />{grouped(Math.round(stop.elevation_ft))} ft
          </span>
        )}
        {/* What is there on the ground, once the planner has it: the
            nearest food, a car, a bed (StopServices). */}
        <StopGlance ident={stop.ident} className="col-span-2 row-start-3 pt-0.5" />
      </section>
    </li>
  );
}

/**
 * The fields a fuel stop could be, swiped as FPL's Routes are, at the
 * owner's ask ("Can you make them swipeable fuel stop options?",
 * 2026-10-25): the planner's pick first, then its others (the quickest
 * trips, fuelstops.CHOICES of them), a card each -- the field, the fuel it
 * lands with, when, its town and the miles it adds, and what is there on
 * the ground -- the one in sight the one Add puts in the route
 * (`onSee`), a tap on a card its field's card. Dots under them.
 */
export function FuelStopCards({ stops, seen, onSee, timeOf, usableGal, reason = "fuel", onOpen }: {
  stops: FuelStop[];
  /** The one in sight, by its index. */
  seen: number;
  onSee: (index: number) => void;
  /** When a field is landed at, from its minutes flown. */
  timeOf: (minutes: number) => string;
  usableGal: number | null;
  reason?: "fuel" | "break";
  onOpen?: (ident: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // A swipe come to rest on a card: it is the one Add puts in.
  const settled = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = strip.current, first = el?.children[0] as HTMLElement | undefined;
      if (!el || !first) return;
      const index = Math.min(stops.length - 1, Math.max(0, Math.round(el.scrollLeft / (first.offsetWidth + 8))));
      if (index !== seen) onSee(index);
    });
  };
  const Glyph = reason === "break" ? Coffee : Fuel;
  return (
    <li className="relative flex gap-2.5" data-testid="fuel-stop-cards">
      <span aria-hidden="true" className="absolute top-0 bottom-0 left-[calc(0.875rem-1px)] w-0 border-l-2 border-dashed" style={SUGGESTED_LINE} />
      <div className="w-7 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-3">
        <div
          ref={strip} onScroll={settled} aria-label={reason === "break" ? "Fields for the stop" : "Fields with fuel"} role="group"
          className="-mr-3 flex snap-x snap-mandatory gap-2 overflow-x-auto pr-3 [scrollbar-width:none]"
        >
          {stops.map((stop, i) => (
            <button
              key={stop.ident} type="button" onClick={onOpen ? () => onOpen(stop.ident) : undefined}
              aria-current={i === seen ? true : undefined} data-testid="fuel-stop-card" data-ident={stop.ident}
              aria-label={`${i === 0 ? "Suggested" : "Another"} ${reason === "break" ? "stop for a break" : "fuel stop"}, ${stop.ident}, ${fuelStopPlace(stop)}`}
              className="flex w-[85%] shrink-0 snap-start flex-col gap-0.5 rounded-2xl bg-foreground/6 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cn("truncate font-semibold", TEXT.row)}>{stop.ident}</span>
                <FuelGauge gal={stop.lands_with_gal} usable={usableGal} tone="fuel" />
                <span className={cn("ml-auto shrink-0 font-semibold tabular-nums", TEXT.detail)}><span className="sr-only">Lands at </span>{timeOf(stop.minutes)}</span>
              </span>
              <span className={cn("flex min-w-0 items-center gap-1 text-muted-foreground", TEXT.note)}>
                <Glyph className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{fuelStopPlace(stop)}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0 tabular-nums">{Math.round(stop.added_nm) < 1 ? "on the route" : `${Math.round(stop.added_nm)} nm detour`}</span>
                {i === 0 && <span className="shrink-0">· Suggested</span>}
              </span>
              <StopGlance ident={stop.ident} className="pt-0.5" />
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-2" aria-hidden="true">
          {stops.map((stop, i) => <span key={stop.ident} className={cn("size-1.5 rounded-full", i === seen ? "bg-foreground/70" : "bg-foreground/20")} />)}
        </div>
      </div>
    </li>
  );
}

/**
 * Where suggested stops were taken out (FuelStopsAdd's minus, the chip's
 * Remove): one tap puts them back in the list and the route's box, at the
 * owner's ask ("when the fuel stops are deleted, we still want to be able
 * to add them back", 2026-10-25), as the route's menu's Show Fuel Stops
 * does.
 */
export function FuelStopsHidden({ count, onShow, reason = "fuel" }: { count: number; onShow: () => void; reason?: "fuel" | "break" }) {
  return (
    <li className="relative flex gap-2.5">
      <div className="w-7 shrink-0" />
      <div className="min-w-0 flex-1 pb-4">
        <button type="button" onClick={onShow} data-testid="fuel-stop-show" className={ADD_CAPSULE}>
          {reason === "break" ? "Show Suggested Stop" : count === 1 ? "Show Fuel Stop" : `Show ${count} Fuel Stops`}
        </button>
      </div>
    </li>
  );
}

/**
 * The suggested stops put in the route, one tap after the last of them,
 * as Tesla's trip is sent to the car: "Add Fuel Stop", or "Add 2 Fuel
 * Stops", in the tint -- an action's words in Title Case, as iOS sets a
 * button's (the owner's D2, 2026-10-23).
 */
export function FuelStopsAdd({ count, onAdd, onRemove, last, reason = "fuel", field }: {
  count: number; onAdd: () => void; last: boolean; reason?: "fuel" | "break";
  /** The field Add puts in, where the stop is one swiped to (FuelStopCards). */
  field?: string;
  /** The suggestion taken out, as its chip's Remove in the route box does:
   *  a round minus beside Add, at the owner's ask (2026-10-25). */
  onRemove?: () => void;
}) {
  const what = reason === "break" ? "stop" : count === 1 ? "fuel stop" : "fuel stops";
  return (
    <li className="relative flex gap-2.5">
      {!last && <span aria-hidden="true" className="absolute top-0 bottom-0 left-[calc(0.875rem-1px)] w-0 border-l-2 border-dashed" style={SUGGESTED_LINE} />}
      <div className="w-7 shrink-0" />
      {/* Twelve apart, so the capsule's and the minus's 44-point areas meet. */}
      <div className="flex min-w-0 flex-1 items-center gap-3 pb-4">
        <button
          type="button" onClick={onAdd} data-testid="fuel-stop-keep"
          className={ADD_CAPSULE}
        >
          {field ? `Add ${field}` : reason === "break" ? "Add Stop" : count === 1 ? "Add Fuel Stop" : `Add ${count} Fuel Stops`}
        </button>
        {onRemove && (
          <IconButton
            label={`Remove the suggested ${what}`} onClick={onRemove} data-testid="fuel-stop-remove"
            className="relative size-8 shrink-0 rounded-full bg-destructive/12 text-destructive hover:bg-destructive/20 hover:text-destructive after:absolute after:-inset-1.5 after:content-['']"
          >
            <Minus className="size-[1.125rem]" strokeWidth={2.5} />
          </IconButton>
        )}
      </div>
    </li>
  );
}
