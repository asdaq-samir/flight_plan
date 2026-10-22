import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { create } from "zustand";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Fuel, PlaneLanding, PlaneTakeoff, Wind } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import BackButton from "../../../components/BackButton";
import CloseButton from "../../../components/CloseButton";
import { Button } from "../../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import { api } from "../../../lib/api/client";
import { useMinuteClock, zuluTime } from "../../../lib/clock";
import type { AircraftProfile, ProcedureDrawing, ProcedureList, ProcedureSummary, Runway } from "../../../lib/api/types";
import { distanceNm } from "../../../lib/geo";
import { runwayNumber, windPick, type RunwayEnd, type WindPick } from "../../../lib/pattern";
import { airportQuery, plateQuery } from "../../../lib/queryClient";
import { approachRunway, sameField, transitionWords, type BranchFix, type PickedProcedure } from "../../../lib/procedures";
import { trafficPattern } from "../../../lib/trafficPattern";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";
import { endFit, type EndFit } from "../../../lib/runwayFit";
import { frdOf, isPosition } from "../../../lib/identSchema";
import { COURSE_MAGENTA } from "../../../lib/map/chartColors";
import { useOwnShip } from "../../../lib/map/ownShip";
import { etaAt, reportedWind, type ReportedWind } from "../format";
import { PointMark } from "./navlog/PointMark";
import FixBranch from "./FixBranch";
import DepartPicker from "./navlog/DepartPicker";
import ProcedureMenu from "./ProcedureMenu";
import type { EditedPoint, PointAltitude } from "./PointAltitudeDialog";
import { PointFigures, PointMenu } from "./PointControls";
import FuelStopRow, { FuelGauge, FuelStopsAdd } from "./FuelStopRow";
import { useFuelStops } from "../hooks/useFuelStops";
import type { HoldAt } from "./HoldSheet";
import { holdWords, type Hold } from "../../../lib/holds";
import type { FuelStopSuggestion, LegHold } from "../../../lib/api/types";
import { groundMinAt, legOf, rowPoint, type NavLogRow } from "./navlog/rows";

// Opened only from a point's menu, so fetched as one first is: in the
// first load they took it over its 1.10 MB budget (CI, 2026-10-20).
const FixFromDialog = lazy(() => import("./FixFromDialog"));
const PointAltitudeDialog = lazy(() => import("./PointAltitudeDialog"));
const HoldSheet = lazy(() => import("./HoldSheet"));

/** The value of a choice's "None" (no transition), and a runway line's
 *  with none picked yet: a toggle's value is a string. */
const NONE = "none";
/** No altitudes of the pilot's own at any fix: one object, kept. */
const NO_CROSSINGS: Record<string, number> = {};

export type ProcedureKind = ProcedureSummary["kind"];
type Kind = ProcedureKind;

const KIND_TITLE: Record<Kind, string> = { approach: "Approaches", arrival: "Arrivals", departure: "Departures" };
/** A kind as a branch's head says it, under the procedure's name. */
const KIND_WORD: Record<Kind, string> = { approach: "Approach", arrival: "Arrival", departure: "Departure" };
/** The FAA's chart codes in a field's d-TPP for each kind (its card's
 *  terminal charts, vfr.publications, as the d-TPP metafile's chart_code
 *  has them): an instrument approach procedure, a STAR ("STR"), a
 *  departure procedure (a SID or a graphic obstacle departure) or a
 *  textual one. */
const CHART_CODES: Record<Kind, string[]> = { approach: ["IAP"], arrival: ["STR"], departure: ["DP", "ODP"] };

/** A procedure's data stays good for its cycle's 28 days. */
const PROCEDURE_STALE_MS = 6 * 60 * 60_000;
/** How far off a field's time must be for its runway to be picked into
 *  the forecast wind rather than the wind now, ms: an hour. */
const FORECAST_AFTER_MS = 60 * 60_000;
const TEN_MIN_MS = 10 * 60_000;

export interface ProcedureAirport {
  ident: string;
  role: "Departure" | "Stop" | "Destination";
  runways: Runway[] | null;
  patternAltitudeFt: number | null;
  /** The field's elevation, for its runways' distances (runwayFit). */
  elevationFt: number | null;
}

/** What a runway's fit is worked from (lib/runwayFit): the airplane's
 *  POH figures and its takeoff and landing weights (useLoad). */
export interface FitInputs {
  aircraft: AircraftProfile;
  takeoffLb: number | null;
  landingLb: number | null;
}

/** Where the procedures' sheet is open: one kind of a field's. */
export type ProceduresAt = { ident: string; kind: Kind } | null;

// No runway picked into the wind, one set for good (a new one at every
// render would be a new intoWind for the effect).
const NO_AUTO: ReadonlySet<string> = new Set();

/**
 * The route in FPL, in the order it is flown, at the owner's ask ("I
 * want to replace navlog with procedures", 2026-10-18), the nav log a
 * button away (NavLogView's sheet): each field of the route a step down a
 * line, holding what is flown there in turn -- a departure's pattern and
 * then its departure, a destination's arrival and approach and then its
 * pattern, a stop's all of them -- and between them the fixes flown
 * through, each with the nav log's own mark (PointMark) and the time it
 * is reached. The checkpoints are the nav log's alone ("Only stops in the
 * route box and separate navlog"), and since the owner's cleanup ("no
 * need to have the toc and tod") the tops of climb and descent too; a
 * field shows only the kinds of procedure it has, and its approach chart
 * is the approach's page's (ProcedurePage's Chart).
 *
 * A pattern is picked by its runway, as a chip, the runway the wind
 * favours marked (the redesign's A); it is drawn on the map
 * (PatternLayer). An instrument procedure from the FAA's CIFP
 * (vfr.procedures) is picked in a sheet of its own, as ForeFlight's
 * Procedure Advisor picks one: the field's of that kind, then the one
 * procedure, its transition chosen, the map above the sheet drawing it
 * as it is chosen (`onPreview`, ProcedureLayer), its fixes listed, and
 * Add to Route at the foot. Back is the round button at the sheet's
 * head, the close's twin, at the owner's ask.
 */
export default function ProceduresRoute({
  airports, rows, depart, weather, picked, onPick, onPreselect, takeoffs, onTakeoff, onPreselectTakeoff, autoPicked = NO_AUTO, fit = null, onCharts, chartsDisabled, procedures, inRoute, onProcedures, onPreview, at, onAt,
  crossings = NO_CROSSINGS, onFix, onDepart, ground, onGround, pointAltitude, onPointAltitude, directTo = null, onDirectTo, onInfo, onRemove,
  onCreateFix, holds = NO_HOLDS, onHoldSet, askHold = null, routePoints, stopsFull = false, fuelStops = NO_FUEL_STOPS, onKeepFuelStops,
  fuel = null,
}: {
  airports: ProcedureAirport[];
  /** The route's rows as the nav log has them (navLogRows), for its
   *  fields' times and the points between them; empty until the course
   *  is in, the fields then listed alone. */
  rows: NavLogRow[];
  /** The departure time picked, ISO; empty for now. */
  depart: string;
  /** An airport's weather colour, as its chip on the map. */
  weather: (ident: string) => string | undefined;
  /** The runway end picked for each field's pattern. */
  picked: Map<string, string>;
  onPick: (ident: string, end: string | null) => void;
  /** The runway into the wind picked for the pilot as the route comes in:
   *  into the address with no move of the map, which stays on the route. */
  onPreselect: (ident: string, end: string) => void;
  /** The runway each stop is left from, which may not be the one landed
   *  on ("KMSN:36", the `takeoff` address), and its pick. */
  takeoffs: Map<string, string>;
  onTakeoff: (ident: string, end: string | null) => void;
  /** A stop's runway to leave from picked for the pilot into the wind. */
  onPreselectTakeoff: (ident: string, end: string) => void;
  /** The runways picked into the wind and not since by the pilot
   *  ("land:KABQ", "takeoff:KEVU"): each follows the wind as it changes. */
  autoPicked?: ReadonlySet<string>;
  /** The airplane's figures and weights its runways' fit is worked from;
   *  none, no fit marked. */
  fit?: FitInputs | null;
  /** The destination's approach charts, in its card. */
  onCharts: () => void;
  chartsDisabled: boolean;
  /** The instrument procedures picked (lib/procedures). */
  procedures: PickedProcedure[];
  /** Those drawn, by field and kind, as the route's box names them, an
   *  approach's with the runway it lands on (approachRunway). */
  inRoute: { ident: string; kind: Kind; id: string; runway: string | null; label: string; fixes?: BranchFix[]; direct?: string | null }[];
  /** All of them as they are to be, and the one just picked, for the map
   *  to go to. */
  onProcedures: (next: PickedProcedure[], picked: PickedProcedure | null) => void;
  /** The procedure on its page, not yet added, for the map to draw and go
   *  to; null as the page is left. */
  onPreview: (procedure: PickedProcedure | null) => void;
  /** The sheet's kind and field, null while it is put away. */
  at: ProceduresAt;
  onAt: (at: ProceduresAt) => void;
  /** Minutes on the ground at each stop, by ident (the address's
   *  `ground`), and the pick of one, from the time it leaves: a stop not
   *  named, the planner's turnaround (groundMinAt). */
  ground?: Record<string, number>;
  onGround?: (ident: string, minutes: number) => void;
  /** The pilot's own altitudes to cross the procedures' fixes at, by fix. */
  crossings?: Record<string, number>;
  /** A fix of a procedure picked, tapped on its branch: its card (FixCard). */
  onFix?: (field: string, kind: Kind, fix: string) => void;
  /** The departure's time picked on its step (DepartPicker). */
  onDepart?: (iso: string) => void;
  /** The altitude at a point of the route, as the route box's menu offers
   *  it (PlanWorkspace's altitudeAt), and the pilot's own set there or
   *  (null) given back to the plan. */
  pointAltitude?: (ident: string, waypoint: boolean) => PointAltitude;
  onPointAltitude?: (ident: string, feet: number | null) => void;
  /** The point flown direct to (the address's `direct`), and Direct to
   *  one, or (null) the route flown as it was. */
  directTo?: string | null;
  onDirectTo?: (ident: string | null) => void;
  /** A point's card (an airport's, a waypoint's), from its menu. */
  onInfo?: (ident: string) => void;
  /** A stop taken out of the route, from its menu. */
  onRemove?: (ident: string) => void;
  /** The pilot's own point off one of the route's, flown over after it
   *  (FixFromDialog): "VPBNG/090/30". */
  onCreateFix?: (after: string, ident: string) => void;
  /** The pilot's holds (lib/holds), each its own row after its point, and
   *  one set, changed or (null) taken off (HoldSheet). */
  holds?: Hold[];
  onHoldSet?: (fix: string, hold: Hold | null) => void;
  /** A hold asked for at a point just put in the route ("VPBNG/095/14.2@"
   *  and when, AirspaceCard's Hold here): its sheet opened once the plan
   *  has the leg to the point, for the course flown to it. */
  askHold?: string | null;
  /** The route's points as the address has them, the departure first:
   *  a row not among them -- a fix along an airway typed as V100 -- has no
   *  Direct to, Remove or Create a fix, which work on the typed points
   *  (the audit's finding: they did nothing there, or the wrong thing). */
  routePoints?: string[];
  /** As many stops as the planner takes (MAX_STOPS): no Create a fix. */
  stopsFull?: boolean;
  /** Where each flight too long for its tanks could land for fuel (the
   *  totals' fuel_stops), rows after its departure, and the stops kept:
   *  put in the route after the flight's departure, in order. */
  fuelStops?: FuelStopSuggestion[];
  onKeepFuelStops?: (after: string, idents: string[]) => void;
  /** The tanks, for the fuel in them at each point: their usable fuel, the
   *  start, taxi and takeoff allowance and the reserve the flight is held
   *  to (the totals' fuel check); none known, no fuel shown. */
  fuel?: { usableGal: number; taxiGal: number; reserveGal: number } | null;
}) {
  // The procedure on its own page in the sheet, over its kind's list.
  const [page, setPage] = useState<{ at: ProceduresAt; procedure: ProcedureSummary } | null>(null);
  // What the sheet shows, kept as it eases away: its title went back to
  // "Procedures" and its page to nothing as it was put away.
  const [kept, setKept] = useState<ProceduresAt>(at);
  if (at && at !== kept) setKept(at);
  const on = at ?? kept;
  const procedure = page && page.at === on ? page.procedure : null;
  // The point whose altitude is being set (PointAltitudeDialog).
  const [editing, setEditing] = useState<EditedPoint | null>(null);
  // The point a fix is being made off (FixFromDialog).
  const [fixFrom, setFixFrom] = useState<string | null>(null);
  // The point a hold is being set at (HoldSheet).
  const [holdAt, setHoldAt] = useState<HoldAt | null>(null);
  // Each drawn from its first opening on, so it closes as a sheet does.
  const [editingUsed, setEditingUsed] = useState(false);
  const [fixFromUsed, setFixFromUsed] = useState(false);
  const [holdUsed, setHoldUsed] = useState(false);
  if (editing !== null && !editingUsed) setEditingUsed(true);
  if (fixFrom !== null && !fixFromUsed) setFixFromUsed(true);
  if (holdAt !== null && !holdUsed) setHoldUsed(true);
  const holdOn = (ident: string) => holds.find(h => sameField(h.fix, ident)) ?? null;
  // Where the airplane is known (own ship, or the dry run's): Direct to
  // goes from there.
  const positioned = useOwnShip(s => s.enabled && !!s.fix);
  const [answered, setAnswered] = useState<string | null>(null);
  if (askHold && askHold !== answered && onHoldSet) {
    const fix = askHold.slice(0, askHold.lastIndexOf("@"));
    const to = rows.find(r => "airport" in r && sameField(r.airport.ident, fix));
    const leg = to ? legOf(to) : undefined;
    if (leg) {
      setAnswered(askHold);
      setHoldAt({
        fix, hold: holdOn(fix), altitudeFt: leg.altitude_ft,
        arrivalDeg: (((leg.true_course_deg - leg.magnetic_variation_deg) % 360) + 360) % 360,
      });
    }
  }
  // What the planner made of each hold (plan.with_holds), on the leg it is
  // flown on: its entry, minutes and fuel.
  const heldAs = (ident: string) => rows.map(r => (r.kind === "departure" ? undefined : r.leg?.hold)).find(h => h && sameField(h.fix, ident)) ?? null;
  // Each field's procedures, asked for as its kind's sheet opens -- not
  // with the route: the FAA's file is 53 MB, fetched on its first ask --
  // and said in the list from then on.
  // Asked for as a field's menu opens too (ProcedureMenu).
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  const ask = (ident: string) => { if (!asked.has(ident)) setAsked(new Set([...asked, ident])); };
  const lists = useQueries({
    queries: airports.map(a => ({
      queryKey: ["procedures", a.ident],
      queryFn: () => api.procedures(a.ident),
      staleTime: PROCEDURE_STALE_MS,
      enabled: at?.ident === a.ident || asked.has(a.ident),
    })),
  });
  // Each field's card (its weather), for the wind a field with no report
  // of its own goes by: the nearest report's (windPick).
  const cards = useQueries({ queries: airports.map(a => airportQuery(a.ident)) });
  // When the airplane is at each field: the departure's time, a field
  // landed at its arrival (the rows' times). More than an hour off, its
  // runway is picked into the wind its TAF forecasts for then, not the
  // wind now, at the owner's pick (2026-10-20); to the ten minutes, so a
  // plan streaming in asks again only as its times move that much.
  const now = useMinuteClock();
  const startMs = depart ? Date.parse(depart) : now;
  // Each stop's minutes flown to it, kept while the plan is made again:
  // its time to leave picked (DepartPicker), the stop's time on the ground
  // changes, the nav log is asked for again and its legs stream back in --
  // the picker taken out meanwhile closed under the pilot's finger.
  const landsFresh = rows.flatMap(r => (r.kind === "stop" && r.minutesFlown != null ? [`${r.airport.ident}:${r.minutesFlown}`] : [])).join(",");
  const [landed, setLanded] = useState<{ fresh: string; at: Record<string, number> }>({ fresh: "", at: {} });
  if (landsFresh && landsFresh !== landed.fresh) {
    setLanded({
      fresh: landsFresh,
      at: { ...landed.at, ...Object.fromEntries(landsFresh.split(",").map(pair => [pair.slice(0, pair.lastIndexOf(":")), Number(pair.slice(pair.lastIndexOf(":") + 1))])) },
    });
  }
  const landedAt = (ident: string): number | null => {
    const key = Object.keys(landed.at).find(k => sameField(k, ident));
    return key === undefined ? null : landed.at[key]!;
  };
  const forecastFor = airports.map(a => {
    const row = a.role === "Departure" ? null
      : rows.find(r => (r.kind === "stop" || r.kind === "destination") && sameField(r.airport.ident, a.ident));
    const ms = a.role === "Departure" ? startMs : row?.minutesFlown == null ? null : startMs + row.minutesFlown * 60_000;
    return ms !== null && ms - now > FORECAST_AFTER_MS ? Math.round(ms / TEN_MIN_MS) * TEN_MIN_MS : null;
  });
  const forecasts = useQueries({
    queries: airports.map((a, i) => ({
      queryKey: ["forecastWind", a.ident, forecastFor[i]],
      queryFn: () => api.forecastWind(a.ident, new Date(forecastFor[i]!).toISOString()),
      enabled: forecastFor[i] != null, staleTime: TEN_MIN_MS, meta: { silent: true },
    })),
  });
  // Each field's approach in the route, and whether its plate publishes
  // circling minimums -- the one plate the map draws (PlateLayer).
  const approachesIn = inRoute.filter(p => p.kind === "approach");
  const plates = useQueries({ queries: approachesIn.map(p => plateQuery(p.ident, p.id)) });
  const landingOf = (ident: string): Landing | null => {
    const i = approachesIn.findIndex(p => sameField(p.ident, ident));
    return i < 0 ? null : { runway: approachesIn[i]!.runway, circling: plates[i]?.data?.circling, name: approachesIn[i]!.label };
  };
  const windOf = (ident: string): WindPick | null => {
    const i = airports.findIndex(a => a.ident === ident);
    const runways = airports[i]?.runways;
    if (!runways) return null;
    const forecast = forecastFor[i] != null ? forecasts[i]?.data : null;
    if (forecast) {
      return windPick(runways, {
        station: forecast.ident, distanceNm: forecast.distance_nm,
        dirTrueDeg: forecast.dir_true_deg, speedKt: forecast.speed_kt, gustKt: forecast.gust_kt,
      }, forecastFor[i]! / 1000);
    }
    const card = cards[i]?.data;
    const near = card && !card.metar ? card.nearby_metar : null;
    // The field's own report as well, for what the planner's runway winds
    // cannot say: a variable wind (VRB) has no runway into it there, and
    // was left with none picked (KDLH's VRB04KT, the owner's screenshot).
    const own = card?.metar;
    return windPick(runways, near ? {
      station: near.ident, distanceNm: near.distance_nm,
      dirTrueDeg: near.metar.wind_dir_true_deg, speedKt: near.metar.wind_speed_kt, gustKt: near.metar.wind_gust_kt,
    } : own ? {
      station: ident, distanceNm: 0, dirTrueDeg: own.wind_dir_true_deg, speedKt: own.wind_speed_kt, gustKt: own.wind_gust_kt,
    } : null);
  };
  // The wind a field reports, else the nearest report's, as the METAR
  // gives it: from true north (FAA Order JO 7900.5), marked "T" beside the
  // runways' magnetic numbers, where a tower's and an ATIS's winds are
  // magnetic (AIM 4-1-13) -- the audit's finding.
  const reportedOf = (ident: string): Reported | null => {
    const i = airports.findIndex(a => a.ident === ident);
    // The forecast's, where the runway is picked into it (windOf).
    const forecast = forecastFor[i] != null ? forecasts[i]?.data : null;
    if (forecast) {
      const said = reportedWind(forecast.dir_true_deg, forecast.speed_kt, forecast.gust_kt);
      return said && said !== "calm" ? { ...said, spoken: `forecast for ${zuluTime(new Date(forecastFor[i]!))}, ${said.spoken}` } : said;
    }
    const card = cards[i]?.data;
    const m = card?.metar ?? card?.nearby_metar?.metar;
    return m ? reportedWind(m.wind_dir_true_deg, m.wind_speed_kt, m.wind_gust_kt) : null;
  };
  const listOf = (ident: string): ProcedureList | undefined => lists[airports.findIndex(a => a.ident === ident)]?.data;
  // Whether a field has procedures of a kind: by its procedures once they
  // are in (its kind's sheet opened), else by the FAA's charts its card
  // lists (d-TPP), which come with the route -- the CIFP's 53 MB is not
  // fetched for that. Not yet known, not offered: no room taken for a
  // kind a field does not have (the owner's cleanup).
  const hasKind = (ident: string, kind: Kind): boolean => {
    const i = airports.findIndex(a => a.ident === ident);
    // Either says so: the list coming in as a menu opens takes no menu
    // away from under the finger where the CIFP has none the FAA charts.
    return !!lists[i]?.data?.procedures.some(p => p.kind === kind)
      || (cards[i]?.data?.procedures.some(c => CHART_CODES[kind].includes(c.kind)) ?? false);
  };
  const kindOf = (p: PickedProcedure) => listOf(p.ident)?.procedures.find(q => q.id === p.id)?.kind;
  const pickOf = (ident: string, kind: Kind) => procedures.find(p => sameField(p.ident, ident) && kindOf(p) === kind) ?? null;
  // One of a kind at a field: a new pick there takes the old one's place.
  const pick = (ident: string, kind: Kind, next: { id: string; transition: string | null; direct?: string | null } | null) => {
    const kept = procedures.filter(p => !(sameField(p.ident, ident) && kindOf(p) === kind));
    const made = next ? { ident, ...next } : null;
    onProcedures(made ? [...kept, made] : kept, made);
    // An approach picked lands on its own runway: the field's runway chip
    // goes to it, kept in step with the approach (at the owner's ask);
    // another only by circling (PatternChips).
    const name = next && kind === "approach" ? listOf(ident)?.procedures.find(q => q.id === next.id)?.name : undefined;
    const runway = name ? approachRunway(name) : null;
    if (runway) onPick(ident, runway);
  };
  const close = () => onAt(null);
  // The runway picked at a field, and a stop's to leave from.
  const chosenAt = (ident: string) => picked.get(ident) ?? null;
  const takeoffAt = (ident: string) => takeoffs.get(ident) ?? null;
  // Each field of the route, its runway picked into the wind until the
  // pilot picks one or none, at the owner's ask ("a preselected runway into
  // the wind", "Departing runway should also be pre selected"): most fly
  // the runway ATC gives them with no approach, so no approach is picked.
  // Once a field, so a runway picked and taken back is not picked again
  // under the pilot's finger.
  const preselected = useRef(new Set<string>());
  const toggled = useToggledFields(st => st.toggled);
  const [openAtFirst] = useState(fieldsOpenAtFirst);
  const isOpen = (key: string) => openAtFirst !== toggled.includes(key);
  const isFuelStop = useFuelStops();
  // The runway lines opened from their fold (PatternChips), for what sits
  // beside a folded one.
  const openLines = useOpenRunwayLines(st => st.open);
  // A field listed twice (a round trip) picks its landing's runway once.
  const preselectedLand = (a: ProcedureAirport) => airports.findIndex(b => sameField(b.ident, a.ident)) !== airports.indexOf(a);
  const intoWind = airports.flatMap((a, i) => {
    // A forecast still coming is waited for, not picked past on the wind now.
    if (forecastFor[i] != null && forecasts[i]?.isPending) return [];
    const wind = windOf(a.ident);
    // Calm, the runway in use or the longest (windPick), as the owner asked.
    if (!wind || !wind.ident) return [];
    // One picked into the wind before, and not by the pilot since, goes to
    // the runway the wind now favours (`autoPicked`).
    const free = (which: string, now: string | undefined) => now === undefined || (autoPicked.has(`${which}:${a.ident}`) && now !== wind.ident);
    return [
      ...(!free("land", picked.get(a.ident)) || landingOf(a.ident) || preselectedLand(a) ? [] : [`land:${a.ident}:${wind.ident}`]),
      // A stop's runway to leave from, into the wind as its landing's.
      ...((a.role !== "Stop" && !(a.role === "Departure" && airports.some(b => b !== a && b.role === "Destination" && sameField(b.ident, a.ident))))
        || !free("takeoff", takeoffs.get(a.ident)) ? [] : [`takeoff:${a.ident}:${wind.ident}`]),
    ];
  }).join(",");
  useEffect(() => {
    for (const pick of intoWind ? intoWind.split(",") : []) {
      const [which, ident, end] = pick.split(":") as [string, string, string];
      // Once a field, and once more each time the wind turns a runway
      // picked into it: never again where the pilot took one back.
      const once = autoPicked.has(`${which}:${ident}`) ? `${which}:${ident}:${end}` : `${which}:${ident}`;
      if (preselected.current.has(once)) continue;
      preselected.current.add(once);
      if (which === "land") onPreselect(ident, end); else onPreselectTakeoff(ident, end);
    }
  }, [intoWind, autoPicked, onPreselect, onPreselectTakeoff]);
  const destination = airports.find(a => a.role === "Destination");
  // How far along the route each row is, nm: what its line under its name
  // says, as mock A of the owner's rows has it ("Stop · 241 nm").
  const alongNm = new Map<string, number>();
  rows.reduce((nm, r) => {
    const at = nm + (legOf(r)?.distance_nm ?? 0);
    alongNm.set(r.key, at);
    return at;
  }, 0);
  const along = (row: NavLogRow | undefined) => {
    const nm = row ? alongNm.get(row.key) : undefined;
    return nm ? ` · ${Math.round(nm)} nm` : "";
  };
  // The end of a point's row, at the owner's picks ("keep the format of
  // altitude (elev/published/cruising) and eta to the right side of each
  // depart/arrive and waypoints"; "Each stop can have a menu (set altitude,
  // create a fix, hold here, More Info)"; "the menu can include direct
  // to"): its time over its altitude -- the pilot's own (the address's
  // `altitudes`), else a waypoint's cruise to it, a field's elevation --
  // and its menu. `to`, a point flown to: Direct to it and its altitude
  // set there; `stop`, one the route's points can lose.
  const pointEnd = (ident: string, at: { time: ReactNode; waypoint: boolean; elevationFt: number | null; to: boolean; stop: boolean; holdable?: boolean; row?: NavLogRow }) => {
    const altitude = at.to ? pointAltitude?.(ident, at.waypoint) : undefined;
    const own = altitude?.own ? altitude.feet : null;
    const shown = own ?? (at.waypoint ? altitude?.feet ?? null : at.elevationFt);
    const direct = directTo !== null && sameField(directTo, ident);
    const typed = !routePoints || routePoints.some(p => sameField(p, ident));
    // Direct to a round trip's end on the ground, with no position, is from
    // the field to itself: a local flight, not a direct (the audit's).
    const homeward = !!routePoints && routePoints.length > 1 && sameField(routePoints[0]!, ident) && !positioned;
    const kind = own !== null ? "set" : at.waypoint ? "cruise" : "elev";
    return {
      direct,
      figures: <PointFigures time={at.time} altitude={shown === null ? null : altFt(shown)} kind={kind} />,
      // The two apart, for an airport's block: the time on its ident's
      // line, the elevation on its wind's.
      time: <PointFigures time={at.time} altitude={null} kind={kind} />,
      elevation: <PointFigures time={null} altitude={shown === null ? null : altFt(shown)} kind={kind} testId="point-elevation" />,
      menu: (
        <PointMenu
          ident={ident} direct={direct}
          onDirect={at.to && typed && !homeward && onDirectTo ? () => onDirectTo(direct ? null : ident) : undefined}
          onAltitude={at.to && altitude && onPointAltitude ? () => setEditing({ ident, waypoint: at.waypoint, altitude, elevationFt: at.elevationFt }) : undefined}
          // An airport's card; a waypoint's is the chart's popup.
          onInfo={onInfo && !at.waypoint ? () => onInfo(ident) : undefined}
          // Off a fix, a navaid or an airport by its ident: not off the
          // pilot's own point, nor a present position.
          onFix={onCreateFix && typed && !stopsFull && /^[A-Z0-9]{2,5}$/.test(ident) ? () => setFixFrom(ident) : undefined}
          // Held over a point flown over, or before landing at the end:
          // not over a field landed at on the way, where it is left again.
          held={!!holdOn(ident)}
          onHold={at.holdable && onHoldSet ? () => {
            const leg = at.row ? legOf(at.row) : undefined;
            setHoldAt({
              fix: ident, hold: holdOn(ident), altitudeFt: leg?.altitude_ft ?? null,
              // Magnetic = true - variation, east positive (the leg's own).
              arrivalDeg: leg ? (((leg.true_course_deg - leg.magnetic_variation_deg) % 360) + 360) % 360 : null,
            });
          } : undefined}
          onRemove={at.stop && typed && onRemove ? () => onRemove(ident) : undefined}
        />
      ),
    };
  };

  // A field's step: what is flown there, in the order it is flown.
  const fieldStep = (a: ProcedureAirport, row: NavLogRow | undefined, last: boolean) => {
    // A kind's pull-down: the one in the route said on it (ProcedureMenu).
    const wind = windOf(a.ident);
    const i = airports.findIndex(f => f.ident === a.ident);
    const kindMenu = (kind: Kind, look: "button" | "add") => (
      <ProcedureMenu
        key={kind} ident={a.ident} kind={kind} list={lists[i]?.data} loading={!!lists[i]?.isFetching} look={look}
        picked={pickOf(a.ident, kind)} label={inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind)?.label ?? null}
        fixes={inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind)?.fixes?.map(f => f.ident)}
        runway={chosenAt(a.ident)} windward={wind && !wind.calm ? wind.ident : null}
        onOpen={() => ask(a.ident)} onPick={next => pick(a.ident, kind, next)} onAll={() => onAt({ ident: a.ident, kind })}
      />
    );
    const has = (kind: Kind) => hasKind(a.ident, kind) || inRoute.some(p => sameField(p.ident, a.ident) && p.kind === kind);
    const time = row ? etaAt(depart || new Date().toISOString(), row.minutesFlown) : null;
    const mark = row ? <PointMark row={row} number={undefined} weather={weather} /> : <FieldDot last={last} />;
    // A step of the field's, at the owner's pick (option C of the
    // procedures canvas): its name and time in its head, its runway chips
    // under with its info at their start ("Info can go on the left side of
    // the runways"), and after them its procedures -- each picked one the
    // head of a branch of its fixes, in the order they are flown
    // (FixBranch), its pull-down its name; each kind not picked a dashed
    // "+ Arrival" to pick one.
    const branch = (kind: Kind) => {
      const inPlace = inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind);
      // By its id, not its kind: the field's list, which says each pick's
      // kind, is asked for only as a pull-down opens.
      const chosen = inPlace && procedures.find(p => sameField(p.ident, a.ident) && p.id === inPlace.id);
      if (!inPlace || !chosen) return null;
      return (
        <FixBranch
          key={`branch-${kind}`} name={inPlace.label} kind={KIND_WORD[kind]} menu={kindMenu(kind, "button")}
          fixes={inPlace.fixes ?? []} direct={inPlace.direct ?? null} crossings={crossings}
          onDirect={fix => onProcedures(procedures.map(p => (p === chosen ? { ...p, direct: fix } : p)), null)}
          onOpen={fix => onFix?.(a.ident, kind, fix)}
        />
      );
    };
    // One block an airport, at the owner's pick (2026-10-21, boards 4 and 5
    // of the canvas: "the airport id on top and then departure and arrival
    // that can collapse", "no need to use the word depart, fuel stop,
    // arrive"): its ident, a fuel stop's pump before it and the fuel in the
    // tanks after it, the arrow that opens it, its time over its elevation
    // and its menu; its wind under. Opened, a line each for its landing
    // and its takeoff -- the glyph, the runways, the procedures, a stop's
    // time to leave again -- named for a screen reader as its parts are.
    const key = `${a.role}:${a.ident}`;
    const opened = isOpen(key);
    // `line`, the runway line's key and the runway picked on it
    // (PatternChips folds a line with a runway picked to that runway's chip).
    type Part = { role: "Arrive" | "Depart"; kinds: Kind[]; chips: (trailing: ReactNode) => ReactNode; leaves: ReactNode; line: { key: string; chosen: string | null } };
    const partBody = (part: Part) => {
      const picked = part.kinds.filter(k => inRoute.some(p => sameField(p.ident, a.ident) && p.kind === k));
      const unpicked = part.kinds.filter(k => !picked.includes(k));
      const Glyph = part.role === "Arrive" ? PlaneLanding : PlaneTakeoff;
      // The pull-downs for the procedures not yet picked beside the runway's
      // chip while its line is folded to it, at the owner's ask ("Can
      // arrival and approach pills be next to the runway when runway is
      // collapsed?", "Same with departure"); under it while the line is
      // open, its runways across the row.
      const foldable = part.line.chosen !== null && a.runways !== null;
      const lineOpen = openLines.includes(part.line.key);
      const adds = unpicked.map(k => kindMenu(k, "add"));
      return (
        <div className="space-y-3 pt-3">
          <div className="flex items-center gap-2">
            <Glyph className="size-5 shrink-0 text-muted-foreground" aria-label={part.role === "Arrive" ? "landing" : "takeoff"} role="img" />
            {/* The runway line's arrow by the landing's or the takeoff's glyph,
                at the owner's ask ("the arrow next to runway can be next to
                the depart/arrive symbol"): to the right while it is folded
                to the runway picked, to open it; to the left while it is
                open, to fold it. A disclosure, a small arrow in its own 44
                points -- over the glyph, the arrow at their right -- the
                line's chips right after them ("too much space between arrow
                and runways"). */}
            {foldable && (
              <button
                type="button" data-disclosure="" data-testid="runway-line-toggle" aria-expanded={lineOpen}
                aria-label={lineOpen ? `${a.ident}: fold the runways` : `${a.ident}: all the runways`}
                onClick={() => useOpenRunwayLines.setState(st => ({ open: lineOpen ? st.open.filter(k => k !== part.line.key) : [...st.open, part.line.key] }))}
                className="relative -my-1.5 -mr-2 -ml-6 flex size-11 shrink-0 items-center justify-end rounded-full pr-1.5 text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {lineOpen ? <ChevronLeft className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
              </button>
            )}
            {/* The pull-downs on the runways' own line, beside the runway
                picked while it is folded and sliding with the runways while
                it is open (the owner's "Approach doesn't need to go next
                line just let it slide with runways"). */}
            <div className="min-w-0 flex-1">{part.chips(adds.length > 0 ? adds : null)}</div>
            {part.leaves && <span className="shrink-0">{part.leaves}</span>}
          </div>
          {picked.map(branch)}
        </div>
      );
    };
    const block = (parts: Part[], headTime: ReactNode) => {
      const first = parts[0]!;
      const end = pointEnd(a.ident, {
        time: headTime, waypoint: false, elevationFt: a.elevationFt, to: a.role !== "Departure", stop: a.role === "Stop",
        holdable: a.role === "Destination", row,
      });
      const reported = reportedOf(a.ident);
      // Without the "T" after its direction, at the owner's ask ("No need
      // to put T next to wind"): a METAR's and a TAF's winds are true (FAA
      // Order JO 7900.5), as VoiceOver still says them (`spoken`).
      const wind = reported === "calm" ? "Calm" : reported ? `${reported.dir.replace(/T$/, "")} ${reported.speed} kt` : null;
      const tank = row ? tanks.get(row.key) : a.role === "Departure" ? tanks.get("departure") : undefined;
      return (
        <li key={key} className="relative" data-testid="route-field" data-ident={a.ident}>
          {!last && <span aria-hidden="true" className="absolute top-3 bottom-0 left-[calc(0.875rem-1px)] w-0.5 bg-border" />}
          <section aria-label={`${a.ident} · ${first.role}`} className={cn(!(opened && parts[1]) && "pb-5")}>
            {/* The airport's lines: a tap anywhere on them -- its symbol, its
                ident, its fuel, its wind, its time -- opens it, at the
                owner's ask ("it should expand when tapped anywhere on the
                airport information next to the symbol or the symbol
                itself"): the arrow by the symbol is the button, its area
                stretched over the lines (after:inset-0); the menu and a
                time to pick lie over it, their own. */}
            <div className="relative flex gap-2.5">
              {/* A fuel stop's pump on top of its symbol, at the owner's ask
                  ("instead of fuel symbol next to airport id, can we put it
                  on top of the airport symbol?"). */}
              <div className="flex w-7 shrink-0 justify-center pt-1">
                <span className="relative">
                  {mark}
                  {a.role === "Stop" && isFuelStop(a.ident) && (
                    <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-caution text-white ring-2 ring-background">
                      <Fuel className="size-2.5" strokeWidth={2.6} aria-label="fuel stop" role="img" />
                    </span>
                  )}
                </span>
              </div>
              {/* Two lines, as a waypoint's row and the list before had them,
                  at the owner's ask ("line up the time with airport id and
                  elevation with wind like before"): the ident and the time,
                  then the wind and the elevation; the menu beside both. */}
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
                  {/* The disclosure, iOS's small chevron by the symbol, not
                      an icon button (data-disclosure). */}
                  <button
                    type="button" onClick={() => toggleField(key)} aria-expanded={opened} data-testid="field-toggle" data-ident={a.ident} data-disclosure=""
                    aria-label={`${a.ident}: runways and procedures`}
                    className="-ml-1 grid size-4 shrink-0 place-items-center text-tint outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRight className={cn("size-4 transition-transform", opened && "rotate-90")} aria-hidden />
                  </button>
                  {/* The size the list's names were ("the font size is bigger
                      than it used to be for airport id"). */}
                  <h3 className={cn("truncate font-semibold", TEXT.row)}>{a.ident}</h3>
                  {tank && <FuelGauge gal={tank.gal} usable={tank.usable} tone={tank.low ? "low" : a.role === "Stop" && isFuelStop(a.ident) ? "fuel" : undefined} />}
                </div>
                <div className="relative z-10 col-start-2 row-start-1 justify-self-end">{end.time}</div>
                <div className="relative z-10 col-start-3 row-span-2 row-start-1 self-center">{end.menu}</div>
                <p className={cn("col-start-1 row-start-2 flex min-w-0 items-center gap-1 font-semibold text-tint tabular-nums", TEXT.note)} data-testid="field-wind">
                  {end.direct ? "Direct to" : wind && (
                    <>
                      <Wind className="size-3.5 shrink-0" aria-hidden />
                      <span aria-hidden="true">{wind}</span>
                      <span className="sr-only">{`Wind ${reported === "calm" ? "calm" : reported ? reported.spoken : ""}`}</span>
                    </>
                  )}
                </p>
                <div className="col-start-2 row-start-2 justify-self-end">{end.elevation}</div>
              </div>
            </div>
            {opened && <div className="pl-[2.375rem]">{partBody(first)}</div>}
          </section>
          {opened && parts[1] && <section aria-label={`${a.ident} · ${parts[1].role}`} className="pb-5 pl-[2.375rem]">{partBody(parts[1])}</section>}
        </li>
      );
    };
    // Each runway end's fit today (lib/runwayFit): its crosswind against the
    // airplane's demonstrated, and its length against the distance needed,
    // marked on its chip and said in the field's info, at the owner's ask.
    const card = cards[i]?.data;
    const reportedWind = card?.metar ?? card?.nearby_metar?.metar ?? null;
    const fitOf = (kind: "takeoff" | "landing") => (runway: Runway, end: RunwayEnd) => (fit ? endFit({
      aircraft: fit.aircraft, runway, end, kind,
      wind: reportedWind && { dirTrueDeg: reportedWind.wind_dir_true_deg, speedKt: reportedWind.wind_speed_kt, gustKt: reportedWind.wind_gust_kt },
      elevationFt: a.elevationFt ?? 0, altimeterInHg: card?.metar?.altimeter_in_hg, tempC: card?.metar?.temp_c,
      weightLb: kind === "takeoff" ? fit.takeoffLb : fit.landingLb,
    }) : null);
    const chips = (kind: "takeoff" | "landing", chosen: string | null, landing: Landing | null, note: string | null, pick: (end: string) => void, label?: string) =>
      (trailing: ReactNode) => (
        <PatternChips
          airport={a} wind={wind} chosen={chosen} landing={landing} label={label} onPick={pick} fitOf={fitOf(kind)}
          note={note} trailing={trailing}
        />
      );
    const landingChips = chips("landing", chosenAt(a.ident), landingOf(a.ident), patternNote(a, chosenAt(a.ident), landingOf(a.ident)), end => onPick(a.ident, end));
    // A round trip's departure is left from its own runway (`takeoff`), the
    // field's pattern the landing's, as a stop's are.
    const roundTrip = a.role === "Departure" && airports.some(b => b !== a && b.role === "Destination" && sameField(b.ident, a.ident));
    const departChips = roundTrip
      ? chips("takeoff", takeoffAt(a.ident), null, takeoffAt(a.ident) ? `Runway ${takeoffAt(a.ident)}` : null,
        end => onTakeoff(a.ident, end), `${a.ident} takeoff runway`)
      : chips("takeoff", chosenAt(a.ident), null, patternNote(a, chosenAt(a.ident), null), end => onPick(a.ident, end));
    const takeoffChips = chips("takeoff", takeoffAt(a.ident), null, takeoffAt(a.ident) ? `Runway ${takeoffAt(a.ident)}` : null,
      end => onTakeoff(a.ident, end), `${a.ident} takeoff runway`);
    // The departure's time on its own step, from the route's box at the
    // owner's ask ("The departure time can move from the route box to the
    // departure and arrival boxes"): picked there, Now for about now.
    const leaving = onDepart ? <DepartPicker value={depart} onChange={onDepart} look="time" /> : time;
    // Each runway line's key as PatternChips keeps it open: the field and
    // the chips' own name, none for a landing's or a departure's own.
    const landingLine = { key: `${a.ident}:`, chosen: chosenAt(a.ident) };
    const takeoffLine = { key: `${a.ident}:${a.ident} takeoff runway`, chosen: takeoffAt(a.ident) };
    if (a.role === "Departure") {
      return block([{ role: "Depart", kinds: (["departure"] as Kind[]).filter(has), chips: departChips, leaves: null, line: roundTrip ? takeoffLine : landingLine }], leaving);
    }
    if (a.role === "Destination") return block([{ role: "Arrive", kinds: (["arrival", "approach"] as Kind[]).filter(has), chips: landingChips, leaves: null, line: landingLine }], time);
    // A stop is landed at and left again, each with its own runway, at the
    // owner's ask ("If a stop is an airport then it should have arrival
    // first with a runway and a separate departure with a runway"): two
    // steps, the pattern drawn the landing's.
    // When it leaves again, picked on its Depart step as the flight's own
    // departure is, at the owner's ask ("we should not say 30 min on the
    // ground instead just make the departure time selectable like now is
    // for the first departure"): kept as its minutes on the ground (the
    // address's `ground`), the flights after it timed from it; none picked,
    // the planner's turnaround after it lands (the stop's row, groundMinAt).
    // Never before it lands.
    const onGroundMin = row?.kind === "stop" ? row.groundMin : groundMinAt(ground, a.ident);
    const flownTo = row?.minutesFlown ?? landedAt(a.ident);
    const landsMs = flownTo == null ? null : startMs + flownTo * 60_000;
    const leaves = landsMs === null ? null : onGround ? (
      <DepartPicker
        value={new Date(landsMs + onGroundMin * 60_000).toISOString()} look="time" label={`Departure from ${a.ident}`} testId={`depart-date-${a.ident}`} leavesNow={false}
        // From landing to a day after, as the planner takes a stop's time
        // on the ground (PlanQuery.own_ground).
        earliest={landsMs} latest={landsMs + DAY_MIN * 60_000}
        onChange={iso => { if (iso) onGround(a.ident, Math.min(DAY_MIN, Math.max(0, Math.round((Date.parse(iso) - landsMs) / 60_000)))); }}
      />
    ) : etaAt(depart || new Date().toISOString(), flownTo! + onGroundMin);
    return block([
      { role: "Arrive", kinds: (["arrival", "approach"] as Kind[]).filter(has), chips: landingChips, leaves: null, line: landingLine },
      { role: "Depart", kinds: (["departure"] as Kind[]).filter(has), chips: takeoffChips, leaves, line: takeoffLine },
    ], time);
  };

  // The route's own rows where the course is in: its fields as steps and
  // the fixes flown through between them, the checkpoints and the tops of
  // climb and descent left to the nav log. Before then, the fields alone.
  // The fuel in the tanks at each point, by its row, at the owner's ask
  // ("next to airport say ... fuel", "I mean fuel in tanks"): full at the
  // departure, the start, taxi and takeoff allowance and the legs' own
  // burn taken from them after, filled again at each field landed at, as
  // the planner checks each flight (app.planning.route_totals). Under the
  // reserve, low.
  const tanks = new Map<string, { gal: number; usable: number; low: boolean }>();
  if (fuel) {
    tanks.set("departure", { gal: fuel.usableGal, usable: fuel.usableGal, low: false });
    let burned = 0;
    for (const r of rows) {
      if (r.kind === "departure") continue;
      burned += legOf(r)?.fuel_gal ?? Number.NaN;
      const gal = fuel.usableGal - fuel.taxiGal - burned;
      if (Number.isFinite(gal)) tanks.set(r.key, { gal: Math.max(0, gal), usable: fuel.usableGal, low: gal < fuel.reserveGal });
      if (r.kind === "stop" && r.airport.kind !== "fix") burned = 0;
    }
  }
  const steps: ReactNode[] = [];
  const shown = new Set<ProcedureAirport>();
  // The fuel stops suggested for the flight that leaves a field, after
  // its departure: each one where it lands, timed from when the flight
  // leaves (the route's departure, or a stop's landing and its time on
  // the ground), Keep it and Another field on the first. A round trip's
  // field twice: the flight that leaves it, once.
  const suggested = new Set<FuelStopSuggestion>();
  const fuelStopRows = (ident: string, row: NavLogRow | undefined): ReactNode[] => {
    const flight = fuelStops.find(f => sameField(f.departure, ident) && !suggested.has(f));
    if (!flight || !flight.stops.length) return [];
    suggested.add(flight);
    const leavesMin = row?.kind === "stop" ? (row.minutesFlown ?? 0) + row.groundMin : 0;
    return [
      ...flight.stops.map((stop, k) => (
        <FuelStopRow
          key={`fuel-${ident}-${stop.ident}`} stop={stop} last={false} usableGal={flight.usable_gal}
          time={etaAt(depart || new Date().toISOString(), leavesMin + stop.minutes)} groundMin={groundMinAt(ground, stop.ident)}
          choices={k === 0 ? flight.choices : undefined}
          onChoose={onKeepFuelStops ? c => onKeepFuelStops(ident, [c.ident]) : undefined}
        />
      )),
      onKeepFuelStops && (
        <FuelStopsAdd
          key={`fuel-${ident}-add`} count={flight.stops.length} last={false}
          onAdd={() => onKeepFuelStops(ident, flight.stops.map(s => s.ident))}
        />
      ),
    ];
  };
  const points = rows.filter(r => r.kind !== "checkpoint" && r.kind !== "toc" && r.kind !== "tod");
  points.forEach((row, i) => {
    const last = i === points.length - 1;
    // By the field, not its spelling: a stop typed UES comes back from the
    // planner as KUES. A round trip's field twice, its departure first.
    const field = "airport" in row && row.airport.kind !== "fix"
      ? airports.find(a => sameField(a.ident, row.airport.ident) && !shown.has(a)) : undefined;
    // A hold at the point, its own row after it, at the owner's ask
    // ("hold should get its own row").
    const holdRow = (ident: string) => {
      const hold = holdOn(ident);
      return hold && onHoldSet ? (
        <HoldRow
          key={`hold-${ident}`} hold={hold} flown={heldAs(ident)} last={last}
          onOpen={() => setHoldAt({ fix: hold.fix, hold, altitudeFt: legOf(row)?.altitude_ft ?? null, arrivalDeg: null })}
        />
      ) : null;
    };
    if (field) {
      shown.add(field);
      steps.push(fieldStep(field, row, last));
      if (field.role === "Destination") steps.push(holdRow(field.ident));
      else steps.push(...fuelStopRows(field.ident, row));
      return;
    }
    // A waypoint the route flies over (VPBNG), or ends at: its altitude
    // and Direct to, as a field's landing has. Not where it starts.
    const time = etaAt(depart || new Date().toISOString(), row.minutesFlown);
    const to = row.kind !== "departure" && "airport" in row && !isPosition(row.airport.ident);
    const end = to ? pointEnd(row.airport.ident, { time, waypoint: true, elevationFt: null, to: true, stop: row.kind === "stop", holdable: true, row }) : null;
    steps.push(
      <Step
        key={row.key} last={last} mark={<PointMark row={row} number={undefined} weather={weather} />}
        title={rowPoint(row).name} testId={`route-${row.kind}`}
        icon={tanks.has(row.key) ? <FuelGauge gal={tanks.get(row.key)!.gal} usable={tanks.get(row.key)!.usable} tone={tanks.get(row.key)!.low ? "low" : undefined} /> : undefined}
        sub={end?.direct ? <span className="font-semibold text-tint">Direct to</span> : `${row.kind === "stop" ? (to && frdOf(row.airport.ident) ? row.airport.name : "Fly over") : row.kind === "destination" ? "Destination" : "Departure"}${along(row)}`}
        figures={end?.figures ?? <PointFigures time={time} altitude={null} kind="cruise" />} menu={end?.menu}
      />,
    );
    if (to) steps.push(holdRow(row.airport.ident));
  });
  const fieldsAlone = rows.length === 0 ? airports.map((a, i) => fieldStep(a, undefined, i === airports.length - 1)) : null;

  const field = on ? airports.find(a => a.ident === on.ident) : undefined;
  const list = on ? listOf(on.ident) : undefined;
  const chosen = on ? pickOf(on.ident, on.kind) : null;
  const stale = list?.stale ? `Out of date: the ${cycleDate(list.cycle)} cycle, as the current one could not be had` : null;
  return (
    <>
    {/* Its own popover beside the procedures' sheet's, not inside its root:
        there, on a desktop, it closed as it opened. */}
    {holdUsed && (
      <Suspense fallback={null}>
        <HoldSheet at={holdAt} onClose={() => setHoldAt(null)} onSet={(fix, hold) => { onHoldSet?.(fix, hold); setHoldAt(null); }} />
      </Suspense>
    )}
    <ResponsivePopover open={!!at} onOpenChange={open => { if (!open) close(); }}>
      <ResponsivePopoverAnchor asChild>
        <ol className="pt-2 pb-1" aria-label="The route" data-testid="procedures">{fieldsAlone ?? steps}</ol>
      </ResponsivePopoverAnchor>
      {editingUsed && (
        <Suspense fallback={null}>
          <PointAltitudeDialog
            point={editing} onClose={() => setEditing(null)}
            onSet={(ident, feet) => { onPointAltitude?.(ident, feet); setEditing(null); }}
          />
        </Suspense>
      )}
      {fixFromUsed && (
        <Suspense fallback={null}>
          <FixFromDialog
            from={fixFrom} onClose={() => setFixFrom(null)}
            onCreate={ident => { if (fixFrom) onCreateFix?.(fixFrom, ident); setFixFrom(null); }}
          />
        </Suspense>
      )}
      {/* On a phone a sheet that keeps its height from page to page, as
          an iOS sheet does pushing one. Half the screen (PROCEDURES_SHEET),
          the map above it in sight and clear -- no shade over it -- as a
          procedure is picked, as ForeFlight's Procedure Advisor keeps it,
          at the owner's pick. */}
      <ResponsivePopoverContent
        title={on ? (procedure ? `${on.ident} ${procedure.name}` : listTitle(on.ident, on.kind)) : "Procedures"}
        className="max-h-[70vh] w-80 overflow-y-auto p-3" align="start" side="right"
        leading={procedure ? <BackButton onClick={() => setPage(null)} data-testid="procedures-back" /> : undefined}
        action={<CloseButton onClick={close} data-testid="procedures-close" />}
        sheetClassName="data-[side=bottom]:h-[55dvh] data-[side=top]:h-[55dvh]"
        sheetOverlayClassName="bg-transparent dark:bg-transparent supports-backdrop-filter:backdrop-blur-none"
      >
        {on && (procedure ? (
          <ProcedurePage
            key={`${on.ident}:${procedure.id}`}
            kind={on.kind} ident={on.ident} procedure={procedure}
            chosen={chosen?.id === procedure.id ? chosen : null} stale={stale}
            onAdd={transition => { pick(on.ident, on.kind, { id: procedure.id, transition }); close(); }}
            onRemove={() => pick(on.ident, on.kind, null)} onPreview={onPreview}
            onChart={field === destination && !chartsDisabled ? () => { close(); onCharts(); } : null}
          />
        ) : (
          <ProcedurePicker
            key={`${on.ident}:${on.kind}`} kind={on.kind} list={list} chosen={chosen} stale={stale}
            failed={lists[airports.findIndex(a => a.ident === on.ident)]?.isError ?? false}
            wind={windOf(on.ident)} onOpen={p => setPage({ at: on, procedure: p })}
          />
        ))}
      </ResponsivePopoverContent>
    </ResponsivePopover>
    </>
  );
}

/** "KDLH approaches": a kind's list's title. */
function listTitle(ident: string, kind: Kind): string {
  return `${ident} ${KIND_TITLE[kind].toLowerCase()}`;
}

/** A field's dot on the line before the course is in: hollow, and filled
 *  at the flight's end. */
function FieldDot({ last }: { last: boolean }) {
  return <span aria-hidden="true" className={cn("mt-1 block size-3.5 rounded-full border-[3px] border-tint", last ? "bg-tint" : "bg-background")} />;
}

const NO_HOLDS: Hold[] = [];
const NO_FUEL_STOPS: FuelStopSuggestion[] = [];
/** A day, min: the longest time on the ground at a stop the planner takes. */
const DAY_MIN = 24 * 60;

/**
 * A hold the pilot put at a point (HoldSheet), its own row after it: a
 * racetrack on the route's line, what it is ("Right turns · 270° inbound
 * · 1 min legs · 2 turns"), the entry the planner worked out from the
 * course flown to it (AIM 5-3-8) and the time it adds; a tap changes it.
 */
function HoldRow({ hold, flown, last, onOpen }: { hold: Hold; flown: LegHold | null; last: boolean; onOpen: () => void }) {
  return (
    <li className="relative flex gap-2.5" data-testid="route-hold" data-fix={hold.fix}>
      {!last && <span aria-hidden="true" className="absolute top-0 bottom-0 left-[calc(0.875rem-1px)] w-0.5 bg-border" />}
      <div className="relative flex w-7 shrink-0 justify-center pt-1.5" aria-hidden="true">
        <svg viewBox="0 0 28 16" className="h-4 w-7 rounded-full bg-background">
          <rect x="2" y="2" width="24" height="12" rx="6" fill="none" stroke={COURSE_MAGENTA} strokeWidth="2.5" strokeDasharray="4 3" />
        </svg>
      </div>
      <button
        type="button" onClick={onOpen}
        aria-label={`Hold at ${hold.fix}: ${holdWords(hold)}${flown ? `, ${flown.entry} entry, ${Math.round(flown.minutes)} minutes more` : ""}: change`}
        className="mb-4 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-tint/8 px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("font-semibold", TEXT.row)}>Hold</span>
          <span className={cn("text-muted-foreground", TEXT.note)}>
            {holdWords(hold)}{flown ? ` · ${flown.entry} entry` : ""}
          </span>
        </span>
        {flown && <span className={cn("shrink-0 font-semibold tabular-nums", TEXT.detail)}>+{Math.round(flown.minutes)} min</span>}
        <ChevronRight className="size-5 shrink-0 text-tint" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * One step down the line the flight takes: its mark on the line, as the
 * nav log draws it, its name and the time it is reached, and under them
 * what is flown there (a field's). The line runs on to the next step.
 */
function Step({ mark, title, sub, figures, menu, last, field = false, testId, icon, children }: {
  mark: ReactNode;
  /** After its name: the fuel in the tanks there (FuelGauge). */
  icon?: ReactNode;
  /** Its name, said to a screen reader and shown in its head, and the line
   *  under it: what it is, and how far along. */
  title: string;
  sub?: ReactNode;
  /** Its time over its altitude (PointFigures), and its menu (PointMenu). */
  figures: ReactNode;
  menu?: ReactNode;
  last: boolean;
  field?: boolean;
  testId?: string;
  children?: ReactNode;
}) {
  const Name = field ? "h3" : "span";
  return (
    <li className="relative flex gap-2.5" data-testid={testId}>
      {!last && <span aria-hidden="true" className="absolute top-3 bottom-0 left-[calc(0.875rem-1px)] w-0.5 bg-border" />}
      <div className="relative flex w-7 shrink-0 justify-center pt-0.5">{mark}</div>
      <section aria-label={title} className={cn("min-w-0 flex-1 space-y-3", field ? "pb-5" : "pb-4")}>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1">
              <Name className={cn("truncate", field ? "font-semibold" : "font-normal", TEXT.row)}>{title}</Name>
              {icon}
            </span>
            {sub && <span className={cn("truncate text-muted-foreground", TEXT.note)}>{sub}</span>}
          </div>
          {figures}
          {menu}
        </div>
        {children}
      </section>
    </li>
  );
}

/**
 * Choices laid out as chips, as iOS's filters are, one of them picked:
 * shadcn's ToggleGroup (Radix: a radio group to a screen reader, arrow
 * keys between them), a tap on the one picked keeping it. Each chip is 32
 * high; its 44-point hit area a pseudo-element six round it, meeting its
 * neighbours' across the twelve between them, along a row and between
 * the rows they wrap to, the chip not grown.
 */
function Chips({ label, value, onChange, trailing, trailingRef, enter, flushStart = false, children }: {
  /** The pull-downs' box, for the line to glide them as it opens. */
  trailingRef?: RefObject<HTMLDivElement | null>;
  /** How the chips come in, the pull-downs after them left out of it. */
  enter?: string;
  /** Its first chip at its start, no room kept before it for the chip's
   *  own tap area: where a control's 44 points end just before it (the
   *  runway line's arrow). */
  flushStart?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** After the chips, sliding with them: a field's procedures' pull-downs
   *  (the owner's "just let it slide with runways"). */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  // The chip chosen in sight: one past the row's end (O'Hare's 9L of
  // eight runways) scrolled in, sideways only -- as it is picked, and again
  // whenever the line or its chips change size after it opens: brought in
  // once at its first layout, 9L was out of sight again by the time it was
  // looked for, one run in two (procedures:306). A pilot's own scroll
  // resizes nothing, so it is never undone.
  useEffect(() => {
    const box = row.current;
    if (!box) return;
    const show = () => {
      const on = box.querySelector<HTMLElement>("[data-state=on]");
      if (!on) return;
      const edge = box.getBoundingClientRect(), chip = on.getBoundingClientRect();
      if (chip.right > edge.right) box.scrollLeft += chip.right - edge.right + CHIP_GAP_PX;
      else if (chip.left < edge.left) box.scrollLeft -= edge.left - chip.left + CHIP_GAP_PX;
    };
    show();
    const watch = new ResizeObserver(show);
    watch.observe(box);
    if (box.firstElementChild) watch.observe(box.firstElementChild);
    return () => watch.disconnect();
  }, [value]);
  return (
    // One line, scrolled sideways where the chips are more than fit, at
    // the owner's ask; the padding keeps the chips' and the group's tap
    // areas inside what the scroll clips.
    <div ref={row} data-slides="" className={cn("-my-1.5 min-w-0 flex-1 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", flushStart ? "-mr-1.5 pr-1.5" : "-mx-1.5 px-1.5", trailing && "flex items-center gap-3")}>
      <ToggleGroup
        type="single" value={value} onValueChange={v => { if (v) onChange(v); }}
        aria-label={label} spacing={3}
        // The group's own 44 a pseudo-element behind it, as Segmented's
        // track has, so a tap just over or under a row of chips is the
        // group's and not the page's (isolate keeps it over what is round).
        className={cn("relative isolate w-max flex-nowrap after:absolute after:inset-x-0 after:-inset-y-1.5 after:-z-10 after:content-['']", !trailing && "min-w-full", enter)}
      >
        {children}
      </ToggleGroup>
      {trailing && <div ref={trailingRef} className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );
}

/** Where each runway line's pull-downs stood at its last drawing, by the
 *  line's key, and whether it was open: for them to glide from there as it
 *  opens or folds (PatternChips). */
const trailingStood = new Map<string, { open: boolean; x: number }>();

/** How long an opened runway line waits, untouched, before it slides back
 *  to the runway picked, ms: two seconds, at the owner's ask ("Runways can
 *  collapse in 2 seconds"; it was four, then three). */
const RUNWAY_LINE_FOLD_MS = 2000;
/** The fold's wait, or a test's longer one (the browser specs keep a line
 *  open while they pick from it: two seconds of a loaded test runner were
 *  gone before the pick). */
function runwayLineFoldMs(): number {
  try {
    return Number(globalThis.localStorage?.getItem("vfr.runwayFoldMs")) || RUNWAY_LINE_FOLD_MS;
  } catch {
    return RUNWAY_LINE_FOLD_MS;
  }
}

/** The runway lines opened from their fold (PatternChips), by field. */
const useOpenRunwayLines = create<{ open: string[] }>(() => ({ open: [] }));

/** The route's fields toggled from how they start -- folded to one row --
 *  by their part and field ("Stop:KMSN"): kept while the page is, as the
 *  list is drawn again. */
const useToggledFields = create<{ toggled: string[] }>(() => ({ toggled: [] }));
const toggleField = (key: string) =>
  useToggledFields.setState(s => ({ toggled: s.toggled.includes(key) ? s.toggled.filter(k => k !== key) : [...s.toggled, key] }));

/** Whether the fields start opened: the browser specs' (localStorage
 *  "vfr.fieldsOpen", as the signed-in session they share keeps it), which
 *  work on the steps' runways and procedures. Folded otherwise. */
function fieldsOpenAtFirst(): boolean {
  try { return globalThis.localStorage?.getItem("vfr.fieldsOpen") === "1"; } catch { return false; }
}

/** The room left past a chip scrolled into sight, in pixels. */
const CHIP_GAP_PX = 12;

const CHIP = cn(
  "relative h-8 min-w-11 rounded-full bg-foreground/8 px-3 font-normal text-foreground hover:bg-foreground/12",
  "data-[state=on]:bg-primary data-[state=on]:font-semibold data-[state=on]:text-primary-foreground hover:data-[state=on]:bg-primary",
  "after:absolute after:-inset-1.5 after:content-['']",
  TEXT.detail,
);

/**
 * A field's traffic pattern, picked by its runway as a chip: the
 * end the wind favours marked with the wind, as the redesign's A had it
 * at the owner's pick, and its head- and crosswind said under the chips
 * (windPick) -- at a departure too, the runway to take off on, at the
 * owner's ask, from the nearest report's wind where the field has none of
 * its own, said as that station's. Drawn on the map as the FAA's Airplane Flying
 * Handbook flies a pattern: the downwind about three-quarters of a mile
 * out, the base 45° from the runway's end, the 45° entry abeam midfield.
 * The side its traffic is flown on and the pattern's altitude are said
 * at the head's end for the runway picked.
 */
/** How the route lands at a field it flies an approach to: the
 *  approach's runway (none for one circling only), whether its plate
 *  publishes circling minimums (undefined until the plate is in), and the
 *  approach as the route's box names it. */
interface Landing {
  runway: string | null;
  circling: boolean | undefined;
  name: string;
}

function PatternChips({ airport: a, wind, chosen, landing, note, label, fitOf, onPick, trailing }: {
  airport: ProcedureAirport;
  /** Each end's fit today, marked on its chip (lib/runwayFit). */
  fitOf: (runway: Runway, end: RunwayEnd) => EndFit | null;
  /** The chips' name to a screen reader, where not the pattern's. */
  label?: string;
  /** How the runway picked is flown -- its pattern's side and height, or
   *  how the approach lands ("Straight in", "Circle to land") -- said in
   *  its chip's name: the info button that showed it is gone, at the
   *  owner's ask ("No need for info button"). */
  note: string | null;
  /** The field's procedures' pull-downs, after the runway picked while the
   *  line is folded, sliding with its runways while it is open. */
  trailing?: ReactNode;
  wind: WindPick | null;
  chosen: string | null;
  landing: Landing | null;
  onPick: (end: string) => void;
}) {
  const ends = (a.runways ?? [])
    .filter(r => !r.closed)
    .flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e })))
    .sort((x, y) => x.end.ident.localeCompare(y.end.ident));
  const into = wind && !wind.calm ? wind.ident : null;
  // With an approach, the chip is the runway landed on: the approach's
  // own, straight in, or another only where the plate publishes circling
  // minimums -- a circle to land (AIM 5-4-20); one circling only may
  // circle to any. No pattern is flown then (PlanWorkspace's patterns).
  const straightIn = landing?.runway ?? null;
  const mayCircle = !!landing && (straightIn === null || landing.circling === true);
  const allowed = (id: string) => !landing || id === straightIn || mayCircle;
  // Folded to the runway picked, at the owner's ask ("can the runway line
  // collapse to the selected runway?"): its chip alone, a tap on it the
  // whole line again, and a pick folding it back to the new one. None
  // picked yet, the line whole. Kept by field while the page is, not the
  // component: the list is drawn again as the sheet moves between its
  // foot and its body.
  const key = `${a.ident}:${label ?? ""}`;
  const open = useOpenRunwayLines(s => s.open.includes(key));
  const setOpen = (next: boolean) => useOpenRunwayLines.setState(s => ({ open: next ? [...s.open, key] : s.open.filter(k => k !== key) }));
  const chip = (runway: Runway, end: RunwayEnd) => {
    const id = runwayNumber(end.ident);
    const windward = into === id;
    // Too short in red, a crosswind past the demonstrated or a length
    // inside the margin in amber: a ring, the chip not grown.
    const fitted = fitOf(runway, end);
    const ring = fitted?.short ? "ring-2 ring-destructive" : fitted && (fitted.crosswindOver || fitted.close) ? "ring-2 ring-amber-500" : undefined;
    const said = fitted?.short ? ", too short today" : fitted?.close ? ", little to spare in length" : "";
    const words = `Runway ${id}${windward ? ", into the wind" : ""}${fitted?.crosswindOver ? `, crosswind ${fitted.crosswindKt} knots, past the airplane's demonstrated` : ""}${said}`;
    const fit = fitted?.short ? "short" : fitted?.crosswindOver ? "crosswind" : fitted?.close ? "close" : undefined;
    return { id, ring, words, fit, face: <>{windward && <Wind className="size-4" strokeWidth={2.2} aria-hidden />}{id}</> };
  };
  const picked = chosen !== null ? ends.find(e => runwayNumber(e.end.ident) === chosen) : undefined;
  // Open with a runway picked and nothing touched for RUNWAY_LINE_FOLD_MS,
  // it slides back to the runway picked, at the owner's ask ("back left
  // after a few seconds"); a touch or a scroll on it starts the wait again.
  const [touched, setTouched] = useState(0);
  const folds = open && chosen !== null && a.runways !== null;
  useEffect(() => {
    if (!folds) return;
    const id = setTimeout(() => useOpenRunwayLines.setState(s => ({ open: s.open.filter(k => k !== key) })), runwayLineFoldMs());
    return () => clearTimeout(id);
  }, [folds, key, touched]);
  // The pull-downs after the runways ("+ Arrival", "+ Approach") glide to
  // where the line puts them as it opens and folds, as the runways slide
  // in, where they jumped there -- and faded and slid in with the runways
  // -- once they came up beside them (the owner's "not as smooth as it
  // used to be before the procedures got moved up"). Where they stood is
  // taken at every render (a scroll of the line is one, `touched`), by
  // the line's key, as the line is drawn anew as it opens (its block's
  // runway-line-toggle), and they start from it, by a CSS transition:
  // WebKit's headless WAAPI can stall at its first frame.
  const line = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const shown = !!picked && !open && a.runways !== null ? "folded" : "open";
  useLayoutEffect(() => {
    const box = after.current, base = line.current;
    if (!box || !base) {
      trailingStood.delete(key);
      return;
    }
    const x = box.getBoundingClientRect().left - base.getBoundingClientRect().left;
    const was = trailingStood.get(key);
    trailingStood.set(key, { open: shown === "open", x });
    if (!was || was.open === (shown === "open") || Math.abs(was.x - x) < 1) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    box.style.transition = "none";
    box.style.transform = `translateX(${was.x - x}px)`;
    // Laid out from there before the transition back: a call, as the
    // minifier drops a bare read of offsetWidth.
    box.getBoundingClientRect();
    box.style.transition = "transform 300ms ease-out";
    box.style.transform = "";
  });
  if (shown === "folded" && picked) {
    const c = chip(picked.runway, picked.end);
    return (
      <div ref={line} className="flex items-center gap-3" data-testid="procedure-patterns">
        {/* Still the group's choice to a screen reader, picked; a tap on it
            opens the line. */}
        <div role="radiogroup" aria-label={label ?? `${a.ident} ${landing ? "runway" : "traffic pattern"}`}>
          {/* The arrow that opens the line is by the landing's or the
              takeoff's glyph now (the block's runway-line-toggle); a tap on
              the chip still opens it. */}
          <button
            type="button" role="radio" aria-checked="true" data-state="on" onClick={() => setOpen(true)}
            // One line, the wind's mark, the runway and the arrow side by side:
            // a plain button, not the group's items, it stacked them, the
            // arrow out under the chip (the owner's screenshot, 2026-10-20).
            className={cn(CHIP, "inline-flex items-center gap-0.5 whitespace-nowrap after:left-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3 motion-safe:duration-300", c.ring)}
            aria-label={`${c.words}${note ? `, ${note}` : ""}, picked: tap for the other runways`} data-testid="procedure-pattern" data-fit={c.fit} data-folded=""
          >
            {c.face}
          </button>
        </div>
        {trailing && <div ref={after} className="flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
    );
  }
  return (
    // The chips alone, the wind the airport's under its ident and how the
    // runway picked is flown in its chip's name (the owner's "No need for
    // info button").
    <div ref={line} className="flex items-center gap-2" data-testid="procedure-patterns">
      {a.runways === null ? (
        <>
          <p role="status" className={cn("px-1 text-muted-foreground", TEXT.detail)}>Looking the runways up…</p>
          {trailing}
        </>
      ) : (
        // Opened from its fold, the line slides out to the right of the
        // runway picked, at the owner's ask ("smoothly expand to the
        // right"); a touch or a scroll on it holds it open (touched).
        <div
          className="flex min-w-0 flex-1"
          onPointerDown={() => setTouched(t => t + 1)} onScrollCapture={() => setTouched(t => t + 1)}
        >
          {/* A runway each: no None, at the owner's ask ("Why is none even
              an option?"), as every takeoff and landing is on one -- and
              the chip picked tapped again is no way to unpick it either. */}
          <Chips
            label={label ?? `${a.ident} ${landing ? "runway" : "traffic pattern"}`} value={chosen ?? NONE}
            onChange={v => { if (!v || v === NONE) return; setOpen(false); onPick(v); }} trailing={trailing} flushStart
            trailingRef={after} enter={chosen !== null ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-6 motion-safe:duration-300" : undefined}
          >
            {ends.map(({ runway, end }) => {
              const c = chip(runway, end);
              // An end with no surveyed threshold has no pattern to draw;
              // with an approach, none is drawn, and the end is the approach's
              // own or one it may circle to.
              const drawn = trafficPattern(a.ident, runway, end.ident, a.patternAltitudeFt) !== null;
              const circleNa = !allowed(c.id);
              return (
                <ToggleGroupItem
                  key={end.ident} value={c.id} disabled={circleNa || (!landing && !drawn)} className={cn(CHIP, c.ring)}
                  aria-label={`${c.words}${circleNa ? `, no circling on the ${landing!.name}` : !landing && !drawn ? ", not surveyed" : ""}`}
                  data-testid="procedure-pattern" data-fit={c.fit}
                >
                  {c.face}
                </ToggleGroupItem>
              );
            })}
          </Chips>
        </div>
      )}
    </div>
  );
}

/** The runway picked, as its field's info says it: the pattern's side and
 *  height, or with an approach, straight in or a circle to land. */
function patternNote(a: ProcedureAirport, chosen: string | null, landing: Landing | null): string | null {
  if (chosen === null) return null;
  if (landing) return chosen === landing.runway ? "Straight in" : "Circle to land";
  const end = (a.runways ?? []).flatMap(r => r.runway_ends ?? []).find(e => runwayNumber(e.ident) === chosen);
  // Left unless the FAA flags it right (14 CFR 91.126(b)(1)).
  const side = end ? `Runway ${chosen}, ${end.traffic === "right" ? "right" : "left"} traffic` : `Runway ${chosen}`;
  return [side, a.patternAltitudeFt != null ? `${altFt(a.patternAltitudeFt)} ft` : null].filter(Boolean).join(" · ");
}

/** A field's reported wind as its info's trigger writes it: "240°T" over
 *  "12G20" (knots), calm, or none (format's reportedWind). */
type Reported = ReportedWind;

/**
 * One kind of a field's procedures, each by its chart's title, a page of
 * its own a tap away (ProcedurePage), the one in the route checked, an
 * approach to the runway the wind favours said so. Drawn from the FAA's
 * coded procedure: a sketch on the chart, not the chart.
 */
function ProcedurePicker({ kind, list, failed, chosen, stale, wind, onOpen }: {
  kind: Kind;
  list: ProcedureList | undefined;
  /** The FAA's file could not be had. */
  failed: boolean;
  chosen: PickedProcedure | null;
  stale: string | null;
  wind: WindPick | null;
  onOpen: (procedure: ProcedureSummary) => void;
}) {
  if (failed) return <p role="alert" className="px-1 text-muted-foreground">The FAA's procedures could not be had</p>;
  if (!list) return <p role="status" className="px-1 text-muted-foreground">Looking the procedures up…</p>;
  const of = list.procedures.filter(p => p.kind === kind);
  if (of.length === 0) return <p className="px-1 text-muted-foreground" data-testid="procedures-none">{`No ${KIND_TITLE[kind].toLowerCase()} published`}</p>;
  const runways = (p: ProcedureSummary) => p.runway_transitions.length
    ? p.runway_transitions.includes("ALL") ? "All runways" : `Runway ${p.runway_transitions.map(r => r.replace(/^RW/, "").replace(/B$/, "")).join(", ")}`
    : undefined;
  // From the FAA's coded procedures (CIFP): a sketch on the chart to plan
  // by, not for navigation. No footnote under them (the owner's "Avoid
  // putting so many footnotes"); a cycle out of date is still said, as a
  // warning in its place.
  return (
    <ListGroup>
      {stale && <ListRow title={<span className="text-destructive-ink">{stale}</span>} data-testid="procedures-stale" />}
      {of.map(p => {
        const mine = chosen?.id === p.id ? chosen : null;
        const windward = kind === "approach" && !!p.runway && !!wind && !wind.calm && runwayNumber(p.runway) === wind.ident;
        const said = [
          mine ? `In the route, ${transitionWords(kind, mine.transition, true)}` : null,
          windward ? "Into the wind" : null,
          kind === "approach" ? null : runways(p),
        ].filter(Boolean).join(" · ");
        return (
          <ListRow
            key={p.id} title={p.name} chevron onClick={() => onOpen(p)} data-testid="procedure-option"
            description={said || undefined}
            value={mine ? <Check className="size-4 text-tint" aria-label="In the route" /> : undefined}
          />
        );
      })}
    </ListGroup>
  );
}

/**
 * One procedure's own page, as ForeFlight's Procedure Advisor has it: its
 * transitions as chips -- an approach's feeder fixes and vectors to the
 * final, an arrival's or a departure's enroute transitions or none -- the
 * map above the sheet drawing the one chosen as it is chosen, its fixes in
 * the order they are flown with the altitudes they are crossed at, and
 * Add to Route at the foot (Remove from Route, where it is the route's),
 * an approach's chart beside it.
 */
function ProcedurePage({ kind, ident, procedure, chosen, stale, onAdd, onRemove, onPreview, onChart }: {
  kind: Kind;
  ident: string;
  procedure: ProcedureSummary;
  /** This procedure as the route has it, if it does. */
  chosen: PickedProcedure | null;
  /** Its cycle's warning where it is out of date. */
  stale: string | null;
  onAdd: (transition: string | null) => void;
  onRemove: () => void;
  onPreview: (procedure: PickedProcedure | null) => void;
  /** The field's approach charts, where it has them to open. */
  onChart: (() => void) | null;
}) {
  const [transition, setTransition] = useState<string | null>(chosen?.transition ?? null);
  // Drawn as it is chosen, before it is added; off the map as the page is
  // left (Back, or the sheet put away).
  useEffect(() => {
    onPreview({ ident, id: procedure.id, transition });
    return () => onPreview(null);
  }, [ident, procedure.id, transition, onPreview]);
  // The same drawing the map is given (PlanWorkspace's preview), its
  // fixes listed here: one request for both.
  const { data: drawing } = useQuery({
    queryKey: ["procedure", ident, procedure.id, transition],
    queryFn: () => api.procedure(ident, procedure.id, transition),
    staleTime: PROCEDURE_STALE_MS,
  });
  const inRoute = !!chosen && chosen.transition === transition;
  return (
    <div className="space-y-5">
      {procedure.transitions.length > 0 && (
        <div className="space-y-2">
          <h4 className={cn("px-1 font-semibold", TEXT.detail)}>Transition</h4>
          <Chips label="Transition" value={transition ?? NONE} onChange={v => setTransition(v === NONE ? null : v)}>
            <ToggleGroupItem value={NONE} className={CHIP} data-testid="procedure-transition">
              {transitionWords(kind, null)}
            </ToggleGroupItem>
            {procedure.transitions.map(t => (
              <ToggleGroupItem key={t} value={t} className={CHIP} data-testid="procedure-transition">{transitionWords(kind, t)}</ToggleGroupItem>
            ))}
          </Chips>
        </div>
      )}
      {drawing && <FixLadder drawing={drawing} />}
      {stale && <p className={cn("px-1 text-destructive-ink", TEXT.detail)}>{stale}</p>}
      {/* At the phone's sheet's foot as the page scrolls, as ForeFlight's
          Add to Route is: down over the sheet's own padding under it, the
          rows going under it fading into the glass rather than an opaque
          band across it. In the popover from md up, at the page's end:
          pinned there it reached into an iPhone held sideways' notch with
          the popover (the iOS audit's P12). */}
      <div
        className={cn(
          "sticky bottom-[calc(-1*max(1rem,env(safe-area-inset-bottom)))] -mx-4 flex gap-2 bg-linear-to-b from-transparent to-background/85 to-35% px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
          "md:static md:mx-0 md:bg-none md:p-0",
        )}
      >
        {onChart && kind === "approach" && (
          <Button type="button" variant="secondary" onClick={onChart} data-testid="procedure-chart">Chart</Button>
        )}
        {inRoute ? (
          <Button type="button" variant="outline" className="flex-1 text-destructive" onClick={onRemove} data-testid="procedure-remove">
            Remove from Route
          </Button>
        ) : (
          <Button type="button" className="flex-1" onClick={() => onAdd(transition)} data-testid="procedure-add">
            Add to Route
          </Button>
        )}
      </div>
    </div>
  );
}

/** The roles a fix's mark says, an approach's own (ARINC 424): where
 *  it is flown from, onto the final, and down it to the missed approach
 *  point. */
const FIX_ROLES = ["IAF", "IF", "FAF", "MAP"];

/**
 * A procedure's fixes in the order they are flown, as a ladder: each with
 * its role on an approach and the altitude it is crossed at, and the
 * miles between them on the rungs; the missed approach's hold, where it
 * has one, at the foot. The altitudes are the FAA's coded procedure's
 * (CIFP, ARINC 424-18 5.29): at or above its lower, at or below its upper,
 * at both where they are one.
 */
function FixLadder({ drawing }: { drawing: ProcedureDrawing }) {
  const flown = drawing.fixes.filter(f => !f.missed && !(f.roles.length === 1 && f.roles[0] === "hold"));
  if (flown.length === 0) return null;
  const hold = drawing.holds.find(h => h.missed);
  return (
    <ol className="rounded-lg border border-border bg-card px-4 py-1" aria-label="Fixes" data-testid="procedure-fixes">
      {flown.map((f, i) => {
        const from = i > 0 ? flown[i - 1] : undefined;
        return (
        <Fragment key={`${f.ident}-${i}`}>
          {from && (
            <li aria-hidden="true" className="grid grid-cols-[2.75rem_1fr] items-center gap-x-2.5">
              <span className="mx-auto h-5 w-0.5 rounded-full bg-tint" />
              <span className={cn("text-muted-foreground", TEXT.note)}>{`${distanceNm(from, f).toFixed(1)} nm`}</span>
            </li>
          )}
          <li className="grid min-h-10 grid-cols-[2.75rem_1fr_auto] items-center gap-x-2.5">
            <span className={cn("font-bold tracking-wide text-tint", TEXT.caption)}>{f.roles.find(r => FIX_ROLES.includes(r)) ?? ""}</span>
            <span className={cn("font-semibold", TEXT.row)}>{f.ident}</span>
            <span className={cn("tabular-nums", TEXT.detail)}>{crossing(f.min_ft, f.max_ft)}</span>
          </li>
        </Fragment>
        );
      })}
      {hold && (
        <li className={cn("border-t border-border py-2.5 text-muted-foreground", TEXT.detail)}>{`Missed: hold at ${hold.fix}`}</li>
      )}
    </ol>
  );
}

/** "3,200 ft or above", "2,700 ft", "4,000–6,000 ft": the altitude a fix
 *  is crossed at, from its coded limits; nothing where it has none. */
function crossing(min: number | null | undefined, max: number | null | undefined): string {
  if (min != null && max != null) return min === max ? `${altFt(min)} ft` : `${altFt(min)}–${altFt(max)} ft`;
  if (min != null) return `${altFt(min)} ft or above`;
  if (max != null) return `${altFt(max)} ft or below`;
  return "";
}

/** "261001" as "1 Oct 2026". */
function cycleDate(cycle: string): string {
  const at = new Date(Date.UTC(2000 + Number(cycle.slice(0, 2)), Number(cycle.slice(2, 4)) - 1, Number(cycle.slice(4, 6))));
  return Number.isNaN(at.getTime()) ? cycle : at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
