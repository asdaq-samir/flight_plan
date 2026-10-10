import { Fragment, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Check, PlaneLanding, PlaneTakeoff, Route } from "lucide-react";
import { cn } from "cn";
import { ConsolePages, PageRow } from "../../../components/ConsolePages";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import RoundButton from "../../../components/RoundButton";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { ChartBadge, RowBadge } from "../../../components/RowBadge";
import { api } from "../../../lib/api/client";
import type { ProcedureList, ProcedureSummary, Runway } from "../../../lib/api/types";
import { runwayInUse, runwayNumber } from "../../../lib/pattern";
import { kindsFor, sameField, type PickedProcedure } from "../../../lib/procedures";
import { BADGE } from "../../../lib/rowBadges";
import { trafficPattern } from "../../../lib/trafficPattern";
import { altFt } from "../../../lib/units";

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
 * page of its own as iOS's Settings opens one (ConsolePages), a
 * procedure picked there and then its transition, drawn on the map as
 * ForeFlight draws it (ProcedureLayer), at the pilot's ask. And the
 * destination's approach charts, as the button opened before.
 */
export default function ProceduresButton({ airports, picked, onPick, onCharts, chartsDisabled, procedures, onProcedures }: {
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
}) {
  const [open, setOpen] = useState(false);
  const destination = airports.find(a => a.role === "Destination");
  // Each field's procedures, asked for once the button is opened.
  const lists = useQueries({
    queries: airports.map(a => ({
      queryKey: ["procedures", a.ident],
      queryFn: () => api.procedures(a.ident),
      enabled: open,
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
        kind={kind} list={lists[i]?.data} chosen={pickOf(a.ident, kind)}
        onPick={next => pick(a.ident, kind, next)}
      />
    ),
  }])));

  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <RoundButton label="Procedures" disabled={airports.length === 0} data-testid="route-approaches">
          <PlaneLanding className="size-5" strokeWidth={2} />
        </RoundButton>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Procedures" className="max-h-[70vh] w-80 overflow-y-auto p-3" align="end" side="left">
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
              <ListGroup
                title={`${a.ident} · ${a.role} · traffic pattern`}
                footer="Drawn on the map as the FAA's Airplane Flying Handbook flies a pattern: the downwind about three-quarters of a mile out, the base 45° from the runway's end, the 45° entry abeam midfield. A sketch to fly by, not a procedure; the field's own pattern may differ."
              >
                {a.runways === null ? (
                  <ListRow title={<span className="text-muted-foreground">Looking the runways up…</span>} />
                ) : (
                  <>
                    <ListRow
                      role="radio" aria-checked={chosen === null} onClick={() => onPick(a.ident, null)}
                      media={<Check className={cn("size-4 text-tint", chosen !== null && "invisible")} aria-hidden />}
                      title="None"
                    />
                    {ends.map(({ runway, end }) => {
                      const drawn = trafficPattern(a.ident, runway, end.ident, a.patternAltitudeFt) !== null;
                      const id = runwayNumber(end.ident);
                      return (
                        <ListRow
                          key={end.ident} role="radio" aria-checked={chosen === id} disabled={!drawn}
                          onClick={() => onPick(a.ident, id)}
                          media={<Check className={cn("size-4 text-tint", chosen !== id && "invisible")} aria-hidden />}
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
                    onClick={() => { setOpen(false); onCharts(); }} data-testid="procedure-charts"
                  />
                )}
              </ListGroup>
              </Fragment>
            );
          })}
        </div>
        </ConsolePages>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

/**
 * One kind of a field's procedures, picked from: None, or each by its
 * chart's title, and once one is picked its transitions under it -- an
 * approach from vectors or from one of its feeder fixes, an arrival or a
 * departure on its own or by one of its enroute transitions. Drawn from
 * the FAA's coded procedure: a sketch on the chart, not the chart.
 */
function ProcedurePicker({ kind, list, chosen, onPick }: {
  kind: Kind;
  list: ProcedureList | undefined;
  chosen: PickedProcedure | null;
  onPick: (next: { id: string; transition: string | null } | null) => void;
}) {
  if (!list) return <p role="status" className="px-1 text-muted-foreground">Looking the procedures up…</p>;
  const of = list.procedures.filter(p => p.kind === kind);
  const current = of.find(p => p.id === chosen?.id) ?? null;
  const tick = (on: boolean) => <Check className={cn("size-4 text-tint", !on && "invisible")} aria-hidden />;
  const runways = (p: ProcedureSummary) => p.runway_transitions.length
    ? p.runway_transitions.includes("ALL") ? "All runways" : `Runway ${p.runway_transitions.map(r => r.replace(/^RW/, "").replace(/B$/, "")).join(", ")}`
    : undefined;
  return (
    <div className="space-y-5">
      <ListGroup
        footer={`From the FAA's coded procedures (CIFP), the cycle of ${cycleDate(list.cycle)}${list.stale ? ", OUT OF DATE (the current cycle could not be had)" : ""}: a sketch on the chart to plan by, not for navigation. Fly the FAA's chart.`}
      >
        <ListRow role="radio" aria-checked={!current} onClick={() => onPick(null)} media={tick(!current)} title="None" />
        {of.map(p => (
          <ListRow
            key={p.id} role="radio" aria-checked={current?.id === p.id} media={tick(current?.id === p.id)}
            title={p.name} description={kind === "approach" ? undefined : runways(p)}
            onClick={() => onPick({ id: p.id, transition: current?.id === p.id ? chosen?.transition ?? null : null })}
            data-testid="procedure-option"
          />
        ))}
      </ListGroup>
      {current && current.transitions.length > 0 && (
        <ListGroup title={`${current.name} · transition`}>
          <ListRow
            role="radio" aria-checked={!chosen?.transition} media={tick(!chosen?.transition)}
            title={kind === "approach" ? "Vectors" : "None"} onClick={() => onPick({ id: current.id, transition: null })}
            data-testid="procedure-transition"
          />
          {current.transitions.map(t => (
            <ListRow
              key={t} role="radio" aria-checked={chosen?.transition === t} media={tick(chosen?.transition === t)}
              title={`Via ${t}`} onClick={() => onPick({ id: current.id, transition: t })} data-testid="procedure-transition"
            />
          ))}
        </ListGroup>
      )}
    </div>
  );
}

/** "261001" as "1 Oct 2026". */
function cycleDate(cycle: string): string {
  const at = new Date(Date.UTC(2000 + Number(cycle.slice(0, 2)), Number(cycle.slice(2, 4)) - 1, Number(cycle.slice(4, 6))));
  return Number.isNaN(at.getTime()) ? cycle : at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
