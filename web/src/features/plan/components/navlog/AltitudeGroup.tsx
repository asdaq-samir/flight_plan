import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../../../components/ui/button";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../../components/ResponsivePopover";
import { CHIP_TEXT, GLASS_BUTTON } from "../../../../components/mapChrome";
import Segmented from "../../../../components/Segmented";
import type { AltitudeChoice, Detour, Leg, NavLogAltitude, RouteProfile } from "../../../../lib/api/types";
import { DESCENT_FT_PER_NM } from "../../../../lib/geo";
import type { FlightRules } from "../../../../lib/preferences";
import { routeProfileQuery } from "../../../../lib/queryClient";
import { GROUP_HEADING, TEXT } from "../../../../lib/text";
import { one } from "../../../../lib/units";
import { hhmm } from "../../format";
import AltitudeReasoning from "../AltitudeReasoning";
import { AIRSPACE } from "./profile";
import type { RouteEnds } from "./rows";
import AltitudeWheel from "./AltitudeWheel";

const RULES = [{ value: "vfr", label: "VFR" }, { value: "ifr", label: "IFR" }];
const feet = (ft: number) => ft.toLocaleString("en-US");
/** An altitude as said: feet under 18,000 ft, a flight level from there
 *  up, where altimeters are set to 29.92 (14 CFR 91.121, AIM 7-2-2). */
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
 *  "Fastest · Economical" where two fly the same. */
function planNames(nav: NavLogAltitude | null): Record<number, string> {
  const names: Record<number, string[]> = {};
  for (const o of nav?.options ?? []) {
    if (!o.steps.length) continue;
    const top = Math.max(...o.steps.map(s => s.altitude_ft));
    (names[top] ??= []).push(o.kind[0]!.toUpperCase() + o.kind.slice(1));
  }
  return Object.fromEntries(Object.entries(names).map(([ft, kinds]) => [ft, kinds.join(" · ")]));
}

/** A plan that cruises at `altitude`, the one flown first: what picking
 *  that altitude on the wheel flies, its steps and all. */
function planAt(nav: NavLogAltitude | null, altitude: number): AltitudeChoice | null {
  const at = (nav?.options ?? []).filter(o => o.steps.length && Math.max(...o.steps.map(s => s.altitude_ft)) === altitude);
  return (at.find(o => o.kind === nav?.flown) ?? at[0])?.kind ?? null;
}

/**
 * The cruising altitude beside the airplane, as the owner picked it
 * (2026-10-20, the redesign's input 1): the figure itself, typed in feet,
 * and the profile's button after it, which opens the altitude on the
 * route's side view with a wheel of the legal altitudes (AltitudeSheet).
 * A figure typed is flown on Enter, or as the field is left. Marked as
 * the chip was: red with no legal altitude, IFR's flag, a tight altitude
 * and a pilot's own altitude's caution.
 */
export default function AltitudeGroup({ nav, legs, ends, problem, ownAltitude = true, tight = null, classBAvoided = false, onAvoidClassB, onAllowClassB, onAltitudeChoiceChange, onFlyAltitude, disabled = false, rules = "vfr", onRulesChange }: {
  nav: NavLogAltitude | null;
  legs: Leg[];
  /** The route, for its side view (routeProfileQuery). */
  ends: RouteEnds | null;
  /** No legal altitude on the route: where, why and the ways on
   *  (RouteProblem), each of which puts the sheet away (`close`). */
  problem?: (close: () => void) => ReactNode;
  /** An altitude of the pilot's own is offered: not under a Class B to
   *  the ground, where there is none. */
  ownAltitude?: boolean;
  /** A leg where no 500 ft step fits (vfr.altitude's tight altitude). */
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
  disabled?: boolean;
  /** The flight rules it is planned under, which re-plans: IFR's minimum
   *  altitudes and thousands (14 CFR 91.177, 91.179), or VFR's. */
  rules?: FlightRules;
  onRulesChange?: (rules: FlightRules) => void;
}) {
  const [open, setOpen] = useState(false);
  const cruise = cruiseOf(nav, legs);
  const cautions = nav?.cautions ?? [];
  // What is typed, while it is: the figure flown otherwise.
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (problem || cruise === null ? "" : feet(cruise));
  const top = rules === "ifr" ? 41_000 : 17_999;
  const fly = () => {
    if (typed === null) return;
    const ft = Number(typed.replace(/\D/g, ""));
    setTyped(null);
    // A VFR altitude is under Class A (14 CFR 71.33, 91.135); IFR's up to
    // FL410, the highest 91.179(b)(4) names.
    if (ft >= 500 && ft <= top && ft !== cruise) onFlyAltitude(ft);
  };
  const why = problem ? "no legal altitude" : cruise !== null ? said(cruise)
    : nav?.flown === null ? "no altitude: no winds" : "not yet planned";
  return (
    <div
      role="group" aria-label="Cruise altitude"
      className={cn("flex h-8 items-center overflow-hidden rounded-full", GLASS_BUTTON, CHIP_TEXT, disabled && "opacity-50")}
      data-testid="altitude-group"
    >
      <input
        type="text" inputMode="numeric" enterKeyHint="done" disabled={disabled || !ownAltitude}
        value={shown} placeholder="—" aria-label="Cruise altitude, feet"
        onChange={e => setTyped(e.target.value.replace(/[^\d,]/g, "").slice(0, 6))}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); fly(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTyped(null); }}
        onBlur={fly}
        className={cn(
          "h-full w-[4.5ch] min-w-0 bg-transparent pl-2.5 text-right font-semibold tabular-nums outline-none",
          problem ? "text-red-700 dark:text-red-300" : "text-foreground",
        )}
        data-testid="altitude-input"
      />
      <span className="pr-1.5 pl-1 text-muted-foreground">ft</span>
      {rules === "ifr" && <span className="pr-1 text-[0.6875rem] font-semibold text-tint" data-testid="ifr-flag">IFR</span>}
      {!problem && tight && <span className="mr-1 size-1.5 rounded-full bg-amber-500" aria-hidden="true" data-testid="tight-altitude-flag" />}
      {!problem && cautions.length > 0 && (
        <TriangleAlert className="mr-1 size-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" data-testid="own-altitude-flag" />
      )}
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <ResponsivePopover open={open} onOpenChange={setOpen}>
        <ResponsivePopoverTrigger asChild>
          <button
            type="button" disabled={disabled}
            className={cn(
              "relative flex h-full items-center px-2 text-tint outline-none after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring",
              problem && "text-red-700 dark:text-red-300",
            )}
            aria-label={`Cruising altitude${rules === "ifr" ? " under IFR" : ""}, ${why}${!problem && tight ? ", tight" : ""}${!problem && cautions.length ? ", your altitude has a caution" : ""}: set it on the profile`}
            data-testid="altitude-why" data-tip="altitude"
          >
            {/* The route from the side, the profile's own mark. */}
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 19h18" /><path d="M3 16l4-5 3 2 4-6 3 3 4-3" />
            </svg>
          </button>
        </ResponsivePopoverTrigger>
        <ResponsivePopoverContent title={problem ? "No legal altitude" : "Altitude"} align="start" className="w-[22rem]">
          {open && (
            <AltitudeSheet
              nav={nav} legs={legs} ends={ends} cruise={cruise} problem={problem && problem(() => setOpen(false))}
              tight={tight} classBAvoided={classBAvoided} onAvoidClassB={onAvoidClassB && (d => { setOpen(false); onAvoidClassB(d); })}
              onAllowClassB={onAllowClassB && (() => { setOpen(false); onAllowClassB(); })}
              rules={rules} onRulesChange={onRulesChange}
              onPick={altitude => {
                const plan = planAt(nav, altitude);
                if (plan) onAltitudeChoiceChange(plan);
                else onFlyAltitude(altitude);
              }}
            />
          )}
        </ResponsivePopoverContent>
      </ResponsivePopover>
    </div>
  );
}

/**
 * The altitude on the route's side view, as the owner picked it: the
 * flight rules first, then the wheel of the legal altitudes beside the
 * route from the side, its line at the altitude on the wheel; under them
 * that altitude's time, fuel and wind (the planner's altitude_figures),
 * whether it enters Class B, with the way to avoid it, and how the
 * altitude was chosen. The altitude on the wheel is flown as it comes to
 * rest a moment (`onPick`): its plan where it is one's, else as the
 * pilot's own.
 */
function AltitudeSheet({ nav, legs, ends, cruise, problem, tight, classBAvoided, onAvoidClassB, onAllowClassB, rules, onRulesChange, onPick }: {
  nav: NavLogAltitude | null;
  legs: Leg[];
  ends: RouteEnds | null;
  cruise: number | null;
  problem?: ReactNode;
  tight: string | null;
  classBAvoided: boolean;
  onAvoidClassB?: (detour: Detour | null) => void;
  onAllowClassB?: () => void;
  rules: FlightRules;
  onRulesChange?: (rules: FlightRules) => void;
  onPick: (altitude: number) => void;
}) {
  const figures = nav?.altitude_figures ?? [];
  const altitudes = figures.map(f => f.altitude_ft).sort((a, b) => b - a);
  const [picked, setPicked] = useState<number | null>(cruise !== null && altitudes.includes(cruise) ? cruise : altitudes.at(-1) ?? null);
  // Flown once the wheel has come to rest on it a moment, not at every row
  // passed: each is a new plan.
  const flown = useRef(picked);
  const timer = useRef<number | null>(null);
  const pick = (altitude: number) => {
    setPicked(altitude);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (altitude !== flown.current) { flown.current = altitude; onPick(altitude); }
    }, 700);
  };
  const { data: profile } = useQuery({
    ...routeProfileQuery(ends?.departure.ident ?? "", ends?.destination.ident ?? "", (ends?.stops ?? []).map(s => s.ident)),
    enabled: !!ends,
  });
  const names = planNames(nav);
  const figure = figures.find(f => f.altitude_ft === picked) ?? null;
  const bravo = profile && picked !== null
    ? profile.airspace.find(a => a.class === "B" && a.floor_ft <= picked && (a.ceiling_ft ?? 10_000) >= picked) ?? null : null;
  const detours = nav?.class_b_detours ?? [];
  const cautions = nav?.cautions ?? [];
  return (
    <div className="space-y-3" data-testid="altitude-sheet">
      {onRulesChange && (
        <div className="flex items-center justify-between gap-3">
          <span className={cn("font-semibold", TEXT.row)}>Flight rules</span>
          <Segmented label="Flight rules" value={rules} onChange={v => onRulesChange(v as FlightRules)} options={RULES} testId="flight-rules" />
        </div>
      )}
      {problem}
      {picked !== null && altitudes.length > 0 && (
        <>
          <div className="flex gap-2 rounded-xl bg-card p-1">
            <AltitudeWheel altitudes={altitudes} value={picked} onChange={pick} names={names} />
            <SideView profile={profile ?? null} legs={legs} ends={ends} altitude={picked} highest={altitudes[0]!} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className={cn("font-bold tabular-nums", TEXT.heading)} data-testid="altitude-picked">{feet(picked)} ft</span>
            {names[picked] && <span className={cn("font-semibold text-tint", TEXT.detail)}>{names[picked]}</span>}
          </div>
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-card px-3 py-2.5" data-testid="altitude-figures">
            <Figure name="ETE" value={figure?.ete_min != null ? hhmm(figure.ete_min) : "—"} />
            <Figure name="Fuel" value={figure?.fuel_gal != null ? `${one(figure.fuel_gal)} gal` : "—"} />
            <Figure name="Wind" value={figure?.tailwind_kt != null ? `${figure.tailwind_kt >= 0 ? "+" : "−"}${Math.abs(Math.round(figure.tailwind_kt))} kt` : "—"} />
          </dl>
          {figure && !figure.everywhere && (
            <p className={cn("text-muted-foreground", TEXT.detail)}>Some legs at their nearest legal altitude</p>
          )}
        </>
      )}
      {/* Class B: entered at the altitude picked, with the clearance it
          takes (14 CFR 91.131), and the way round it; or avoided. */}
      {classBAvoided ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-card py-1.5 pr-1.5 pl-3" data-testid="class-b-avoided">
          <span className={TEXT.detail}>Avoiding Class B</span>
          {onAllowClassB && <Button type="button" size="sm" variant="ghost" className="text-tint" onClick={onAllowClassB}>Allow Class B</Button>}
        </div>
      ) : bravo && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-card py-1.5 pr-1.5 pl-3" data-testid="class-b-accepted">
          <span className={TEXT.detail}>Through {titleCaseName(bravo.name)}: clearance needed</span>
          {onAvoidClassB && (
            <Button type="button" size="sm" variant="secondary" className="shrink-0 text-tint" onClick={() => onAvoidClassB(detours[0] ?? null)} data-testid="avoid-class-b">
              Avoid Class B
            </Button>
          )}
        </div>
      )}
      {cautions.length > 0 && (
        <div className={cn("space-y-1.5 rounded-lg bg-amber-500/12 p-2.5 text-amber-800 dark:text-amber-300", TEXT.detail)} data-testid="own-altitude-cautions">
          {cautions.map(c => (
            <div key={`${c.from_ident}-${c.to_ident}`}>
              <p className="font-semibold">{feet(c.altitude_ft)} ft {c.from_ident} → {c.to_ident}</p>
              <ul className="list-disc pl-4">{c.reasons.map(r => <li key={r}>{r}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {tight && (
        <p className={cn("rounded-lg bg-amber-500/12 p-2.5 text-amber-800 dark:text-amber-300", TEXT.detail)} data-testid="tight-altitude">
          <span className="font-semibold">Tight altitude. </span>{tight}
        </p>
      )}
      {nav && (
        <details>
          <summary className={cn("cursor-pointer py-2", GROUP_HEADING)}>How the altitude was chosen</summary>
          <AltitudeReasoning nav={nav} legs={legs} plansAbove />
        </details>
      )}
    </div>
  );
}

function Figure({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className={cn("text-muted-foreground", TEXT.note)}>{name}</dt>
      <dd className={cn("font-semibold tabular-nums", TEXT.row)}>{value}</dd>
    </div>
  );
}

/** "CHICAGO CLASS B" as said: "Chicago Class B". */
function titleCaseName(name: string): string {
  return name.split(" ").map(w => (w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");
}

/**
 * The route from the side, as small as the wheel is tall: the ground
 * under it (vfr.profile's), each Class B over it in the chart's blue, and
 * the line flown at the wheel's altitude -- up from the field to it and
 * down at three to one (DESCENT_FT_PER_NM) to the destination. Drawn
 * stretched to its box, its words beside it in the page's own type.
 */
function SideView({ profile, legs, ends, altitude, highest }: {
  profile: RouteProfile | null;
  legs: Leg[];
  ends: RouteEnds | null;
  altitude: number;
  highest: number;
}) {
  const length = profile?.length_nm ?? legs.reduce((n, leg) => n + leg.distance_nm, 0);
  if (!length) return <div className="min-h-0 flex-1" />;
  const ground = profile?.terrain ?? [];
  const top = Math.max(highest, 10_000, ...ground.map(g => g.ground_ft)) + 1000;
  const x = (nm: number) => (nm / length) * 100;
  const y = (ft: number) => 100 - (ft / top) * 100;
  const from = ends?.departure.elevation_ft ?? ground[0]?.ground_ft ?? 0;
  const to = ends?.destination.elevation_ft ?? ground.at(-1)?.ground_ft ?? 0;
  // The climb as the plan climbs, to its top of climb, scaled to the
  // altitude on the wheel; ten miles where the legs do not say.
  const toc = legs[0]?.toc;
  const climbNm = toc && legs[0]!.altitude_ft > from
    ? toc.along_nm * Math.max(0, altitude - from) / (legs[0]!.altitude_ft - from) : 10;
  const descentNm = Math.max(0, altitude - to) / DESCENT_FT_PER_NM;
  const line = [[0, from], [Math.min(climbNm, length / 2), altitude], [Math.max(length - descentNm, length / 2), altitude], [length, to]]
    .map(([nm, ft]) => `${x(nm!)},${y(ft!)}`).join(" ");
  const groundLine = ground.length ? `0,100 ${ground.map(g => `${x(g.along_nm)},${y(g.ground_ft)}`).join(" ")} 100,100` : "";
  return (
    <div className="relative min-h-0 flex-1" data-testid="altitude-side-view">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        {profile?.airspace.filter(a => a.class === "B").map(a => (
          <rect
            key={`${a.name}-${a.from_nm}-${a.floor_ft}`} x={x(a.from_nm)} width={Math.max(0.5, x(a.to_nm) - x(a.from_nm))}
            y={y(a.ceiling_ft ?? 10_000)} height={y(a.floor_ft) - y(a.ceiling_ft ?? 10_000)}
            fill={AIRSPACE.B!.stroke} fillOpacity={0.12} stroke={AIRSPACE.B!.stroke} strokeWidth={1} vectorEffect="non-scaling-stroke"
          />
        ))}
        {groundLine && <polygon points={groundLine} className="fill-[#D8CFC0] dark:fill-[#5b5246]" />}
        <polyline points={line} fill="none" className="stroke-tint" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={cn("absolute bottom-0.5 left-1 text-muted-foreground", TEXT.note)}>{ends?.departure.ident}</span>
      <span className={cn("absolute right-1 bottom-0.5 text-muted-foreground", TEXT.note)}>{ends?.destination.ident}</span>
    </div>
  );
}
