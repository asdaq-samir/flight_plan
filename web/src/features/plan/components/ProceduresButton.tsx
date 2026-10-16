import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Check, PlaneLanding, PlaneTakeoff, Route } from "lucide-react";
import { cn } from "cn";
import { ConsolePages, PageRow } from "../../../components/ConsolePages";
import { ListChoices, ListGroup, ListRow } from "../../../components/GroupedList";
import CloseButton from "../../../components/CloseButton";
import RoundButton from "../../../components/RoundButton";
import { Button } from "../../../components/ui/button";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { ChartBadge, RowBadge } from "../../../components/RowBadge";
import { api } from "../../../lib/api/client";
import type { ProcedureList, ProcedureSummary, Runway } from "../../../lib/api/types";
import { runwayInUse, runwayNumber } from "../../../lib/pattern";
import { kindsFor, sameField, type PickedProcedure } from "../../../lib/procedures";
import { BADGE } from "../../../lib/rowBadges";
import { trafficPattern } from "../../../lib/trafficPattern";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";

/** The radio value of a list's "None" (no pattern, no procedure, no
 *  transition): a radio's value is a string. */
const NONE = "none";

type Kind = ProcedureSummary["kind"];

const KIND_TITLE: Record<Kind, string> = { approach: "Approaches", arrival: "Arrivals", departure: "Departures" };
const KIND_GLYPH: Record<Kind, ReactNode> = { approach: <PlaneLanding />, arrival: <Route />, departure: <PlaneTakeoff /> };

export interface ProcedureAirport {
  ident: string;
  role: "Departure" | "Stop" | "Destination";
  runways: Runway[] | null;
  patternAltitudeFt: number | null;
}

/**
 * The route's Procedures, at the pilot's ask, where its Approaches were:
 * for each field of the route, the runway whose traffic pattern to draw
 * on the map (PatternLayer) -- each end with the side its traffic is
 * flown on and the pattern's altitude -- and its instrument procedures
 * from the FAA's CIFP (vfr.procedures): a departure's departures, a
 * destination's arrivals and approaches, a stop's all three, each kind a
 * page of its own as iOS's Settings opens one (ConsolePages), and each
 * procedure a page of its own in turn, picked as ForeFlight's Procedure
 * Advisor picks one, at the owner's pick: its transition, the map above
 * the sheet drawing it as it is chosen (`onPreview`, ProcedureLayer), and
 * Add to Route at the page's foot. And the destination's approach charts,
 * as the button opened before.
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
  const setOpen = (next: boolean) => { setOwn(next); onOpenChange?.(next); };
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
        title="Procedures" className="max-h-[70vh] w-80 overflow-y-auto p-3" align="end" side="left"
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
        />
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

/**
 * What the Procedures sheet holds, drawn only while it is out: each
 * field's runway ends and its patterns, worked out for every field on
 * every render of the button, were 85 ms of the half sheet's opening at a
 * phone's speed with the sheet shut (profiled 2026-10-12).
 */
function ProceduresSheet({ airports, picked, onPick, onCharts, chartsDisabled, procedures, onProcedures, onPreview, close }: {
  airports: ProcedureAirport[];
  picked: Map<string, string>;
  onPick: (ident: string, end: string | null) => void;
  onCharts: () => void;
  chartsDisabled: boolean;
  procedures: PickedProcedure[];
  onProcedures: (next: PickedProcedure[], picked: PickedProcedure | null) => void;
  onPreview: (procedure: PickedProcedure | null) => void;
  close: () => void;
}) {
  const destination = airports.find(a => a.role === "Destination");
  // Each field's procedures, asked for once the button is opened.
  const lists = useQueries({
    queries: airports.map(a => ({
      queryKey: ["procedures", a.ident],
      queryFn: () => api.procedures(a.ident),
      staleTime: 6 * 60 * 60_000,
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

  const pages = Object.fromEntries(airports.flatMap((a, i) => kindsFor(a.role).map(kind => [`${kind}:${a.ident}`, {
    title: `${a.ident} ${KIND_TITLE[kind].toLowerCase()}`,
    content: (
      <ProcedurePicker
        ident={a.ident} kind={kind} list={lists[i]?.data} chosen={pickOf(a.ident, kind)}
        onPick={next => pick(a.ident, kind, next)} onAdded={close} onPreview={onPreview}
      />
    ),
  }])));

  return (
    <ConsolePages back="Procedures" pages={pages}>
    <div className="space-y-5" data-testid="procedures">
      {airports.map((a, i) => {
        const ends = (a.runways ?? [])
          .filter(r => !r.closed)
          .flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e })))
          .sort((x, y) => x.end.ident.localeCompare(y.end.ident));
        const chosen = picked.get(a.ident) ?? null;
        // The end the reported wind favours (lib/pattern), said, as the
        // one a pilot would land on.
        const windward = a.runways ? runwayInUse(a.runways) : null;
        const list = lists[i];
        return (
          <Fragment key={a.ident}>
          <ListChoices value={chosen ?? NONE} onChange={v => onPick(a.ident, v === NONE ? null : v)} label={`${a.ident} traffic pattern`}>
          {/* Drawn on the map as the FAA's Airplane Flying Handbook flies a
              pattern: the downwind about three-quarters of a mile out, the
              base 45° from the runway's end, the 45° entry abeam midfield. */}
          <ListGroup title={`${a.ident} · ${a.role} · traffic pattern`}>
            {a.runways === null ? (
              <ListRow title={<span className="text-muted-foreground">Looking the runways up…</span>} />
            ) : (
              <>
                <ListRow radio={NONE} title="None" />
                {ends.map(({ runway, end }) => {
                  const drawn = trafficPattern(a.ident, runway, end.ident, a.patternAltitudeFt) !== null;
                  const id = runwayNumber(end.ident);
                  return (
                    <ListRow
                      key={end.ident} radio={id} disabled={!drawn}
                      title={`Runway ${id}`}
                      description={drawn
                        ? [
                          windward?.byWind && windward.end.ident === end.ident ? "Into the wind" : null,
                          `${end.traffic === "right" ? "Right" : "Left"} traffic`,
                          a.patternAltitudeFt != null ? `${altFt(a.patternAltitudeFt)} ft` : null,
                        ].filter(Boolean).join(" · ")
                        : "Its end is not surveyed: not drawn"}
                      data-testid="procedure-pattern"
                    />
                  );
                })}
              </>
            )}
          </ListGroup>
          </ListChoices>
          {/* Its instrument procedures, a page for each kind, the one
              picked said at the row's end; and the destination's
              approach charts, as its card lists them. */}
          <ListGroup title={`${a.ident} · instrument procedures`}>
            {kindsFor(a.role).map(kind => {
              const of = list?.data?.procedures.filter(p => p.kind === kind) ?? [];
              const mine = pickOf(a.ident, kind);
              const name = mine && of.find(p => p.id === mine.id)?.name;
              return list?.isError ? null : list?.data && of.length === 0 ? (
                <ListRow
                  key={kind} media={<RowBadge colour={BADGE.approach}>{KIND_GLYPH[kind]}</RowBadge>}
                  title={KIND_TITLE[kind]} value="None" disabled
                />
              ) : (
                <PageRow
                  key={kind} page={`${kind}:${a.ident}`} media={<RowBadge colour={BADGE.approach}>{KIND_GLYPH[kind]}</RowBadge>}
                  title={KIND_TITLE[kind]} value={!list?.data ? "…" : name ? `${name}${mine?.transition ? ` via ${mine.transition}` : ""}` : "None"}
                />
              );
            })}
            {list?.isError && (
              <ListRow title={<span className="text-muted-foreground">The FAA's procedures could not be had</span>} />
            )}
            {a === destination && (
              <ListRow
                media={<ChartBadge />} title="Approach charts" chevron disabled={chartsDisabled}
                onClick={() => { close(); onCharts(); }} data-testid="procedure-charts"
              />
            )}
          </ListGroup>
          </Fragment>
        );
      })}
    </div>
    </ConsolePages>
  );
}

/**
 * One kind of a field's procedures, each by its chart's title, a page of
 * its own a tap away (ProcedurePage), the one in the route checked. Drawn
 * from the FAA's coded procedure: a sketch on the chart, not the chart.
 */
function ProcedurePicker({ ident, kind, list, chosen, onPick, onAdded, onPreview }: {
  ident: string;
  kind: Kind;
  list: ProcedureList | undefined;
  chosen: PickedProcedure | null;
  onPick: (next: { id: string; transition: string | null } | null) => void;
  /** The sheet put away once one is added, as ForeFlight's is. */
  onAdded: () => void;
  onPreview: (procedure: PickedProcedure | null) => void;
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
  const stale = list.stale ? `Out of date: the ${cycleDate(list.cycle)} cycle, as the current one could not be had` : null;
  const pages = Object.fromEntries(of.map(p => [p.id, {
    title: `${ident} ${p.name}`,
    content: (
      <ProcedurePage
        kind={kind} ident={ident} procedure={p} chosen={chosen?.id === p.id ? chosen : null} stale={stale}
        onAdd={transition => { onPick({ id: p.id, transition }); onAdded(); }} onRemove={() => onPick(null)} onPreview={onPreview}
      />
    ),
  }]));
  return (
    <ConsolePages back={`${ident} ${KIND_TITLE[kind].toLowerCase()}`} pages={pages}>
      <ListGroup>
        {stale && <ListRow title={<span className="text-destructive-ink">{stale}</span>} data-testid="procedures-stale" />}
        {of.map(p => {
          const mine = chosen?.id === p.id ? chosen : null;
          return (
            <PageRow
              key={p.id} page={p.id} title={p.name} testId="procedure-option"
              description={mine
                ? `In the route${mine.transition ? `, via ${mine.transition}` : kind === "approach" ? ", from vectors" : ""}`
                : kind === "approach" ? undefined : runways(p)}
              value={mine ? <Check className="size-4 text-tint" aria-label="In the route" /> : undefined}
            />
          );
        })}
      </ListGroup>
    </ConsolePages>
  );
}

/**
 * One procedure's own page, as ForeFlight's Procedure Advisor has it: its
 * transitions to choose from -- an approach's feeder fixes and vectors to
 * the final, an arrival's or a departure's enroute transitions or none --
 * the map above the sheet drawing the one chosen as it is chosen, and Add
 * to Route at the foot (Remove from Route, where it is the route's).
 */
function ProcedurePage({ kind, ident, procedure, chosen, stale, onAdd, onRemove, onPreview }: {
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
}) {
  const [transition, setTransition] = useState<string | null>(chosen?.transition ?? null);
  // Drawn as it is chosen, before it is added; off the map as the page is
  // left (Back, or the sheet put away).
  useEffect(() => {
    onPreview({ ident, id: procedure.id, transition });
    return () => onPreview(null);
  }, [ident, procedure.id, transition, onPreview]);
  const inRoute = !!chosen && chosen.transition === transition;
  return (
    <div className="space-y-5">
      {procedure.transitions.length > 0 && (
        <ListChoices value={transition ?? NONE} onChange={v => setTransition(v === NONE ? null : v)} label="Transition">
          <ListGroup title="Transition">
            {procedure.transitions.map(t => <ListRow key={t} radio={t} title={t} data-testid="procedure-transition" />)}
            <ListRow radio={NONE} title={kind === "approach" ? "Vectors to final" : "None"} data-testid="procedure-transition" />
          </ListGroup>
        </ListChoices>
      )}
      {stale && <p className={cn("px-1 text-destructive-ink", TEXT.detail)}>{stale}</p>}
      {/* At the phone's sheet's foot as the page scrolls, as ForeFlight's
          Add to Route is: down over the sheet's own padding under it, so
          no line of the page shows below the button. In the popover from
          md up, at the page's end: pinned there it reached into an iPhone
          held sideways' notch with the popover (the iOS audit's P12). */}
      <div
        className={cn(
          "sticky bottom-[calc(-1*max(1rem,env(safe-area-inset-bottom)))] -mx-4 bg-popover px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]",
          "md:static md:mx-0 md:p-0",
        )}
      >
        {inRoute ? (
          <Button type="button" variant="outline" className="w-full text-destructive" onClick={onRemove} data-testid="procedure-remove">
            Remove from Route
          </Button>
        ) : (
          <Button type="button" className="w-full" onClick={() => onAdd(transition)} data-testid="procedure-add">
            Add to Route
          </Button>
        )}
      </div>
    </div>
  );
}

/** "261001" as "1 Oct 2026". */
function cycleDate(cycle: string): string {
  const at = new Date(Date.UTC(2000 + Number(cycle.slice(0, 2)), Number(cycle.slice(2, 4)) - 1, Number(cycle.slice(4, 6))));
  return Number.isNaN(at.getTime()) ? cycle : at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
