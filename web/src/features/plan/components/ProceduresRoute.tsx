import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Info, Wind } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import BackButton from "../../../components/BackButton";
import CloseButton from "../../../components/CloseButton";
import { Button } from "../../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { api } from "../../../lib/api/client";
import type { AircraftProfile, ProcedureDrawing, ProcedureList, ProcedureSummary, Runway } from "../../../lib/api/types";
import { distanceNm } from "../../../lib/geo";
import { runwayNumber, windPick, type RunwayEnd, type WindPick } from "../../../lib/pattern";
import { airportQuery, plateQuery } from "../../../lib/queryClient";
import { approachRunway, sameField, transitionWords, type PickedProcedure } from "../../../lib/procedures";
import { NO_PATTERN, trafficPattern } from "../../../lib/trafficPattern";
import { TEXT } from "../../../lib/text";
import { altFt, bearing, grouped } from "../../../lib/units";
import { endFit, type EndFit } from "../../../lib/runwayFit";
import { etaAt } from "../format";
import { PointMark } from "./navlog/PointMark";
import ProcedureMenu from "./ProcedureMenu";
import { rowPoint, type NavLogRow } from "./navlog/rows";

/** The value of a choice's "None" (no pattern, no transition): a toggle's
 *  value is a string. */
const NONE = "none";

export type ProcedureKind = ProcedureSummary["kind"];
type Kind = ProcedureKind;

const KIND_TITLE: Record<Kind, string> = { approach: "Approaches", arrival: "Arrivals", departure: "Departures" };
/** The FAA's chart codes in a field's d-TPP for each kind (its card's
 *  terminal charts, vfr.publications, as the d-TPP metafile's chart_code
 *  has them): an instrument approach procedure, a STAR ("STR"), a
 *  departure procedure (a SID or a graphic obstacle departure) or a
 *  textual one. */
const CHART_CODES: Record<Kind, string[]> = { approach: ["IAP"], arrival: ["STR"], departure: ["DP", "ODP"] };

/** A procedure's data stays good for its cycle's 28 days. */
const PROCEDURE_STALE_MS = 6 * 60 * 60_000;

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
  airports, rows, depart, weather, picked, onPick, onPreselect, takeoffs, onTakeoff, fit = null, onCharts, chartsDisabled, procedures, inRoute, onProcedures, onPreview, at, onAt,
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
  inRoute: { ident: string; kind: Kind; id: string; runway: string | null; label: string; fixes?: string[] }[];
  /** All of them as they are to be, and the one just picked, for the map
   *  to go to. */
  onProcedures: (next: PickedProcedure[], picked: PickedProcedure | null) => void;
  /** The procedure on its page, not yet added, for the map to draw and go
   *  to; null as the page is left. */
  onPreview: (procedure: PickedProcedure | null) => void;
  /** The sheet's kind and field, null while it is put away. */
  at: ProceduresAt;
  onAt: (at: ProceduresAt) => void;
}) {
  // The procedure on its own page in the sheet, over its kind's list.
  const [page, setPage] = useState<{ at: ProceduresAt; procedure: ProcedureSummary } | null>(null);
  // What the sheet shows, kept as it eases away: its title went back to
  // "Procedures" and its page to nothing as it was put away.
  const [kept, setKept] = useState<ProceduresAt>(at);
  if (at && at !== kept) setKept(at);
  const on = at ?? kept;
  const procedure = page && page.at === on ? page.procedure : null;
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
    const card = cards[i]?.data;
    const near = card && !card.metar ? card.nearby_metar : null;
    return windPick(runways, near ? {
      station: near.ident, distanceNm: near.distance_nm,
      dirTrueDeg: near.metar.wind_dir_true_deg, speedKt: near.metar.wind_speed_kt, gustKt: near.metar.wind_gust_kt,
    } : null);
  };
  // The wind a field reports, else the nearest report's, as the METAR
  // gives it: from true north (FAA Order JO 7900.5), marked "T" beside the
  // runways' magnetic numbers, where a tower's and an ATIS's winds are
  // magnetic (AIM 4-1-13) -- the audit's finding.
  const reportedOf = (ident: string): Reported | null => {
    const card = cards[airports.findIndex(a => a.ident === ident)]?.data;
    const m = card?.metar ?? card?.nearby_metar?.metar;
    if (!m || m.wind_speed_kt == null) return null;
    if (!m.wind_speed_kt) return "calm";
    const kt = Math.round(m.wind_speed_kt), gust = m.wind_gust_kt ? Math.round(m.wind_gust_kt) : null;
    return {
      dir: m.wind_dir_true_deg == null ? "VRB" : `${bearing(m.wind_dir_true_deg)}T`, speed: gust ? `${kt}G${gust}` : `${kt}`,
      spoken: `${m.wind_dir_true_deg == null ? "variable" : `${Math.round(m.wind_dir_true_deg)} true`} at ${kt} knots${gust ? `, gusts ${gust}` : ""}`,
    };
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
  // The runway picked at a field, none where the pilot picked none; and a
  // stop's to leave from.
  const chosenAt = (ident: string) => {
    const end = picked.get(ident) ?? null;
    return end === NO_PATTERN ? null : end;
  };
  const takeoffAt = (ident: string) => {
    const end = takeoffs.get(ident) ?? null;
    return end === NO_PATTERN ? null : end;
  };
  // Each field of the route, its runway picked into the wind until the
  // pilot picks one or none, at the owner's ask ("a preselected runway into
  // the wind", "Departing runway should also be pre selected"): most fly
  // the runway ATC gives them with no approach, so no approach is picked.
  // Once a field, so a runway picked and taken back is not picked again
  // under the pilot's finger.
  const preselected = useRef(new Set<string>());
  // A field listed twice (a round trip) picks its landing's runway once.
  const preselectedLand = (a: ProcedureAirport) => airports.findIndex(b => sameField(b.ident, a.ident)) !== airports.indexOf(a);
  const intoWind = airports.flatMap(a => {
    const wind = windOf(a.ident);
    if (!wind || wind.calm) return [];
    return [
      ...(picked.has(a.ident) || landingOf(a.ident) || preselectedLand(a) ? [] : [`land:${a.ident}:${wind.ident}`]),
      // A stop's runway to leave from, into the wind as its landing's.
      ...((a.role !== "Stop" && !(a.role === "Departure" && airports.some(b => b !== a && b.role === "Destination" && sameField(b.ident, a.ident))))
        || takeoffs.has(a.ident) ? [] : [`takeoff:${a.ident}:${wind.ident}`]),
    ];
  }).join(",");
  useEffect(() => {
    for (const pick of intoWind ? intoWind.split(",") : []) {
      const [which, ident, end] = pick.split(":") as [string, string, string];
      if (preselected.current.has(`${which}:${ident}`)) continue;
      preselected.current.add(`${which}:${ident}`);
      if (which === "land") onPreselect(ident, end); else onTakeoff(ident, end);
    }
  }, [intoWind, onPreselect, onTakeoff]);
  const destination = airports.find(a => a.role === "Destination");

  // A field's step: what is flown there, in the order it is flown.
  const fieldStep = (a: ProcedureAirport, row: NavLogRow | undefined, last: boolean) => {
    // A kind's pull-down: the one in the route said on it (ProcedureMenu).
    const wind = windOf(a.ident);
    const i = airports.findIndex(f => f.ident === a.ident);
    const kindMenu = (kind: Kind) => (
      <ProcedureMenu
        key={kind} ident={a.ident} kind={kind} list={lists[i]?.data} loading={!!lists[i]?.isFetching}
        picked={pickOf(a.ident, kind)} label={inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind)?.label ?? null}
        fixes={inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind)?.fixes}
        runway={chosenAt(a.ident)} windward={wind && !wind.calm ? wind.ident : null}
        onOpen={() => ask(a.ident)} onPick={next => pick(a.ident, kind, next)} onAll={() => onAt({ ident: a.ident, kind })}
      />
    );
    const has = (kind: Kind) => hasKind(a.ident, kind) || inRoute.some(p => sameField(p.ident, a.ident) && p.kind === kind);
    const time = row ? etaAt(depart || new Date().toISOString(), row.minutesFlown) : null;
    const mark = row ? <PointMark row={row} number={undefined} weather={weather} /> : <FieldDot last={last} />;
    // A step of the field's: the procedures' pull-downs in its head, by its
    // ident in the place of "Depart" or "Arrive", where it has any, at the
    // owner's ask ("replace the Depart/Arrival label with the
    // Departure/Arrival selection when available. Approach can be next to
    // Arrival"); its runway chips under, its info at their start ("Info
    // can go on the left side of the runways").
    const step = (role: "Arrive" | "Depart", kinds: Kind[], chips: ReactNode, isLast: boolean, stepMark: ReactNode, stepTime: string | null) => (
      <Step
        key={`${a.ident}-${role}`} last={isLast} mark={stepMark}
        title={`${a.ident} · ${role}`} time={stepTime} field
        heading={kinds.length > 0 ? a.ident : undefined} beside={kinds.length > 0 ? kinds.map(kindMenu) : undefined}
      >
        {chips}
      </Step>
    );
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
    const ends = (a.runways ?? []).filter(r => !r.closed).flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e })));
    const chosenFit = (chosen: string | null, kind: "takeoff" | "landing") => {
      const e = ends.find(x => runwayNumber(x.end.ident) === chosen);
      return e ? fitOf(kind)(e.runway, e.end) : null;
    };
    // Every runway's crosswind past the demonstrated: the wind said in red.
    const allOver = !!fit && ends.length > 0 && ends.every(e => fitOf("landing")(e.runway, e.end)?.crosswindOver);
    const chips = (kind: "takeoff" | "landing", chosen: string | null, landing: Landing | null, note: string | null, pick: (end: string | null) => void, label?: string) => (
      <PatternChips
        airport={a} wind={wind} chosen={chosen} landing={landing} label={label} onPick={pick} fitOf={fitOf(kind)}
        info={<FieldInfo ident={a.ident} note={note} wind={wind} reported={reportedOf(a.ident)} fit={chosenFit(chosen, kind)} kind={kind} demonstratedKt={fit?.aircraft.crosswind?.demonstrated_kt ?? null} allOver={allOver} />}
      />
    );
    const landingChips = chips("landing", chosenAt(a.ident), landingOf(a.ident), patternNote(a, chosenAt(a.ident), landingOf(a.ident)), end => onPick(a.ident, end ?? NO_PATTERN));
    // A round trip's departure is left from its own runway (`takeoff`), the
    // field's pattern the landing's, as a stop's are.
    const roundTrip = a.role === "Departure" && airports.some(b => b !== a && b.role === "Destination" && sameField(b.ident, a.ident));
    const departChips = roundTrip
      ? chips("takeoff", takeoffAt(a.ident), null, takeoffAt(a.ident) ? `Runway ${takeoffAt(a.ident)}` : null,
        end => onTakeoff(a.ident, end ?? NO_PATTERN), `${a.ident} takeoff runway`)
      : chips("takeoff", chosenAt(a.ident), null, patternNote(a, chosenAt(a.ident), null), end => onPick(a.ident, end ?? NO_PATTERN));
    const takeoffChips = chips("takeoff", takeoffAt(a.ident), null, takeoffAt(a.ident) ? `Runway ${takeoffAt(a.ident)}` : null,
      end => onTakeoff(a.ident, end ?? NO_PATTERN), `${a.ident} takeoff runway`);
    if (a.role === "Departure") return step("Depart", (["departure"] as Kind[]).filter(has), departChips, last, mark, time);
    if (a.role === "Destination") return step("Arrive", (["arrival", "approach"] as Kind[]).filter(has), landingChips, last, mark, time);
    // A stop is landed at and left again, each with its own runway, at the
    // owner's ask ("If a stop is an airport then it should have arrival
    // first with a runway and a separate departure with a runway"): two
    // steps, the pattern drawn the landing's.
    return [
      step("Arrive", (["arrival", "approach"] as Kind[]).filter(has), landingChips, false, mark, time),
      step("Depart", (["departure"] as Kind[]).filter(has), takeoffChips, last, <FieldDot last={last} />, null),
    ];
  };

  // The route's own rows where the course is in: its fields as steps and
  // the fixes flown through between them, the checkpoints and the tops of
  // climb and descent left to the nav log. Before then, the fields alone.
  const steps: ReactNode[] = [];
  const shown = new Set<ProcedureAirport>();
  const points = rows.filter(r => r.kind !== "checkpoint" && r.kind !== "toc" && r.kind !== "tod");
  points.forEach((row, i) => {
    const last = i === points.length - 1;
    // By the field, not its spelling: a stop typed UES comes back from the
    // planner as KUES. A round trip's field twice, its departure first.
    const field = "airport" in row && row.airport.kind !== "fix"
      ? airports.find(a => sameField(a.ident, row.airport.ident) && !shown.has(a)) : undefined;
    if (field) {
      shown.add(field);
      steps.push(fieldStep(field, row, last));
      return;
    }
    steps.push(
      <Step
        key={row.key} last={last} mark={<PointMark row={row} number={undefined} weather={weather} />}
        title={rowPoint(row).name} time={etaAt(depart || new Date().toISOString(), row.minutesFlown)}
        testId={`route-${row.kind}`}
      />,
    );
  });
  const fieldsAlone = rows.length === 0 ? airports.map((a, i) => fieldStep(a, undefined, i === airports.length - 1)) : null;

  const field = on ? airports.find(a => a.ident === on.ident) : undefined;
  const list = on ? listOf(on.ident) : undefined;
  const chosen = on ? pickOf(on.ident, on.kind) : null;
  const stale = list?.stale ? `Out of date: the ${cycleDate(list.cycle)} cycle, as the current one could not be had` : null;
  return (
    <ResponsivePopover open={!!at} onOpenChange={open => { if (!open) close(); }}>
      <ResponsivePopoverAnchor asChild>
        <ol className="pt-2 pb-1" aria-label="The route" data-testid="procedures">{fieldsAlone ?? steps}</ol>
      </ResponsivePopoverAnchor>
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

/**
 * One step down the line the flight takes: its mark on the line, as the
 * nav log draws it, its name and the time it is reached, and under them
 * what is flown there (a field's). The line runs on to the next step.
 */
function Step({ mark, title, heading, beside, time, last, field = false, testId, children }: {
  mark: ReactNode;
  /** Its name, said to a screen reader and shown where `heading` is not. */
  title: string;
  /** What its head shows in the title's place: a field's ident alone,
   *  its procedures' pull-downs (`beside`) saying the rest. */
  heading?: string;
  beside?: ReactNode;
  time: string | null;
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
        <div className="flex items-center justify-between gap-2">
          {/* On one line, the pull-downs giving way, their words cut short,
              before the line wraps: half way the list is in the foot, a
              little narrower than the body all the way up. */}
          <span className="flex min-w-0 items-center gap-2">
            <Name className={cn(field ? "font-semibold" : "font-normal", TEXT.row)}>
              {heading ?? title}
            </Name>
            {beside}
          </span>
          {time && <span className={cn("shrink-0 font-semibold tabular-nums", TEXT.detail)}>{time}</span>}
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
function Chips({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  // The chip chosen in sight: one past the row's end (O'Hare's 9L of
  // eight runways) scrolled in, sideways only.
  useEffect(() => {
    const box = row.current, on = box?.querySelector<HTMLElement>("[data-state=on]");
    if (!box || !on) return;
    const edge = box.getBoundingClientRect(), chip = on.getBoundingClientRect();
    if (chip.right > edge.right) box.scrollLeft += chip.right - edge.right + CHIP_GAP_PX;
    else if (chip.left < edge.left) box.scrollLeft -= edge.left - chip.left + CHIP_GAP_PX;
  }, [value]);
  return (
    // One line, scrolled sideways where the chips are more than fit, at
    // the owner's ask; the padding keeps the chips' and the group's tap
    // areas inside what the scroll clips.
    <div ref={row} data-slides="" className="-mx-1.5 -my-1.5 min-w-0 flex-1 overflow-x-auto px-1.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ToggleGroup
        type="single" value={value} onValueChange={v => { if (v) onChange(v); }}
        aria-label={label} spacing={3}
        // The group's own 44 a pseudo-element behind it, as Segmented's
        // track has, so a tap just over or under a row of chips is the
        // group's and not the page's (isolate keeps it over what is round).
        className="relative isolate w-max min-w-full flex-nowrap after:absolute after:inset-x-0 after:-inset-y-1.5 after:-z-10 after:content-['']"
      >
        {children}
      </ToggleGroup>
    </div>
  );
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
 * A field's traffic pattern, picked by its runway as a chip, or None: the
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

function PatternChips({ airport: a, wind, chosen, landing, info, label, fitOf, onPick }: {
  airport: ProcedureAirport;
  /** Each end's fit today, marked on its chip (lib/runwayFit). */
  fitOf: (runway: Runway, end: RunwayEnd) => EndFit | null;
  /** The chips' name to a screen reader, where not the pattern's. */
  label?: string;
  /** At the chips' start: the field's info (FieldInfo). */
  info: ReactNode;
  wind: WindPick | null;
  chosen: string | null;
  landing: Landing | null;
  onPick: (end: string | null) => void;
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
  return (
    // The chips alone, the pattern's side and height and the wind behind
    // the field's info (FieldInfo), at the owner's ask ("Keep the pattern
    // info and winds info in a info icon next to the airport id").
    <div className="flex items-center gap-2" data-testid="procedure-patterns">
      {a.runways !== null && info}
      {a.runways === null ? (
        <p role="status" className={cn("px-1 text-muted-foreground", TEXT.detail)}>Looking the runways up…</p>
      ) : (
        <Chips label={label ?? `${a.ident} ${landing ? "runway" : "traffic pattern"}`} value={chosen ?? NONE} onChange={v => onPick(v === NONE ? null : v)}>
          {/* An approach to a runway lands on one: none is no choice then. */}
          <ToggleGroupItem value={NONE} disabled={straightIn !== null} className={CHIP}>None</ToggleGroupItem>
          {ends.map(({ runway, end }) => {
            const id = runwayNumber(end.ident);
            // An end with no surveyed threshold has no pattern to draw;
            // with an approach, none is drawn, and the end is the approach's
            // own or one it may circle to.
            const drawn = trafficPattern(a.ident, runway, end.ident, a.patternAltitudeFt) !== null;
            const windward = into === id;
            const circleNa = !allowed(id);
            // Too short in red, a crosswind past the demonstrated or a
            // length inside the margin in amber: a ring, the chip not grown.
            const fitted = fitOf(runway, end);
            const ring = fitted?.short ? "ring-2 ring-destructive" : fitted && (fitted.crosswindOver || fitted.close) ? "ring-2 ring-amber-500" : undefined;
            const said = fitted?.short ? ", too short today" : fitted?.close ? ", little to spare in length" : "";
            return (
              <ToggleGroupItem
                key={end.ident} value={id} disabled={circleNa || (!landing && !drawn)} className={cn(CHIP, ring)}
                aria-label={`Runway ${id}${windward ? ", into the wind" : ""}${fitted?.crosswindOver ? `, crosswind ${fitted.crosswindKt} knots, past the airplane's demonstrated` : ""}${said}${circleNa ? `, no circling on the ${landing!.name}` : !landing && !drawn ? ", not surveyed" : ""}`}
                data-testid="procedure-pattern" data-fit={fitted?.short ? "short" : fitted?.crosswindOver ? "crosswind" : fitted?.close ? "close" : undefined}
              >
                {windward && <Wind className="size-4" strokeWidth={2.2} aria-hidden />}
                {id}
              </ToggleGroupItem>
            );
          })}
        </Chips>
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

/**
 * A field's info, an (i) by its name in the route's list: the runway's
 * pattern -- its side and height, or how the approach lands -- and the
 * wind on the runway it favours (WindComponents), out of the list's way,
 * at the owner's ask ("Keep the pattern info and winds info in a info icon
 * next to the airport id"), so the list is compact.
 */
function FieldInfo({ ident, note, wind, reported, fit, kind, demonstratedKt, allOver }: {
  ident: string;
  note: string | null;
  wind: WindPick | null;
  reported: Reported | null;
  /** The runway picked's fit today, said under its note (lib/runwayFit). */
  fit: EndFit | null;
  kind: "takeoff" | "landing";
  demonstratedKt: number | null;
  /** Every runway's crosswind past the airplane's demonstrated. */
  allOver: boolean;
}) {
  if (!note && !wind && !reported) return null;
  const distance = fit?.neededFt != null && fit.lengthFt != null
    ? `${kind === "takeoff" ? "Takeoff" : "Landing"} over 50 ft: ${grouped(fit.neededFt)} ft of ${grouped(fit.lengthFt)}` : null;
  return (
    <>
      {/* On a phone a sheet, as the app's other panels over the map are
          (ResponsivePopover); beside the trigger from md up. */}
      <ResponsivePopover>
        <ResponsivePopoverTrigger asChild>
          {/* The field's wind itself, in the tint as what is tapped, its
              direction over its speed, at the owner's pick ("2 · The wind
              itself"); the bare (i) with none to say. Its 44 points a
              pseudo-element round it, nothing grown. */}
          <button
            type="button" data-testid="field-info"
            aria-label={`${ident} wind ${reported === "calm" ? "calm" : reported ? reported.spoken : "not reported"}, runway and wind`}
            className={cn("relative flex h-9 min-w-9 shrink-0 flex-col items-center justify-center after:absolute after:-inset-x-1 after:-inset-y-1 after:content-['']", allOver ? "text-destructive-ink" : "text-tint")}
            data-over={allOver || undefined}
          >
            {reported === "calm" ? (
              <span className={cn("font-semibold", TEXT.note)}>Calm</span>
            ) : reported ? (
              <span className="flex flex-col items-center leading-[1.05] tabular-nums" aria-hidden>
                <span className={cn("font-semibold leading-[1.05]", TEXT.detail)}>{reported.dir}</span>
                <span className={cn("leading-[1.05]", TEXT.note)}>{reported.speed} kt</span>
              </span>
            ) : (
              <Info className="size-5" aria-hidden />
            )}
          </button>
        </ResponsivePopoverTrigger>
        <ResponsivePopoverContent title={`${ident} runway and wind`} align="start" className="w-auto max-w-[min(20rem,calc(100vw-2rem))] space-y-2 p-3" data-testid="field-info-content">
          {note && <p className={cn("font-semibold", TEXT.detail)} data-testid="procedure-landing">{note}</p>}
          {distance && (
            <p className={cn(TEXT.note, fit?.short ? "font-semibold text-destructive-ink" : fit?.close ? "font-semibold" : "text-muted-foreground")} data-testid="field-info-distance">
              {distance}{fit?.short ? ", too short" : fit?.close ? ", under 15% to spare" : ""}
            </p>
          )}
          {fit?.crosswindOver && demonstratedKt != null && (
            <p className={cn("font-semibold", TEXT.note)} data-testid="field-info-crosswind">Crosswind {fit.crosswindKt} kt, past the airplane&apos;s demonstrated {demonstratedKt}</p>
          )}
          {allOver && demonstratedKt != null && (
            <p className={cn("font-semibold text-destructive-ink", TEXT.note)}>Every runway&apos;s crosswind is past the demonstrated {demonstratedKt} kt</p>
          )}
          {wind && <WindComponents wind={wind} />}
        </ResponsivePopoverContent>
      </ResponsivePopover>
      {/* A hairline between the wind and the runways. */}
      <span aria-hidden="true" className="h-[26px] w-px shrink-0 bg-[rgba(60,60,67,0.22)] dark:bg-border" />
    </>
  );
}

/** A field's reported wind as its info's trigger writes it: "240°" over
 *  "12G20" (knots), calm, or none. */
type Reported = "calm" | { dir: string; speed: string; spoken: string };

/**
 * The wind on the runway it favours, as symbols, at the owner's ask ("the
 * notes about wind can be a symbol for head/cross components"): an arrow
 * down the runway at the pilot, green, for a headwind (up, red, for a
 * tailwind), and one across it, the way the wind blows, for the
 * crosswind and its gusts -- the colours ForeFlight's runway list gives
 * them. Where the field reports none, the station it is from beside them,
 * small: it is not the field's own. Said in words to a screen reader.
 */
function WindComponents({ wind }: { wind: WindPick }) {
  const words = windWords(wind);
  if (wind.calm) {
    return <p className={cn("px-1 text-muted-foreground", TEXT.note)} data-testid="procedure-wind">{words}</p>;
  }
  const cross = Math.abs(wind.crosswindKt), gust = wind.gustCrosswindKt == null ? null : Math.abs(wind.gustCrosswindKt);
  // From the right (windPick's sign), it blows across to the left.
  const Across = wind.crosswindKt > 0 ? ArrowLeft : ArrowRight;
  const Along = wind.headwindKt >= 0 ? ArrowDown : ArrowUp;
  return (
    <p className={cn("flex items-center gap-3 px-1 tabular-nums", TEXT.detail)} aria-label={words} role="img" data-testid="procedure-wind">
      <span className={cn("inline-flex items-center gap-0.5 font-semibold", wind.headwindKt >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
        <Along className="size-4" strokeWidth={2.5} aria-hidden />{Math.abs(wind.headwindKt)}
      </span>
      {(cross > 0 || (gust ?? 0) > 0) && (
        <span className="inline-flex items-center gap-0.5 font-semibold text-muted-foreground">
          <Across className="size-4" strokeWidth={2.5} aria-hidden />{cross}{gust != null ? `G${gust}` : ""}
        </span>
      )}
      <span className="text-muted-foreground">kt</span>
      {wind.from && <span className={cn("ml-auto text-muted-foreground", TEXT.note)}>{`${wind.from.ident} wind, ${wind.from.nm} nm`}</span>}
    </p>
  );
}

/** "24 into the wind: headwind 8 kt, crosswind 2 kt (KUGN, 11 nm)", or
 *  "Wind calm": what a field's wind symbols say, in words. */
function windWords(wind: WindPick): string {
  const from = wind.from ? ` (${wind.from.ident}, ${wind.from.nm} nm)` : "";
  if (wind.calm) return `Wind calm${from}`;
  const cross = Math.abs(wind.crosswindKt), gust = wind.gustCrosswindKt == null ? null : Math.abs(wind.gustCrosswindKt);
  const across = cross > 0 || (gust ?? 0) > 0 ? `, crosswind ${cross}${gust != null ? ` gusting ${gust}` : ""} kt` : "";
  const along = wind.headwindKt >= 0 ? `headwind ${wind.headwindKt} kt` : `tailwind ${-wind.headwindKt} kt`;
  return `${wind.ident} into the wind: ${along}${across}${from}`;
}

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
            <span className="text-[0.6875rem] leading-[0.8125rem] font-bold tracking-wide text-tint">{f.roles.find(r => FIX_ROLES.includes(r)) ?? ""}</span>
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
