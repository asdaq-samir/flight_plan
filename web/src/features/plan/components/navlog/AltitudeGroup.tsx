import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import { INLINE_FIELD_BUTTON, InlineField } from "../../../../components/InlineField";
import { GLASS_BUTTON } from "../../../../components/mapChrome";
import Segmented from "../../../../components/Segmented";
import { faaWords } from "../../../../lib/advisories";
import type { AltitudeChoice, Detour, Leg, NavLogAltitude } from "../../../../lib/api/types";
import type { FlightRules } from "../../../../lib/preferences";
import { routeProfileQuery } from "../../../../lib/queryClient";
import { GROUP_HEADING, TEXT } from "../../../../lib/text";
import { altFt, flightLevel, one } from "../../../../lib/units";
import { hhmm } from "../../format";
import AltitudeReasoning from "../AltitudeReasoning";
import type { RouteEnds } from "./rows";

const RULES = [{ value: "vfr", label: "VFR" }, { value: "ifr", label: "IFR" }];
const feet = (ft: number) => ft.toLocaleString("en-US");
/** An altitude as said: feet under 18,000 ft, a flight level from there
 *  up, where altimeters are set to 29.92 (14 CFR 91.121, AIM 7-2-2). */
/** The room over the highest ground, or how far under it. */
const clearanceWords = (ft: number) => (ft >= 0 ? `${feet(ft)} ft` : `${feet(-ft)} ft under`);
/** Where the route first meets ground at or over the altitude. */
const strikeWords = (nm: number | null) => (nm === null ? "None" : `${Math.round(nm)} nm`);

/** What the empty field says: an example of what it takes, at the owner's
 *  ask ("I want it to say Alt: 080 as a text filler example"). */
const PLACEHOLDER = "Alt: 080";
const said = (ft: number) => (ft >= 18_000 ? `FL${Math.round(ft / 100)}` : `${feet(ft)} feet`);

/** The cruising altitude the log flies: the highest of its legs once they
 *  are in, a point's own altitude among them (RouteBox), else of the
 *  plan's steps -- one figure, as an EFB's route has; null before there
 *  is one. */
function cruiseOf(nav: NavLogAltitude | null, legs: Leg[]): number | null {
  if (!nav || nav.flown === null) return null;
  const plan = nav.options.find(o => o.kind === nav.flown);
  const flown = legs.length ? legs.map(leg => leg.altitude_ft)
    : plan ? plan.steps.map(st => st.altitude_ft) : nav.altitude_ft !== null ? [nav.altitude_ft] : [];
  return flown.length ? Math.max(...flown) : null;
}

/** Each plan's name at the altitude it cruises at, its highest step:
 *  "Fastest · Economical" where two fly the same, in PREFERRED's order, so
 *  the first is the one the altitude is flown as. */
function planNames(nav: NavLogAltitude | null): Record<number, string> {
  const names: Record<number, string[]> = {};
  const options = [...(nav?.options ?? [])].sort((a, b) => PREFERRED.indexOf(a.kind) - PREFERRED.indexOf(b.kind));
  for (const o of options) {
    if (!o.steps.length) continue;
    const top = Math.max(...o.steps.map(s => s.altitude_ft));
    (names[top] ??= []).push(o.kind[0]!.toUpperCase() + o.kind.slice(1));
  }
  return Object.fromEntries(Object.entries(names).map(([ft, kinds]) => [ft, kinds.join(" · ")]));
}

/** Which plan an altitude several plans share is taken as, after the one
 *  flown: the planner's default, Fastest, first. */
const PREFERRED: AltitudeChoice[] = ["fastest", "economical", "lowest", "highest"];

/** A plan that cruises at `altitude`: the one flown where it does, else
 *  by PREFERRED -- what picking that altitude on the wheel flies, its
 *  steps and all. Lowest, listed first, was taken where it and Fastest
 *  shared one, and the default plan could not be had back from the wheel. */
function planAt(nav: NavLogAltitude | null, altitude: number): AltitudeChoice | null {
  const at = (nav?.options ?? []).filter(o => o.steps.length && Math.max(...o.steps.map(s => s.altitude_ft)) === altitude).map(o => o.kind);
  if (nav?.flown && at.includes(nav.flown as AltitudeChoice)) return nav.flown as AltitudeChoice;
  return PREFERRED.find(kind => at.includes(kind)) ?? null;
}

/**
 * The cruising altitude beside the airplane, as the owner picked it
 * (2026-10-20, the redesign's input 1): the figure itself, typed in feet,
 * and the profile's button after it, which opens the Profile card, where
 * the altitude is set on the route's side view (AltitudeProfile), at the
 * owner's ask ("we won't need a separate profile button next to navlog").
 * A figure typed is flown on Enter, or as the field is left. Marked as the
 * chip was: red with no legal altitude, IFR's flag, a tight altitude and a
 * pilot's own altitude's caution.
 */
export default function AltitudeGroup({ nav, legs, commanded = null, problem = false, tight = null, onFlyAltitude, onOpenProfile, disabled = false, rules = "vfr" }: {
  nav: NavLogAltitude | null;
  legs: Leg[];
  /** The altitude the pilot asked for, feet, while its log is planned: the
   *  field shows it from the moment it is asked, not the one before it. */
  commanded?: number | null;
  /** No legal altitude on the route: the group red, its card saying why. */
  problem?: boolean;
  /** A leg where no 500 ft step fits (vfr.altitude's tight altitude). */
  tight?: string | null;
  /** Flies the whole route at an altitude of the pilot's own, feet. */
  onFlyAltitude: (feet: number) => void;
  /** Opens the Profile card, the altitude set on its side view. */
  onOpenProfile: () => void;
  disabled?: boolean;
  /** The flight rules it is planned under: IFR's flag on the group. */
  rules?: FlightRules;
}) {
  const cruise = cruiseOf(nav, legs);
  const cautions = nav?.cautions ?? [];
  // What is typed, while it is: the figure flown otherwise.
  const [typed, setTyped] = useState<string | null>(null);
  // Written as a flight level at every altitude -- FL045 for 4,500 ft --
  // at the owner's pick (2026-10-20), told that the FAA's flight levels
  // start at 18,000 ft MSL, where altimeters go to 29.92 (14 CFR 1.1,
  // 91.121(a)): the figure is hundreds of feet MSL, and the planner's are
  // feet MSL still, as VoiceOver says them (`said`). Typed, three figures
  // at most, hundreds of feet as written, at the owner's ask ("when altitude
  // is entered it should only hold 3 digits").
  const flying = commanded ?? cruise;
  const shown = typed ?? (problem || flying === null ? "" : flightLevel(flying).slice(2));
  const top = rules === "ifr" ? 41_000 : 17_999;
  const fly = () => {
    if (typed === null) return;
    const digits = typed.replace(/\D/g, "");
    const ft = Number(digits) * 100;
    setTyped(null);
    // A VFR altitude is under Class A (14 CFR 71.33, 91.135); IFR's up to
    // FL410, the highest 91.179(b)(4) names.
    if (ft >= 500 && ft <= top && ft !== flying) onFlyAltitude(ft);
  };
  const profiled = !disabled && (problem || (!!nav && (flying !== null || nav.flown === null)));
  // The button there as soon as a figure is, greyed till the plan it shows
  // is in, at the owner's ask ("make the profile button appear right after
  // entry but just make it disabled").
  const entered = shown !== "";
  const why = problem ? "no legal altitude" : flying !== null ? said(flying)
    : nav?.flown === null ? "no altitude: no winds" : "not yet planned";
  return (
    // A field as the route box is, at the owner's ask ("make the altitude
    // input similar to route box style where profile button only shows
    // with an altitude there"), the N-number's own (InlineField): the
    // profile's button once there is an altitude in the field, at the
    // owner's ask ("when altitude is entered ... a profile button shows
    // up"), or why there is none to show.
    <InlineField
      label="Cruise altitude" testId="altitude-group" widest="000" tabular placeholder={PLACEHOLDER}
      input={{
        inputMode: "numeric", value: shown, "aria-label": "Cruise altitude, hundreds of feet",
        onChange: e => setTyped(e.target.value.replace(/\D/g, "").slice(0, 3)),
        onKeyDown: e => { if (e.key === "Enter") { e.preventDefault(); fly(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTyped(null); },
        onBlur: fly, "data-testid": "altitude-input",
      }}
      inputClassName={problem ? "text-destructive-ink" : "text-foreground"}
      button={(profiled || entered) && <button
          type="button" onClick={onOpenProfile} disabled={!profiled}
          className={cn(
            // The route box's icon buttons' size, 32 square with an 18-point glyph, the
            // group's height; its 44-point area round it. A button of the
            // tinted glass every button is (GLASS_BUTTON), at the owner's
            // ask ("The profile button should also get the glass tinted. But
            // the altitude entry should stay as a text box"): the field's
            // end, where a line parted it from the figure before.
            INLINE_FIELD_BUTTON, "disabled:text-muted-foreground",
            GLASS_BUTTON,
            problem && "text-destructive-ink",
          )}
          aria-label={`Cruising altitude${rules === "ifr" ? " under IFR" : ""}, ${why}${!problem && tight ? ", tight" : ""}${!problem && cautions.length ? ", your altitude has a caution" : ""}: set it on the profile`}
          data-testid="altitude-why" data-tip="altitude"
        >
          {/* One amber dot on the glyph's top corner, inside the button as
              the Brief's is, at the owner's asks ("move the dot to the top
              corner of the profile button", "The dot is within the button
              for brief but not for profile"): a caution on the pilot's own
              altitude, else a tight one, which the Profile card says. Said in
              the button's name. The route from the side, the profile's own
              mark. */}
          <span className="relative">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 19h18" /><path d="M3 16l4-5 3 2 4-6 3 3 4-3" />
            </svg>
            {profiled && !problem && (cautions.length > 0 || tight) && (
              <span
                className="absolute -top-0.5 -right-1 size-2 rounded-full bg-caution" aria-hidden="true"
                data-testid={cautions.length > 0 ? "own-altitude-flag" : "tight-altitude-flag"}
              />
            )}
          </span>
        </button>}
    />
  );
}

/**
 * The Profile card's body, at the owner's pick (2026-10-20, option C of
 * the canvas): the route from the side (`chart`, MiniProfile), the graph
 * itself dragged up and down onto the legal altitudes as ForeFlight's
 * profile is (a glass wheel in the corner, then a ruler, before), and the
 * dry run's button in its top-right (`corner`); the drag put away while a
 * run plays (`wheelHidden`). Under the graph the ground against it, then the
 * altitude dragged to -- its plan's name, its time and fuel (the
 * planner's altitude_figures) -- whether it enters Class B, with the way
 * to avoid it, the flight rules, a route's problem, a pilot's own
 * altitude's cautions, and how the altitude was chosen, folded. The
 * altitude on the wheel is drawn on the graph at once (`chart`'s preview)
 * and flown once it rests a moment: its plan where it is one's, else as
 * the pilot's own.
 */
export function AltitudeProfile({ nav: navNow, legs: legsNow, ends, chart, corner, wheelHidden = false, problem, tight = null, classBAvoided = false, onAvoidClassB, onAllowClassB, onGoRound, onAltitudeChoiceChange, onFlyAltitude, rules = "vfr", onRulesChange }: {
  nav: NavLogAltitude | null;
  legs: Leg[];
  /** The route, for its Class B on the side view (routeProfileQuery). */
  ends: RouteEnds | null;
  /** The side view, its line at `preview` while the wheel is on another
   *  altitude than the one flown. */
  chart: (preview: number | null, scaleTop?: number) => ReactNode;
  /** Over the graph's top right: the dry run's button. */
  corner?: ReactNode;
  wheelHidden?: boolean;
  /** No legal altitude on the route: where, why and the ways on (RouteProblem). */
  problem?: ReactNode;
  tight?: string | null;
  /** Class B avoided at the pilot's word (the address's class_b=0), and
   *  the two ways: avoided by the planner's waypoint round it (null, by
   *  planning under or round it), and allowed again. */
  classBAvoided?: boolean;
  onAvoidClassB?: (detour: Detour | null) => void;
  onAllowClassB?: () => void;
  /** Puts in the way round the high ground the planner found, where the
   *  route is flown over it anyway (Detour.via). */
  onGoRound?: (via: string[], stopIndex: number) => void;
  /** Picks one of the four plans, which re-plans. */
  onAltitudeChoiceChange: (choice: AltitudeChoice) => void;
  /** Flies the whole route at an altitude of the pilot's own, feet. */
  onFlyAltitude: (feet: number) => void;
  rules?: FlightRules;
  onRulesChange?: (rules: FlightRules) => void;
}) {
  const route = ends ? [ends.departure.ident, ...(ends.stops ?? []).map(s => s.ident), ends.destination.ident].join(" ") : "";
  // The plan before a pick is planned anew, kept on the card till the new
  // one's altitude comes: the stream starts over, and the wheel and its
  // figures went blank for the second or two each pick took, as if they
  // were being worked out again (the owner's "planning altitudes take a
  // long time"). The wheel's own figures for the pick are the old plan's
  // already. Not over a route's problem, nor another route.
  const [held, setHeld] = useState<{ route: string; nav: NavLogAltitude; legs: Leg[] } | null>(null);
  if (navNow && (!held || held.nav !== navNow || held.legs !== legsNow || held.route !== route)) setHeld({ route, nav: navNow, legs: legsNow });
  const kept = !navNow && !problem && held?.route === route ? held : null;
  const nav = kept ? kept.nav : navNow;
  const legs = kept ? kept.legs : legsNow;
  // The altitude flown: a pilot's own as asked (typed, or picked on the
  // wheel and flown at each leg's nearest legal one, whose highest leg may
  // be another), else the plan's cruise.
  const cruise = nav?.flown === "custom" && nav.altitude_ft !== null ? nav.altitude_ft : cruiseOf(nav, legs);
  const figures = nav?.altitude_figures ?? [];
  // The legal altitudes, and one typed off their list as its own row
  // ("Yours"): the wheel showed the lowest legal one in its place, and the
  // heading and the graph's line with it, for an altitude not flown.
  const listed = figures.map(f => f.altitude_ft);
  const own = cruise !== null && listed.length > 0 && !listed.includes(cruise) ? cruise : null;
  const altitudes = (own === null ? listed : [...listed, own]).sort((a, b) => b - a);
  // The altitude on the wheel, the one flown when it was put there and the
  // route it was on: once another is flown (it, re-planned; a figure
  // typed) or the route changes, the wheel is at the one flown.
  const [picked, setPicked] = useState<{ altitude: number; against: number | null; route: string } | null>(null);
  // Flown once the finger lifts off the graph (a step of the keyboard's
  // at once), not at every altitude passed: each is a new plan. A quarter
  // second more, for steps one after another. Not once the card is put
  // away.
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const shownAt = picked && picked.against === cruise && picked.route === route ? picked.altitude
    : cruise !== null && altitudes.includes(cruise) ? cruise : altitudes.at(-1) ?? null;
  const pick = (altitude: number) => {
    graph.current?.style.setProperty("--roll-on", "0");
    setPicked({ altitude, against: cruise, route });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      // Nothing to plan only where the pick flies what is flown: the plan
      // flown at its own altitude, or the pilot's own altitude where no
      // plan cruises. A plan at the altitude the pilot typed is not the
      // typed altitude -- it steps where the route asks -- and picking it
      // did nothing when the two met (CI's winds: Fastest at 3,500 ft).
      const plan = planAt(nav, altitude);
      if (plan ? plan === nav?.flown : altitude === cruise) return;
      if (plan) onAltitudeChoiceChange(plan);
      else onFlyAltitude(altitude);
    }, 250);
  };
  const { data: profile } = useQuery({
    ...routeProfileQuery(ends?.departure.ident ?? "", ends?.destination.ident ?? "", (ends?.stops ?? []).map(s => s.ident)),
    enabled: !!ends,
  });
  const names = own === null ? planNames(nav) : { ...planNames(nav), [own]: "Yours" };
  // The ground against an altitude: its highest point along the route, the
  // room over it, and how far along the route first meets it.
  const check = (altitude: number) => {
    if (!profile || profile.terrain.length === 0) return null;
    const highest = Math.max(...profile.terrain.map(t => t.ground_ft));
    const strike = profile.terrain.find(t => t.ground_ft >= altitude);
    return { highest, clearance: altitude - highest, strikeNm: strike ? strike.along_nm : null };
  };
  // The graph's zoom once dragged, kept for its route: the chart drawn at
  // it when the finger lifts, so the scale does not jump back.
  const graph = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ top: number; route: string } | null>(null);
  const scaleTop = zoom?.route === route ? zoom.top : undefined;
  useEffect(() => { if (scaleTop === undefined) graph.current?.style.removeProperty("--scale-top"); }, [scaleTop]);
  const dragging = useRef<{ top: number; altitude: number } | null>(null);
  const plotOf = () => graph.current?.querySelector<HTMLElement>("[data-plot]") ?? null;
  const baseTop = () => Number(getComputedStyle(plotOf() ?? document.body).getPropertyValue("--base-top")) || 10_000;
  // Shown as the finger goes: the line, its words, the ground's tint and
  // the strip, by their CSS and text, nothing re-rendered.
  const live = (altitude: number, top: number) => {
    const el = graph.current;
    if (!el) return;
    el.style.setProperty("--scale-top", String(top));
    el.style.setProperty("--roll-ft", String(altitude));
    el.style.setProperty("--roll-on", "1");
    el.querySelector("[data-roll-label]")?.setAttribute("data-label", `${altFt(altitude)} ft`);
    const base = baseTop();
    const at = (ft: number) => String(Math.max(0, Math.min(1, 1 - ft / base)));
    for (const [tint, ft] of [["red", altitude], ["red-end", altitude], ["amber", altitude - 500], ["amber-end", altitude - 500]] as const) {
      el.querySelector(`[data-tint="${tint}"]`)?.setAttribute("offset", at(ft));
    }
    const ground = check(altitude);
    const strip = el.parentElement?.querySelector("[data-testid=ground-strip]");
    if (ground && strip) {
      strip.querySelector("[data-live=clearance]")!.textContent = clearanceWords(ground.clearance);
      strip.querySelector("[data-live=strike]")!.textContent = strikeWords(ground.strikeNm);
    }
    const slider = el.querySelector<HTMLElement>("[role=slider]");
    slider?.setAttribute("aria-valuenow", String(altitude));
    slider?.setAttribute("aria-valuetext", `${feet(altitude)} feet${names[altitude] ? `, ${names[altitude]}` : ""}`);
  };
  // The altitude at a point on the graph, the legal one nearest it; the
  // scale zoomed out past four fifths of the way up, in under a third, to
  // put it about two thirds up, in whole thousands.
  const zoomFor = (altitude: number, top: number) =>
    altitude > top * 0.8 || altitude < top * 0.3 ? Math.max(2000, Math.ceil((altitude * 1.5) / 1000) * 1000) : top;
  const altitudeAt = (clientY: number, top: number) => {
    const plot = plotOf()?.getBoundingClientRect();
    if (!plot) return null;
    const ft = (1 - (clientY - plot.top) / plot.height) * top;
    return altitudes.reduce((best, a) => (Math.abs(a - ft) < Math.abs(best - ft) ? a : best), altitudes[0]!);
  };
  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (shownAt === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { top: scaleTop ?? baseTop(), altitude: shownAt };
    move(event);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    if (!d) return;
    const altitude = altitudeAt(event.clientY, d.top);
    if (altitude === null) return;
    const top = zoomFor(altitude, d.top);
    if (altitude === d.altitude && top === d.top) return;
    dragging.current = { top, altitude };
    live(altitude, top);
  };
  const letGo = () => {
    const d = dragging.current;
    dragging.current = null;
    if (!d) return;
    setZoom({ top: d.top, route });
    if (d.altitude !== shownAt) pick(d.altitude);
    else graph.current?.style.setProperty("--roll-on", "0");
  };
  const stepKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!by || shownAt === null) return;
    event.preventDefault();
    const i = Math.max(0, Math.min(altitudes.length - 1, altitudes.indexOf(shownAt) + by));
    pick(altitudes[i]!);
  };
  const figure = figures.find(f => f.altitude_ft === shownAt) ?? null;
  const bravo = profile && shownAt !== null
    ? profile.airspace.find(a => a.class === "B" && a.floor_ft <= shownAt && (a.ceiling_ft ?? 10_000) >= shownAt) ?? null : null;
  const detours = nav?.class_b_detours ?? [];
  const cautions = nav?.cautions ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-3" data-testid="altitude-profile">
      {/* No taller than the card's room over FPL's figures, half way up on
          a phone: the graph and its ruler in sight whole, what is under
          them a scroll away -- down to 64 points, where the route's name
          and its line take two lines each at the owner's larger text. */}
      {/* The legal altitudes a narrow ruler down its left side, over the
          graph, at the owner's asks ("make the wheel to be a ruler on the
          left side? Narrow and elegant"; "put the ruler over the graph but
          just make it narrow so it's not taking much space"). */}
      <div ref={graph} className="relative h-56 max-h-full min-h-16 shrink-0">
        {chart(shownAt !== null && shownAt !== cruise ? shownAt : null, scaleTop)}
        {/* The graph is the control, as ForeFlight's profile is (the owner's
            recording, "yes" to building it): a drag up or down on it moves
            a dashed line and its altitude across the ground, the ground
            tinted against it, the scale zooming to keep it in sight, onto
            the legal altitudes alone -- moved by their CSS as the finger
            goes, nothing drawn again ("notice how smooth theirs is"), the
            plan asked once it lifts. To VoiceOver and the keyboard a
            slider, up and down a legal altitude at a time. Its drags its
            own, not the sheet's (touch-action none). */}
        {!wheelHidden && shownAt !== null && altitudes.length > 0 && (
          <div
            role="slider" tabIndex={0} aria-label="Cruise altitude" aria-orientation="vertical"
            aria-valuemin={altitudes.at(-1)} aria-valuemax={altitudes[0]} aria-valuenow={shownAt}
            aria-valuetext={`${feet(shownAt)} feet${names[shownAt] ? `, ${names[shownAt]}` : ""}`}
            onPointerDown={grab} onPointerMove={move} onPointerUp={letGo} onPointerCancel={letGo} onKeyDown={stepKey}
            className="absolute inset-0 cursor-ns-resize touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="altitude-wheel"
          />
        )}
        {corner}
      </div>
      {/* What the ground says of the altitude on the graph, as ForeFlight's
          strip under its profile does: the highest ground along the route,
          the room over it, and where the route first meets ground at or
          over the altitude; live as the graph is dragged (data-live). The
          planner's ground samples along the route's line (vfr.profile),
          not a corridor round it, and no obstacles: the planner's legal
          altitudes keep the 14 CFR 91.119 and 91.177 margins over those. */}
      {shownAt !== null && check(shownAt) && (
        <div className={cn("grid grid-cols-3 gap-2 tabular-nums", TEXT.note)} data-testid="ground-strip">
          <div><div className="text-muted-foreground">Highest ground</div><div className="font-semibold" data-live="highest">{feet(check(shownAt)!.highest)} ft</div></div>
          <div><div className="text-muted-foreground">Clearance</div><div className="font-semibold" data-live="clearance">{clearanceWords(check(shownAt)!.clearance)}</div></div>
          <div><div className="text-muted-foreground">First strike</div><div className="font-semibold" data-live="strike">{strikeWords(check(shownAt)!.strikeNm)}</div></div>
        </div>
      )}
      {shownAt !== null && altitudes.length > 0 && (
        <div className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className={cn("font-bold tabular-nums", TEXT.heading)} data-testid="altitude-picked">{flightLevel(shownAt)}</span>
              {names[shownAt] && <span className={cn("truncate font-semibold text-muted-foreground", TEXT.detail)}>{names[shownAt]}</span>}
            </div>
            <span className={cn("shrink-0 tabular-nums", TEXT.detail)} data-testid="altitude-figures">
              {figure?.ete_min != null ? hhmm(figure.ete_min) : "—"} · {figure?.fuel_gal != null ? `${one(figure.fuel_gal)} gal` : "—"}
              {figure?.tailwind_kt != null && ` · ${figure.tailwind_kt >= 0 ? "+" : "−"}${Math.abs(Math.round(figure.tailwind_kt))} kt`}
            </span>
          </div>
          {figure && !figure.everywhere && (
            <p className={cn("text-muted-foreground", TEXT.note)}>Some legs at their nearest legal altitude</p>
          )}
        </div>
      )}
      {problem}
      {/* Class B: entered at the altitude on the wheel, with the clearance
          it takes (14 CFR 91.131), and the way round it; or avoided. */}
      {classBAvoided ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-card py-1.5 pr-1.5 pl-3" data-testid="class-b-avoided">
          <span className={TEXT.detail}>Avoiding Class B</span>
          {onAllowClassB && <Button type="button" size="sm" variant="ghost" className="text-tint" onClick={onAllowClassB}>Allow Class B</Button>}
        </div>
      ) : bravo && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-card py-1.5 pr-1.5 pl-3" data-testid="class-b-accepted">
          <span className={TEXT.detail}>Through {faaWords(bravo.name)}: clearance needed</span>
          {onAvoidClassB && (
            <Button type="button" size="sm" variant="secondary" className="shrink-0 text-tint" onClick={() => onAvoidClassB(detours.find(d => !d.via?.length) ?? null)} data-testid="avoid-class-b">
              Avoid Class B
            </Button>
          )}
        </div>
      )}
      {/* The planner's four plans, one picked from a menu: the ruler's rows
          named them, and the graph's drag lands on an altitude. */}
      {nav && nav.options.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <span className={cn("font-semibold", TEXT.row)}>Plan</span>
          <Select value={PREFERRED.includes(nav.flown as AltitudeChoice) ? nav.flown! : ""} onValueChange={v => onAltitudeChoiceChange(v as AltitudeChoice)}>
            <SelectTrigger className="w-48" data-testid="altitude-plan" aria-label="Altitude plan"><SelectValue placeholder="Your altitude" /></SelectTrigger>
            <SelectContent>
              {[...nav.options].filter(o => o.steps.length).sort((a, b) => PREFERRED.indexOf(a.kind) - PREFERRED.indexOf(b.kind)).map(o => (
                <SelectItem key={o.kind} value={o.kind} data-testid="altitude-plan-option">
                  {o.kind[0]!.toUpperCase() + o.kind.slice(1)} · {feet(Math.max(...o.steps.map(st => st.altitude_ft)))} ft
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {onRulesChange && (
        <div className="flex items-center justify-between gap-3">
          <span className={cn("font-semibold", TEXT.row)}>Flight rules</span>
          <Segmented label="Flight rules" value={rules} onChange={v => onRulesChange(v as FlightRules)} options={RULES} testId="flight-rules" />
        </div>
      )}
      {cautions.length > 0 && (
        <div className={cn("space-y-1.5 rounded-lg bg-caution-wash p-2.5 text-caution-ink", TEXT.detail)} data-testid="own-altitude-cautions">
          {cautions.map(c => (
            <div key={`${c.from_ident}-${c.to_ident}`}>
              <p className="font-semibold">{feet(c.altitude_ft)} ft {c.from_ident} → {c.to_ident}</p>
              <ul className="list-disc pl-4">{c.reasons.map(r => <li key={r}>{r}</li>)}</ul>
            </div>
          ))}
          {/* Flown over the high ground anyway, at the owner's "no hard
              limits": the way round it the planner found, for the pilot
              to take or not. */}
          {onGoRound && detours.filter(d => d.via?.length).map(d => (
            <div key={d.via!.join(" ")} className="flex items-center justify-between gap-2 pt-1">
              <span>By {d.via!.join(", ")} · +{Math.round(d.added_nm)} nm</span>
              <Button type="button" size="sm" variant="secondary" className="shrink-0 text-tint" onClick={() => onGoRound(d.via!, d.stop_index)} data-testid="caution-go-round">
                Go Round
              </Button>
            </div>
          ))}
        </div>
      )}
      {tight && (
        <p className={cn("rounded-lg bg-caution-wash p-2.5 text-caution-ink", TEXT.detail)} data-testid="tight-altitude">
          <span className="font-semibold">Tight altitude. </span>{tight}
        </p>
      )}
      {nav && (
        // The stock Collapsible, as the weather's raw reports fold, where a
        // native details element drew the browser's own triangle.
        <Collapsible>
          <CollapsibleTrigger className={cn("group relative flex w-full items-center gap-1.5 py-2 text-left outline-none after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", GROUP_HEADING)}>
            <ChevronRight className="size-4 text-tint transition-transform group-data-[state=open]:rotate-90" aria-hidden />
            How the altitude was chosen
          </CollapsibleTrigger>
          {/* Kept in the page folded, as the <details> it replaced kept it:
              the reasoning is found by the page's own search and read by
              its text while closed, which the specs and a find-in-page do. */}
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <AltitudeReasoning nav={nav} legs={legs} plansAbove />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
