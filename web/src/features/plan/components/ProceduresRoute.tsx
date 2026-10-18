import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Wind } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import BackButton from "../../../components/BackButton";
import CloseButton from "../../../components/CloseButton";
import { Button } from "../../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import { api } from "../../../lib/api/client";
import type { ProcedureDrawing, ProcedureList, ProcedureSummary, Runway } from "../../../lib/api/types";
import { distanceNm } from "../../../lib/geo";
import { runwayNumber, windPick, type WindPick } from "../../../lib/pattern";
import { airportQuery } from "../../../lib/queryClient";
import { kindsFor, sameField, type PickedProcedure } from "../../../lib/procedures";
import { trafficPattern } from "../../../lib/trafficPattern";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";
import { etaAt } from "../format";
import { PointMark } from "./navlog/PointMark";
import { rowPoint, type NavLogRow } from "./navlog/rows";

/** The value of a choice's "None" (no pattern, no transition): a toggle's
 *  value is a string. */
const NONE = "none";

export type ProcedureKind = ProcedureSummary["kind"];
type Kind = ProcedureKind;

const KIND_TITLE: Record<Kind, string> = { approach: "Approaches", arrival: "Arrivals", departure: "Departures" };
const KIND_ONE: Record<Kind, string> = { approach: "Approach", arrival: "Arrival", departure: "Departure" };
/** The FAA's chart codes in a field's d-TPP for each kind (its card's
 *  terminal charts, vfr.publications): an instrument approach procedure,
 *  a STAR, a departure procedure (a SID or a graphic obstacle departure)
 *  or a textual one. */
const CHART_CODES: Record<Kind, string[]> = { approach: ["IAP"], arrival: ["STAR"], departure: ["DP", "ODP"] };
/** A field's part in the flight, as its step in the list says it. */
const ROLE_STEP: Record<ProcedureAirport["role"], string> = { Departure: "Depart", Stop: "Stop", Destination: "Arrive" };

/** A procedure's data stays good for its cycle's 28 days. */
const PROCEDURE_STALE_MS = 6 * 60 * 60_000;

export interface ProcedureAirport {
  ident: string;
  role: "Departure" | "Stop" | "Destination";
  runways: Runway[] | null;
  patternAltitudeFt: number | null;
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
  airports, rows, depart, weather, picked, onPick, onCharts, chartsDisabled, procedures, inRoute, onProcedures, onPreview, at, onAt,
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
  /** The destination's approach charts, in its card. */
  onCharts: () => void;
  chartsDisabled: boolean;
  /** The instrument procedures picked (lib/procedures). */
  procedures: PickedProcedure[];
  /** Those drawn, by field and kind, as the route's box names them. */
  inRoute: { ident: string; kind: Kind; label: string }[];
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
  const lists = useQueries({
    queries: airports.map(a => ({
      queryKey: ["procedures", a.ident],
      queryFn: () => api.procedures(a.ident),
      staleTime: PROCEDURE_STALE_MS,
      enabled: at?.ident === a.ident,
    })),
  });
  // Each field's card (its weather), for the wind a field with no report
  // of its own goes by: the nearest report's (windPick).
  const cards = useQueries({ queries: airports.map(a => airportQuery(a.ident)) });
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
  const listOf = (ident: string): ProcedureList | undefined => lists[airports.findIndex(a => a.ident === ident)]?.data;
  // Whether a field has procedures of a kind: by its procedures once they
  // are in (its kind's sheet opened), else by the FAA's charts its card
  // lists (d-TPP), which come with the route -- the CIFP's 53 MB is not
  // fetched for that. Not yet known, not offered: no room taken for a
  // kind a field does not have (the owner's cleanup).
  const hasKind = (ident: string, kind: Kind): boolean => {
    const i = airports.findIndex(a => a.ident === ident);
    const list = lists[i]?.data;
    if (list) return list.procedures.some(p => p.kind === kind);
    return cards[i]?.data?.procedures.some(c => CHART_CODES[kind].includes(c.kind)) ?? false;
  };
  const kindOf = (p: PickedProcedure) => listOf(p.ident)?.procedures.find(q => q.id === p.id)?.kind;
  const pickOf = (ident: string, kind: Kind) => procedures.find(p => sameField(p.ident, ident) && kindOf(p) === kind) ?? null;
  // One of a kind at a field: a new pick there takes the old one's place.
  const pick = (ident: string, kind: Kind, next: { id: string; transition: string | null } | null) => {
    const kept = procedures.filter(p => !(sameField(p.ident, ident) && kindOf(p) === kind));
    const made = next ? { ident, ...next } : null;
    onProcedures(made ? [...kept, made] : kept, made);
  };
  const close = () => onAt(null);
  const destination = airports.find(a => a.role === "Destination");

  // A field's step: what is flown there, in the order it is flown.
  const fieldStep = (a: ProcedureAirport, row: NavLogRow | undefined, last: boolean) => {
    // A kind's row: the one in the route said at its end.
    const kindRow = (kind: Kind) => {
      const mine = inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind);
      return (
        <ListRow
          key={kind} title={KIND_ONE[kind]} chevron value={mine?.label ?? "None"}
          onClick={() => onAt({ ident: a.ident, kind })} data-testid="procedure-kind"
        />
      );
    };
    const kinds = kindsFor(a.role).filter(kind => hasKind(a.ident, kind) || inRoute.some(p => sameField(p.ident, a.ident) && p.kind === kind));
    // What is flown before the pattern (an arrival, an approach) and
    // after it (a departure).
    const before = kinds.filter(k => k !== "departure");
    const after = kinds.filter(k => k === "departure");
    return (
      <Step
        key={a.ident} last={last}
        mark={row ? <PointMark row={row} number={undefined} weather={weather} /> : <FieldDot last={last} />}
        title={`${a.ident} · ${ROLE_STEP[a.role]}`} time={row ? etaAt(depart || new Date().toISOString(), row.minutesFlown) : null} field
      >
        {before.length > 0 && <ListGroup>{before.map(kindRow)}</ListGroup>}
        <PatternChips airport={a} wind={windOf(a.ident)} chosen={picked.get(a.ident) ?? null} onPick={end => onPick(a.ident, end)} />
        {after.length > 0 && <ListGroup>{after.map(kindRow)}</ListGroup>}
      </Step>
    );
  };

  // The route's own rows where the course is in: its fields as steps and
  // the fixes flown through between them, the checkpoints and the tops of
  // climb and descent left to the nav log. Before then, the fields alone.
  const steps: ReactNode[] = [];
  const shown = new Set<string>();
  const points = rows.filter(r => r.kind !== "checkpoint" && r.kind !== "toc" && r.kind !== "tod");
  points.forEach((row, i) => {
    const last = i === points.length - 1;
    const field = "airport" in row && row.airport.kind !== "fix"
      ? airports.find(a => a.ident === row.airport.ident && !shown.has(a.ident)) : undefined;
    if (field) {
      shown.add(field.ident);
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
function Step({ mark, title, time, last, field = false, testId, children }: {
  mark: ReactNode;
  title: string;
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
        <div className="flex items-baseline justify-between gap-2">
          <Name className={cn(field ? "font-semibold" : "font-normal", TEXT.row)}>
            {title}
          </Name>
          {time && <span className={cn("font-semibold tabular-nums", TEXT.detail)}>{time}</span>}
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
  return (
    <ToggleGroup
      type="single" value={value} onValueChange={v => { if (v) onChange(v); }}
      aria-label={label} spacing={3}
      // The group's own 44 a pseudo-element behind it, as Segmented's
      // track has, so a tap just over or under a row of chips is the
      // group's and not the page's (isolate keeps it over what is round).
      className="relative isolate w-full flex-wrap after:absolute after:inset-x-0 after:-inset-y-1.5 after:-z-10 after:content-['']"
    >
      {children}
    </ToggleGroup>
  );
}

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
function PatternChips({ airport: a, wind, chosen, onPick }: {
  airport: ProcedureAirport;
  wind: WindPick | null;
  chosen: string | null;
  onPick: (end: string | null) => void;
}) {
  const ends = (a.runways ?? [])
    .filter(r => !r.closed)
    .flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e })))
    .sort((x, y) => x.end.ident.localeCompare(y.end.ident));
  const into = wind && !wind.calm ? wind.ident : null;
  const picked = ends.find(e => runwayNumber(e.end.ident) === chosen);
  // Left unless the FAA flags it right (14 CFR 91.126(b)(1)).
  const side = picked ? `${picked.end.traffic === "right" ? "Right" : "Left"} traffic` : null;
  return (
    <div className="space-y-2" data-testid="procedure-patterns">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
        <h4 className={cn("font-semibold", TEXT.detail)}>Traffic pattern</h4>
        {a.runways !== null && (
          <span className={cn("text-muted-foreground", TEXT.note)}>
            {[side, a.patternAltitudeFt != null ? `${altFt(a.patternAltitudeFt)} ft` : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      {a.runways === null ? (
        <p role="status" className={cn("px-1 text-muted-foreground", TEXT.detail)}>Looking the runways up…</p>
      ) : (
        <Chips label={`${a.ident} traffic pattern`} value={chosen ?? NONE} onChange={v => onPick(v === NONE ? null : v)}>
          <ToggleGroupItem value={NONE} className={CHIP}>None</ToggleGroupItem>
          {ends.map(({ runway, end }) => {
            const id = runwayNumber(end.ident);
            // An end with no surveyed threshold has no pattern to draw.
            const drawn = trafficPattern(a.ident, runway, end.ident, a.patternAltitudeFt) !== null;
            const windward = into === id;
            return (
              <ToggleGroupItem
                key={end.ident} value={id} disabled={!drawn} className={CHIP}
                aria-label={`Runway ${id}${windward ? ", into the wind" : ""}${drawn ? "" : ", not surveyed"}`}
                data-testid="procedure-pattern"
              >
                {windward && <Wind className="size-4" strokeWidth={2.2} aria-hidden />}
                {id}
              </ToggleGroupItem>
            );
          })}
        </Chips>
      )}
      {wind && <WindComponents wind={wind} />}
    </div>
  );
}

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
          mine ? `In the route${mine.transition ? `, via ${mine.transition}` : kind === "approach" ? ", from vectors" : ""}` : null,
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
              {kind === "approach" ? "Vectors" : "None"}
            </ToggleGroupItem>
            {procedure.transitions.map(t => (
              <ToggleGroupItem key={t} value={t} className={CHIP} data-testid="procedure-transition">{t}</ToggleGroupItem>
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
