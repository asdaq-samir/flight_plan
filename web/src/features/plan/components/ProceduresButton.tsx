import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Check, PlaneLanding, Wind } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import BackButton from "../../../components/BackButton";
import CloseButton from "../../../components/CloseButton";
import RoundButton from "../../../components/RoundButton";
import { Button } from "../../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { api } from "../../../lib/api/client";
import type { ProcedureDrawing, ProcedureList, ProcedureSummary, Runway } from "../../../lib/api/types";
import { distanceNm } from "../../../lib/geo";
import { runwayInUse, runwayNumber } from "../../../lib/pattern";
import { kindsFor, sameField, type PickedProcedure } from "../../../lib/procedures";
import { trafficPattern } from "../../../lib/trafficPattern";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";

/** The value of a choice's "None" (no pattern, no transition): a toggle's
 *  value is a string. */
const NONE = "none";

type Kind = ProcedureSummary["kind"];

const KIND_TITLE: Record<Kind, string> = { approach: "Approaches", arrival: "Arrivals", departure: "Departures" };
const KIND_ONE: Record<Kind, string> = { approach: "Approach", arrival: "Arrival", departure: "Departure" };
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

/** The page of the sheet in sight: the route's fields, one kind of a
 *  field's procedures, or one procedure, each with its title. */
type Page = { ident: string; kind: Kind; title: string; procedure?: ProcedureSummary } | null;

/**
 * The route's Procedures, at the pilot's ask, where its Approaches were,
 * laid out in the order the flight meets them, at the owner's pick (the
 * redesign's C, 2026-10-17): each field of the route a step down a line,
 * holding what is flown there in turn -- a departure's pattern and then
 * its departure, a destination's arrival and approach and then its
 * pattern, a stop's all of them. A pattern is picked by its runway, as a
 * chip, the runway the wind favours marked (the redesign's A); it is drawn
 * on the map (PatternLayer). An instrument procedure from the FAA's CIFP
 * (vfr.procedures) is picked on pages of its own, as ForeFlight's
 * Procedure Advisor picks one: the field's of that kind, then the one
 * procedure, its transition chosen, the map above the sheet drawing it as
 * it is chosen (`onPreview`, ProcedureLayer), its fixes listed, and Add to
 * Route at the foot. Back is the round button at the head's start, the
 * close's twin, at the owner's ask, as the floating sheet's cards have it.
 */
export default function ProceduresButton({
  airports, picked, onPick, onCharts, chartsDisabled, procedures, onProcedures, onPreview, open: asked, onOpenChange,
}: {
  airports: ProcedureAirport[];
  /** The runway end picked for each field's pattern. */
  picked: Map<string, string>;
  onPick: (ident: string, end: string | null) => void;
  /** The destination's approach charts, in its card. */
  onCharts: () => void;
  chartsDisabled: boolean;
  /** The instrument procedures picked (lib/procedures). */
  procedures: PickedProcedure[];
  /** All of them as they are to be, and the one just picked, for the map
   *  to go to. */
  onProcedures: (next: PickedProcedure[], picked: PickedProcedure | null) => void;
  /** The procedure on its page, not yet added, for the map to draw and go
   *  to; null as the page is left. */
  onPreview: (procedure: PickedProcedure | null) => void;
  /** Opened from elsewhere too -- a procedure's chip in the route's box --
   *  where these are given. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = asked ?? own;
  // Each opening starts at the route's fields, as a pushed page is left
  // behind when an iOS sheet is put away.
  const [page, setPage] = useState<Page>(null);
  const setOpen = (next: boolean) => {
    setOwn(next);
    if (!next) setPage(null);
    onOpenChange?.(next);
  };
  // One level back: from a procedure to its kind's list, from there to
  // the fields.
  const back = () => setPage(p => (p?.procedure ? { ident: p.ident, kind: p.kind, title: listTitle(p.ident, p.kind) } : null));
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <RoundButton label="Procedures" disabled={airports.length === 0} data-testid="route-approaches">
          <PlaneLanding className="size-5" strokeWidth={2} />
        </RoundButton>
      </ResponsivePopoverTrigger>
      {/* On a phone a sheet that keeps its height from page to page, as
          an iOS sheet does pushing one: sized to each page, it dropped
          from nearly the screen's height to a few rows and back. Half the
          screen (PROCEDURES_SHEET), the map above it in sight and clear --
          no shade over it -- as a procedure is picked, as ForeFlight's
          Procedure Advisor keeps it, at the owner's pick. */}
      <ResponsivePopoverContent
        title={page?.title ?? "Procedures"} className="max-h-[70vh] w-80 overflow-y-auto p-3" align="end" side="left"
        leading={page ? <BackButton onClick={back} data-testid="procedures-back" /> : undefined}
        // Its close at the title's end, as ForeFlight's Procedure Advisor
        // and every other panel have one (the commonality audit's C-4):
        // the sheet had none, put away only by a tap on the map or Escape.
        action={<CloseButton onClick={() => setOpen(false)} data-testid="procedures-close" />}
        sheetClassName="data-[side=bottom]:h-[55dvh] data-[side=top]:h-[55dvh]"
        sheetOverlayClassName="bg-transparent dark:bg-transparent supports-backdrop-filter:backdrop-blur-none"
      >
        <ProceduresSheet
          airports={airports} picked={picked} onPick={onPick} onCharts={onCharts} chartsDisabled={chartsDisabled}
          procedures={procedures} onProcedures={onProcedures} onPreview={onPreview} close={() => setOpen(false)}
          page={page} onPage={setPage}
        />
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

/** "KDLH approaches": a kind's list's title. */
function listTitle(ident: string, kind: Kind): string {
  return `${ident} ${KIND_TITLE[kind].toLowerCase()}`;
}

/**
 * What the Procedures sheet holds, drawn only while it is out: each
 * field's runway ends and its patterns, worked out for every field on
 * every render of the button, were 85 ms of the half sheet's opening at a
 * phone's speed with the sheet shut (profiled 2026-10-12).
 */
function ProceduresSheet({ airports, picked, onPick, onCharts, chartsDisabled, procedures, onProcedures, onPreview, close, page, onPage }: {
  airports: ProcedureAirport[];
  picked: Map<string, string>;
  onPick: (ident: string, end: string | null) => void;
  onCharts: () => void;
  chartsDisabled: boolean;
  procedures: PickedProcedure[];
  onProcedures: (next: PickedProcedure[], picked: PickedProcedure | null) => void;
  onPreview: (procedure: PickedProcedure | null) => void;
  close: () => void;
  page: Page;
  onPage: (page: Page) => void;
}) {
  const destination = airports.find(a => a.role === "Destination");
  // Each field's procedures, asked for once the button is opened.
  const lists = useQueries({
    queries: airports.map(a => ({
      queryKey: ["procedures", a.ident],
      queryFn: () => api.procedures(a.ident),
      staleTime: PROCEDURE_STALE_MS,
    })),
  });
  // The pick of a kind at a field, among those kept.
  const listOf = (ident: string): ProcedureList | undefined => lists[airports.findIndex(a => a.ident === ident)]?.data;
  const kindOf = (p: PickedProcedure) => listOf(p.ident)?.procedures.find(q => q.id === p.id)?.kind;
  const pickOf = (ident: string, kind: Kind) => procedures.find(p => sameField(p.ident, ident) && kindOf(p) === kind) ?? null;
  // One of a kind at a field: a new pick there takes the old one's place.
  const pick = (ident: string, kind: Kind, next: { id: string; transition: string | null } | null) => {
    const kept = procedures.filter(p => !(sameField(p.ident, ident) && kindOf(p) === kind));
    const made = next ? { ident, ...next } : null;
    onProcedures(made ? [...kept, made] : kept, made);
  };

  if (page) {
    const a = airports.find(f => f.ident === page.ident);
    const list = listOf(page.ident);
    const chosen = pickOf(page.ident, page.kind);
    const stale = list?.stale ? `Out of date: the ${cycleDate(list.cycle)} cycle, as the current one could not be had` : null;
    // The page opens on its title's heading for a screen reader, as a
    // pushed page does (ConsolePages); the key starts each page afresh.
    return page.procedure ? (
      <ProcedurePage
        key={`${page.ident}:${page.procedure.id}`}
        kind={page.kind} ident={page.ident} procedure={page.procedure}
        chosen={chosen?.id === page.procedure.id ? chosen : null} stale={stale}
        onAdd={transition => { pick(page.ident, page.kind, { id: page.procedure!.id, transition }); close(); }}
        onRemove={() => pick(page.ident, page.kind, null)} onPreview={onPreview}
        onChart={a === destination && !chartsDisabled ? () => { close(); onCharts(); } : null}
      />
    ) : (
      <ProcedurePicker
        key={`${page.ident}:${page.kind}`}
        kind={page.kind} list={list} chosen={chosen} stale={stale} intoWind={a?.runways ? windwardEnd(a.runways) : null}
        onOpen={p => onPage({ ident: page.ident, kind: page.kind, title: `${page.ident} ${p.name}`, procedure: p })}
      />
    );
  }

  return (
    <ol className="space-y-0" data-testid="procedures">
      {airports.map((a, i) => {
        const list = lists[i];
        // A kind's row: the one picked said at its end, "None published"
        // where the field has none of that kind.
        const kindRow = (kind: Kind) => {
          const of = list?.data?.procedures.filter(p => p.kind === kind) ?? [];
          const mine = pickOf(a.ident, kind);
          const name = mine && of.find(p => p.id === mine.id)?.name;
          if (list?.isError) return null;
          return list?.data && of.length === 0 ? (
            <ListRow key={kind} title={KIND_ONE[kind]} value="None published" disabled />
          ) : (
            <ListRow
              key={kind} title={KIND_ONE[kind]} chevron disabled={!list?.data}
              value={!list?.data ? "…" : name ? `${name}${mine?.transition ? ` via ${mine.transition}` : ""}` : "None"}
              onClick={() => onPage({ ident: a.ident, kind, title: listTitle(a.ident, kind) })}
              data-testid="procedure-kind"
            />
          );
        };
        const kinds = kindsFor(a.role);
        // What is flown before the pattern (an arrival, an approach) and
        // after it (a departure), each in the order the flight meets it.
        const before = kinds.filter(k => k !== "departure");
        const after = kinds.filter(k => k === "departure");
        const failed = list?.isError
          ? <ListRow title={<span className="text-muted-foreground">The FAA's procedures could not be had</span>} />
          : null;
        const charts = a === destination
          ? (
            <ListRow
              title="Approach charts" chevron disabled={chartsDisabled}
              onClick={() => { close(); onCharts(); }} data-testid="procedure-charts"
            />
          )
          : null;
        return (
          <FieldStep key={a.ident} title={`${a.ident} · ${ROLE_STEP[a.role]}`} last={i === airports.length - 1}>
            {before.length > 0 && <ListGroup>{before.map(kindRow)}{failed}{charts}</ListGroup>}
            <PatternChips airport={a} chosen={picked.get(a.ident) ?? null} onPick={end => onPick(a.ident, end)} />
            {after.length > 0 && <ListGroup>{after.map(kindRow)}{before.length === 0 && failed}</ListGroup>}
          </FieldStep>
        );
      })}
    </ol>
  );
}

/**
 * One field of the route as a step down the line the flight takes: a dot
 * on the line at its start, its name and its part in the flight, and what
 * is flown there under them. The last field's dot is filled, where the
 * flight ends.
 */
function FieldStep({ title, last, children }: { title: string; last: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <div aria-hidden="true" className="flex w-4 shrink-0 flex-col items-center pt-1.5">
        <span className={cn("size-3.5 shrink-0 rounded-full border-[3px] border-tint", last ? "bg-tint" : "bg-background")} />
        {!last && <span className="mt-1 w-0.5 flex-1 rounded-full bg-border" />}
      </div>
      <section aria-label={title} className={cn("min-w-0 flex-1 space-y-3", !last && "pb-6")}>
        <h3 className={cn("font-semibold", TEXT.row)}>{title}</h3>
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

/** The end the reported wind favours (lib/pattern), where a wind is
 *  reported: the one a pilot would land on. */
function windwardEnd(runways: Runway[]): { ident: string; runway: Runway } | null {
  const inUse = runwayInUse(runways);
  return inUse?.byWind ? { ident: runwayNumber(inUse.end.ident), runway: inUse.runway } : null;
}

/**
 * A field's traffic pattern, picked by its runway as a chip, or None: the
 * end the reported wind favours marked with the wind, as the redesign's A
 * had it at the owner's pick, and its head- and crosswind said under the
 * chips (vfr.runway_wind). Drawn on the map as the FAA's Airplane Flying
 * Handbook flies a pattern: the downwind about three-quarters of a mile
 * out, the base 45° from the runway's end, the 45° entry abeam midfield.
 * The side its traffic is flown on and the pattern's altitude are said
 * at the head's end for the runway picked.
 */
function PatternChips({ airport: a, chosen, onPick }: {
  airport: ProcedureAirport;
  chosen: string | null;
  onPick: (end: string | null) => void;
}) {
  const ends = (a.runways ?? [])
    .filter(r => !r.closed)
    .flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e })))
    .sort((x, y) => x.end.ident.localeCompare(y.end.ident));
  const into = a.runways ? windwardEnd(a.runways) : null;
  const wind = into?.runway.wind;
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
            const windward = into?.ident === id;
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
      {into && wind && (
        <p className={cn("px-1 text-muted-foreground", TEXT.note)} data-testid="procedure-wind">
          {`${into.ident} into the wind: headwind ${Math.round(wind.headwind_kt)} kt`}
          {Math.round(Math.abs(wind.gust_crosswind_kt ?? wind.crosswind_kt)) > 0
            ? `, crosswind ${Math.round(Math.abs(wind.crosswind_kt))}${wind.gust_crosswind_kt != null ? ` gusting ${Math.round(Math.abs(wind.gust_crosswind_kt))}` : ""} kt`
            : ""}
        </p>
      )}
    </div>
  );
}

/**
 * One kind of a field's procedures, each by its chart's title, a page of
 * its own a tap away (ProcedurePage), the one in the route checked, an
 * approach to the runway the wind favours said so. Drawn from the FAA's
 * coded procedure: a sketch on the chart, not the chart.
 */
function ProcedurePicker({ kind, list, chosen, stale, intoWind, onOpen }: {
  kind: Kind;
  list: ProcedureList | undefined;
  chosen: PickedProcedure | null;
  stale: string | null;
  intoWind: { ident: string } | null;
  onOpen: (procedure: ProcedureSummary) => void;
}) {
  if (!list) return <p role="status" className="px-1 text-muted-foreground">Looking the procedures up…</p>;
  const of = list.procedures.filter(p => p.kind === kind);
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
        const windward = kind === "approach" && !!p.runway && runwayNumber(p.runway) === intoWind?.ident;
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
