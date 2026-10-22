import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import { PANEL_FIELD_FILL } from "../../../../components/panelField";
import Segmented from "../../../../components/Segmented";
import { faaWords } from "../../../../lib/advisories";
import type { AltitudeChoice, Detour, Leg, NavLogAltitude } from "../../../../lib/api/types";
import type { FlightRules } from "../../../../lib/preferences";
import { routeProfileQuery } from "../../../../lib/queryClient";
import { GROUP_HEADING, TEXT } from "../../../../lib/text";
import { flightLevel, one } from "../../../../lib/units";
import { hhmm } from "../../format";
import AltitudeReasoning from "../AltitudeReasoning";
import type { RouteEnds } from "./rows";
import AltitudeWheel from "./AltitudeWheel";

const RULES = [{ value: "vfr", label: "VFR" }, { value: "ifr", label: "IFR" }];
const feet = (ft: number) => ft.toLocaleString("en-US");
/** An altitude as said: feet under 18,000 ft, a flight level from there
 *  up, where altimeters are set to 29.92 (14 CFR 91.121, AIM 7-2-2). */
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
    <div
      role="group" aria-label="Cruise altitude"
      // A field as the route box is, at the owner's ask ("make the altitude
      // input similar to route box style where profile button only shows
      // with an altitude there"): its fill and its type, not a chip of
      // glass; with no route its placeholder alone, as the box's.
      // 32 tall in the route box, as the airplane's button beside it (FlightInputs).
      // One width whatever is in it, at the owner's ask ("Don't reduce the
      // width when a new altitude is entered because a profile button will
      // take the place"): the wider of the example and three figures with
      // the profile button after them, each measured unseen in the one
      // cell, and the field taking what the button does not.
      className={cn("grid h-8 items-center rounded-full", PANEL_FIELD_FILL, TEXT.row)}
      data-testid="altitude-group"
    >
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 flex h-0 overflow-hidden">
        <span className="whitespace-pre pr-3.5 pl-3 font-semibold tabular-nums">000</span>
        <span className="w-px" />
        <span className="w-8 shrink-0" />
      </span>
      {/* Two points over the field's own padding, for the caret. */}
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-pre pr-3.5 pl-3 font-normal">
        {PLACEHOLDER}
      </span>
      <div className="col-start-1 row-start-1 flex h-full min-w-0 items-center">
        {/* Six points after the figure, the label's, as "ft" stood there:
            the profile button's area reaches four into the gap, and with
            less the two areas met over each other (the iOS audit's P1). Its
            44-point area a pseudo-element round it, nothing grown. */}
        <label className="relative flex h-full min-w-0 flex-1 items-center pr-1.5 after:absolute after:-inset-y-1.5 after:-left-0.5 after:right-0 after:content-['']">
          <input
            type="text" inputMode="numeric" enterKeyHint="done" autoComplete="off" size={1}
            value={shown} placeholder={PLACEHOLDER} aria-label="Cruise altitude, hundreds of feet"
            onChange={e => setTyped(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); fly(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTyped(null); }}
            onBlur={fly}
            className={cn(
              "relative z-10 h-full w-0 min-w-0 flex-1 bg-transparent pr-1.5 pl-3 font-semibold tabular-nums outline-none placeholder:font-normal",
              problem ? "text-red-700 dark:text-red-300" : "text-foreground",
            )}
            data-testid="altitude-input"
          />
        </label>
        {/* The profile's button once there is an altitude in the field, at the
            owner's ask ("when altitude is entered ... a profile button shows
            up"), or why there is none to show. The flight rules are the Profile card's switch alone, at the
            owner's ask ("no need to mention IFR or VFR"); VoiceOver hears them
            in the button's name still. */}
        {(profiled || entered) && <span aria-hidden="true" className="h-4 w-px bg-border" />}
        {(profiled || entered) && <button
          type="button" onClick={onOpenProfile} disabled={!profiled}
          className={cn(
            // The route box's icon buttons' size, 32 square with an 18-point glyph, the
            // group's height; its 44-point area round it.
            "relative flex size-8 shrink-0 items-center justify-center rounded-full text-tint outline-none after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground",
            problem && "text-red-700 dark:text-red-300",
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
            <svg viewBox="0 0 24 24" className="size-[1.125rem]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 19h18" /><path d="M3 16l4-5 3 2 4-6 3 3 4-3" />
            </svg>
            {profiled && !problem && (cautions.length > 0 || tight) && (
              <span
                className="absolute -top-0.5 -right-1 size-2 rounded-full bg-amber-500" aria-hidden="true"
                data-testid={cautions.length > 0 ? "own-altitude-flag" : "tight-altitude-flag"}
              />
            )}
          </span>
        </button>}
      </div>
    </div>
  );
}

/**
 * The Profile card's body, at the owner's pick (2026-10-20, option C of
 * the canvas): the route from the side (`chart`, MiniProfile) with a ruler
 * of the legal altitudes down its left side, over it (AltitudeWheel, a
 * glass wheel in the corner before), and the dry run's button in its top-right
 * (`corner`); the ruler put away while a run plays (`wheelHidden`). Under the graph the
 * altitude on the wheel -- its plan's name, its time and fuel (the
 * planner's altitude_figures) -- whether it enters Class B, with the way
 * to avoid it, the flight rules, a route's problem, a pilot's own
 * altitude's cautions, and how the altitude was chosen, folded. The
 * altitude on the wheel is drawn on the graph at once (`chart`'s preview)
 * and flown once it rests a moment: its plan where it is one's, else as
 * the pilot's own.
 */
export function AltitudeProfile({ nav: navNow, legs: legsNow, ends, chart, corner, wheelHidden = false, problem, tight = null, classBAvoided = false, onAvoidClassB, onAllowClassB, onAltitudeChoiceChange, onFlyAltitude, rules = "vfr", onRulesChange }: {
  nav: NavLogAltitude | null;
  legs: Leg[];
  /** The route, for its Class B on the side view (routeProfileQuery). */
  ends: RouteEnds | null;
  /** The side view, its line at `preview` while the wheel is on another
   *  altitude than the one flown. */
  chart: (preview: number | null) => ReactNode;
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
  // Flown once the ruler has come to rest on it a moment (it hands on its
  // tick only at rest, AltitudeWheel), not at every tick passed: each is
  // a new plan. A quarter second more, for taps one after another. Not
  // once the card is put away.
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const shownAt = picked && picked.against === cruise && picked.route === route ? picked.altitude
    : cruise !== null && altitudes.includes(cruise) ? cruise : altitudes.at(-1) ?? null;
  const pick = (altitude: number) => {
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
      <div className="relative h-56 max-h-full min-h-16 shrink-0">
        {chart(shownAt !== null && shownAt !== cruise ? shownAt : null)}
        {!wheelHidden && shownAt !== null && altitudes.length > 0 && (
          <div className="absolute inset-y-0 left-0">
            <AltitudeWheel altitudes={altitudes} value={shownAt} onChange={pick} names={names} />
          </div>
        )}
        {corner}
      </div>
      {shownAt !== null && altitudes.length > 0 && (
        <div className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className={cn("font-bold tabular-nums", TEXT.heading)} data-testid="altitude-picked">{flightLevel(shownAt)}</span>
              {names[shownAt] && <span className={cn("truncate font-semibold text-tint", TEXT.detail)}>{names[shownAt]}</span>}
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
            <Button type="button" size="sm" variant="secondary" className="shrink-0 text-tint" onClick={() => onAvoidClassB(detours[0] ?? null)} data-testid="avoid-class-b">
              Avoid Class B
            </Button>
          )}
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
