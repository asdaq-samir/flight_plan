import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useQueries } from "@tanstack/react-query";
import { useWindPicks } from "../../../lib/windPicks";
import { api } from "../../../lib/api/client";
import { useMinuteClock, zuluTime } from "../../../lib/clock";
import type { AircraftProfile, Detour, ProcedureList, ProcedureSummary, Runway } from "../../../lib/api/types";
import { normalizeDeg } from "../../../lib/geo";
import { windPick, type WindPick } from "../../../lib/pattern";
import { airportQuery, plateQuery } from "../../../lib/queryClient";
import { approachRunway, sameField, type BranchFix, type PickedProcedure } from "../../../lib/procedures";
import { useOwnShip } from "../../../lib/map/ownShip";
import { reportedWind, type ReportedWind } from "../format";
import type { EditedPoint, PointAltitude } from "../components/PointAltitudeDialog";
import type { HoldAt } from "../components/HoldSheet";
import { useFuelStops } from "./useFuelStops";
import type { Hold } from "../../../lib/holds";
import { legOf, type NavLogRow } from "../components/navlog/rows";
import { callEngine } from "../../../lib/engine/engine";
import type { Landing } from "../components/procedures/PatternChips";
import type { RouteLineChoices } from "../components/procedures/RouteLine";

export type ProcedureKind = ProcedureSummary["kind"];
type Kind = ProcedureKind;

/** The FAA's chart codes in a field's d-TPP for each kind (its card's
 *  terminal charts, wingtip.publications, as the d-TPP metafile's chart_code
 *  has them): an instrument approach procedure, a STAR ("STR"), a
 *  departure procedure (a SID or a graphic obstacle departure) or a
 *  textual one. */
const CHART_CODES: Record<Kind, string[]> = { approach: ["IAP"], arrival: ["STR"], departure: ["DP", "ODP"] };

/** A procedure's data stays good for its cycle's 28 days. */
export const PROCEDURE_STALE_MS = 6 * 60 * 60_000;
/** How far off a field's time must be for its runway to be picked into
 *  the forecast wind rather than the wind now, ms: an hour. */
const FORECAST_AFTER_MS = 60 * 60_000;
const TEN_MIN_MS = 10 * 60_000;
/** A day, min: the longest time on the ground at a stop the planner takes. */
export const DAY_MIN = 24 * 60;

/** A field's reported wind as its info's trigger writes it: "240°T" over
 *  "12G20" (knots), calm, or none (format's reportedWind). */
type Reported = ReportedWind;

/** The route changed in FPL's list rather than its box (lib/preferences
 *  RouteEdit), by the points' places in `routePoints`. */
export interface RouteListEdit {
  /** A point dragged by its grip onto another's place. */
  onMove: (from: number, to: number) => void;
  /** The route's box opened to type a stop in at this place. */
  onAddAt: (index: number) => void;
  /** The point at this place made another, from its card's ident. */
  onReplace?: (index: number, ident: string) => void;
  /** A stop being added at this place, an empty card there to type it
   *  in (In the Plan, which has no route box), and what is typed put in;
   *  left empty, given up. */
  newAt?: number | null;
  /** Fly via's ways round the Class B, offered on that card, best first. */
  newVia?: Detour[] | null;
  onInsert?: (index: number, ident: string) => void;
  onCancelNew?: () => void;
  /** Each point a card of its own, easier to see as it is dragged (In the
   *  Plan, the owner's pick of the canvas's option 3 as cards). */
  cards?: boolean;
  /** A point changed, from its menu's Change: the route's box opened. */
  onChange?: () => void;
}

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

/** Where the procedures sheet is open: a field's kind of procedure, and
 *  one to open the page of as the list comes in, asked for by voice
 *  (lib/pilotCommand: "the ILS one nine right at Milwaukee") -- the
 *  approach as the FAA's names start ("ILS", "RNAV (GPS)") and its
 *  runway ("19R"), or any runway's. */
export type ProceduresAt = { ident: string; kind: Kind; pick?: { approach: string; runway: string | null } | null } | null;

/** The runway lines opened from their fold (PatternChips), by field
 *  ("KMSN:" and the line's label): open until folded, by their head or a
 *  runway picked, or with their field (toggleField), at the owner's ask
 *  ("Keep the routes and runway opened until folded … fold them when the
 *  whole airport is collapsed", 2026-10-28), where they folded after two
 *  seconds untouched. */
export const useOpenRunwayLines = create<{ open: string[] }>(() => ({ open: [] }));

/** The route's fields toggled from how they start -- folded to one row --
 *  by their part and field ("Stop:KMSN"): kept while the page is, as the
 *  list is drawn again. A field folded folds its runway lines with it
 *  (`ident`), so it opens again with its runway picked showing. */
const useToggledFields = create<{ toggled: string[] }>(() => ({ toggled: [] }));
export const toggleField = (key: string, ident: string, opening: boolean) => {
  useToggledFields.setState(s => ({ toggled: s.toggled.includes(key) ? s.toggled.filter(k => k !== key) : [...s.toggled, key] }));
  if (!opening) useOpenRunwayLines.setState(s => ({ open: s.open.filter(k => !k.startsWith(`${ident}:`)) }));
};

/** Whether the fields start opened: the browser specs' (localStorage
 *  "wingtip.fieldsOpen", as the signed-in session they share keeps it), which
 *  work on the steps' runways and procedures. Folded otherwise. */
function fieldsOpenAtFirst(): boolean {
  try { return globalThis.localStorage?.getItem("wingtip.fieldsOpen") === "1"; } catch { return false; }
}

/** What FPL's route list (ProceduresRoute) is given. */
export interface ProceduresRouteProps {
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
  autoPicked: ReadonlySet<string>;
  /** The airplane's figures and weights its runways' fit is worked from;
   *  none, no fit marked. */
  fit: FitInputs | null;
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
  onGround: (ident: string, minutes: number) => void;
  /** The pilot's own altitudes to cross the procedures' fixes at, by fix. */
  crossings: Record<string, number>;
  /** A fix of a procedure picked, tapped on its branch: its card (FixCard). */
  onFix: (field: string, kind: Kind, fix: string) => void;
  /** The departure's time picked on its step (DepartPicker). */
  onDepart: (iso: string) => void;
  /** The altitude at a point of the route, as the route box's menu offers
   *  it (PlanWorkspace's altitudeAt), and the pilot's own set there or
   *  (null) given back to the plan. */
  pointAltitude: (ident: string, waypoint: boolean) => PointAltitude;
  onPointAltitude: (ident: string, feet: number | null) => void;
  /** The point flown direct to (the address's `direct`), and Direct to
   *  one, or (null) the route flown as it was. */
  directTo?: string | null;
  onDirectTo: (ident: string | null) => void;
  /** A point's card (an airport's, a waypoint's), from its menu. */
  onInfo: (ident: string) => void;
  /** A stop taken out of the route, from its menu. */
  onRemove: (ident: string) => void;
  /** The pilot's own point off one of the route's, flown over after it
   *  (FixFromDialog): "VPBNG/090/30". */
  onCreateFix: (after: string, ident: string) => void;
  /** The pilot's holds (lib/holds), each its own row after its point, and
   *  one set, changed or (null) taken off (HoldSheet). */
  holds: Hold[];
  onHoldSet: (fix: string, hold: Hold | null) => void;
  /** A hold asked for at a point just put in the route ("VPBNG/095/14.2@"
   *  and when, AirspaceCard's Hold here): its sheet opened once the plan
   *  has the leg to the point, for the course flown to it. */
  askHold?: string | null;
  /** The route's points as the address has them, the departure first:
   *  a row not among them -- a fix along an airway typed as V100 -- has no
   *  Direct to, Remove or Create a fix, which work on the typed points
   *  (the audit's finding: they did nothing there, or the wrong thing). */
  routePoints: string[];
  /** As many stops as the planner takes (MAX_STOPS): no Create a fix. */
  stopsFull?: boolean;
  /** The tanks, for the fuel in them at each point: their usable fuel, the
   *  start, taxi and takeoff allowance and the reserve the flight is held
   *  to (the totals' fuel check); none known, no fuel shown. */
  fuel?: { usableGal: number; taxiGal: number; reserveGal: number } | null;
  /** The route line under the departure (RouteLine): the planner's ways as
   *  chips, the one picked, and the way to pick one; none, no line. */
  routeLine?: RouteLineChoices | null;
  /** The route changed in the list itself (RouteListEdit): each typed
   *  point's grip, Add a Stop After in its menu, and Add a Stop at the
   *  list's end. None, the list as before. */
  edit?: RouteListEdit;
}

/**
 * FPL's route list's view model (ProceduresRoute): the procedures sheet's
 * place and page, the dialogs open, each field's procedures, card and
 * forecast wind asked for, the runways picked into the wind for the pilot,
 * and the fuel in the tanks at each point. The list itself is drawn by
 * ProceduresRoute and its parts (components/procedures).
 */
export function useProceduresRoute(props: ProceduresRouteProps) {
  const {
    airports, rows, depart, picked, onPick, onPreselect, takeoffs, onPreselectTakeoff, autoPicked, procedures, inRoute, onProcedures, at, onAt,
    directTo = null, askHold = null, holds, routePoints, stopsFull = false, fuel = null, routeLine = null, edit,
  } = props;
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
  // The approach being taught (ApproachLesson), from its menu's Learn This
  // Approach; drawn from its first opening on, as the hold's is.
  const [lesson, setLesson] = useState<PickedProcedure | null>(null);
  const [lessonUsed, setLessonUsed] = useState(false);
  if (lesson !== null && !lessonUsed) setLessonUsed(true);
  const holdOn = (ident: string) => holds.find(h => sameField(h.fix, ident)) ?? null;
  // Where the airplane is known (own ship, or the dry run's): Direct to
  // goes from there.
  const positioned = useOwnShip(s => s.enabled && !!s.fix);
  const [answered, setAnswered] = useState<string | null>(null);
  if (askHold && askHold !== answered) {
    const fix = askHold.slice(0, askHold.lastIndexOf("@"));
    const to = rows.find(r => "airport" in r && sameField(r.airport.ident, fix));
    const leg = to ? legOf(to) : undefined;
    if (leg) {
      setAnswered(askHold);
      setHoldAt({
        fix, hold: holdOn(fix), altitudeFt: leg.altitude_ft,
        arrivalDeg: normalizeDeg(leg.true_course_deg - leg.magnetic_variation_deg),
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
      enabled: (at != null && sameField(at.ident, a.ident)) || asked.has(a.ident),
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
  // the picker taken out meanwhile closed under the pilot's finger. The
  // destination's too, for its forecast wind: a runway picked into the
  // wind plans the route again with its pattern flown, and while the legs
  // came back the field's time was gone, its wind the one reported now,
  // and the runway into the forecast was turned to the one into that, and
  // stayed (forecast-wind.spec, KDLH's 9 to 21, 2026-10-28).
  const landsFresh = rows.flatMap(r => ((r.kind === "stop" || r.kind === "destination") && r.minutesFlown != null ? [`${r.airport.ident}:${r.minutesFlown}`] : [])).join(",");
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
    const flownTo = a.role === "Departure" ? null : row?.minutesFlown ?? landedAt(a.ident);
    const ms = a.role === "Departure" ? startMs : flownTo == null ? null : startMs + flownTo * 60_000;
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
    const i = airports.findIndex(a => sameField(a.ident, ident));
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
    const i = airports.findIndex(a => sameField(a.ident, ident));
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
  const listOf = (ident: string): ProcedureList | undefined => lists[airports.findIndex(a => sameField(a.ident, ident))]?.data;
  // Whether a field has procedures of a kind: by its procedures once they
  // are in (its kind's sheet opened), else by the FAA's charts its card
  // lists (d-TPP), which come with the route -- the CIFP's 53 MB is not
  // fetched for that. Not yet known, not offered: no room taken for a
  // kind a field does not have (the owner's cleanup).
  const hasKind = (ident: string, kind: Kind): boolean => {
    const i = airports.findIndex(a => sameField(a.ident, ident));
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
  // Save waits while a field's wind is still coming (lib/windPicks): its
  // runway is picked into it as it comes, and the route planned again.
  const windComing = airports.some((_, i) => (forecastFor[i] != null ? forecasts[i]?.isPending : cards[i]?.isPending) ?? false);
  useEffect(() => { useWindPicks.setState({ pending: windComing }); }, [windComing]);
  useEffect(() => () => useWindPicks.setState({ pending: false }), []);
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
  // Each point a card of its own (RouteListEdit's `cards`).
  const asCards = !!edit?.cards;
  // A field's place among the typed points, for its grip and Add a Stop
  // After: the departure first, the destination last (a round trip's
  // field is both, by its role), a stop its own place between them.
  const pointIndex = (ident: string, role: ProcedureAirport["role"]) => {
    if (!routePoints.length) return undefined;
    if (role === "Departure") return 0;
    if (role === "Destination") return routePoints.length - 1;
    const found = routePoints.findIndex((p, j) => j > 0 && j < routePoints.length - 1 && sameField(p, ident));
    return found >= 0 ? found : undefined;
  };
  // The fuel in the tanks at each point, by its row, at the owner's ask
  // ("next to airport say ... fuel", "I mean fuel in tanks"): the engine's
  // (fuel_in_tanks) -- full at the departure, the start, taxi and takeoff
  // allowance and the legs' own burn taken from them after, filled again
  // at each field landed at, as the planner checks each flight
  // (app.planning.route_totals); under the reserve, low.
  const tanks = new Map<string, { gal: number; usable: number; low: boolean }>();
  if (fuel) {
    const walked = callEngine("fuel_in_tanks", {
      points: rows.map(r => ({
        departure: r.kind === "departure", fuel_gal: r.kind === "departure" ? null : legOf(r)?.fuel_gal ?? null,
        refuel: r.kind === "stop" && r.airport.kind !== "fix",
      })),
      usable_gal: fuel.usableGal, taxi_gal: fuel.taxiGal, reserve_gal: fuel.reserveGal,
    });
    rows.forEach((r, i) => {
      const at = walked[i];
      if (at) tanks.set(r.kind === "departure" ? "departure" : r.key, { gal: at.gal, usable: fuel.usableGal, low: at.low });
    });
  }
  const points = rows.filter(r => r.kind !== "checkpoint" && r.kind !== "toc" && r.kind !== "tod");
  // The stop being added, its card before the point at its place.
  const newAt = asCards && edit?.onInsert ? edit.newAt ?? null : null;
  const field = on ? airports.find(a => sameField(a.ident, on.ident)) : undefined;
  const list = on ? listOf(on.ident) : undefined;
  const chosen = on ? pickOf(on.ident, on.kind) : null;
  // The procedure asked for by voice, its page once the field's list is
  // in: the first of that kind whose name starts as the approach does, on
  // the runway said where one was. Set as the sheet renders, as `kept`
  // is above; once set, the page is this address's and it is not again.
  const wanted = on?.pick && list && !(page && page.at === on)
    ? list.procedures.filter(p => p.kind === on.kind && p.name.toUpperCase().startsWith(on.pick!.approach)).find(p => !on.pick!.runway || p.runway === on.pick!.runway) ?? null
    : null;
  if (wanted && on) setPage({ at: on, procedure: wanted });
  const stale = list?.stale ? `Out of date: the ${cycleDate(list.cycle)} cycle, as the current one could not be had` : null;

  return {
    ...props, directTo, askHold, stopsFull, fuel, routeLine,
    page, setPage, on, procedure, editing, setEditing, fixFrom, setFixFrom, holdAt, setHoldAt,
    editingUsed, fixFromUsed, holdUsed, lesson, setLesson, lessonUsed, holdOn, heldAs, positioned,
    lists, cards, ask, startMs, landedAt, landingOf, windOf, reportedOf, listOf, hasKind, pickOf, pick, close,
    chosenAt, takeoffAt, isOpen, isFuelStop, openLines, destination, along, asCards, pointIndex,
    tanks, points, newAt, field, list, chosen, stale,
  };
}

/** FPL's route list's view model, as its parts read it. */
export type ProceduresRouteModel = ReturnType<typeof useProceduresRoute>;

/** "261001" as "1 Oct 2026". */
function cycleDate(cycle: string): string {
  const at = new Date(Date.UTC(2000 + Number(cycle.slice(0, 2)), Number(cycle.slice(2, 4)) - 1, Number(cycle.slice(4, 6))));
  return Number.isNaN(at.getTime()) ? cycle : at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
