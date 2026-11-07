import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { Button } from "../../../../components/ui/button";
import { ToggleGroupItem } from "../../../../components/ui/toggle-group";
import { api } from "../../../../lib/api/client";
import type { ProcedureDrawing, ProcedureList, ProcedureSummary } from "../../../../lib/api/types";
import { distanceNm } from "../../../../lib/geo";
import { runwayNumber, type WindPick } from "../../../../lib/pattern";
import { transitionWords, type PickedProcedure } from "../../../../lib/procedures";
import { TEXT } from "../../../../lib/text";
import { altFt } from "../../../../lib/units";
import { PROCEDURE_STALE_MS, type ProcedureKind } from "../../hooks/useProceduresRoute";
import { Chips, CHIP, NONE } from "./PatternChips";

// The procedures sheet's pages (ProceduresRoute): a kind's list, and one
// procedure's own page.

type Kind = ProcedureKind;

const KIND_TITLE: Record<Kind, string> = { approach: "Approaches", arrival: "Arrivals", departure: "Departures" };
/** A kind as a branch's head says it, under the procedure's name. */
export const KIND_WORD: Record<Kind, string> = { approach: "Approach", arrival: "Arrival", departure: "Departure" };

/** "KDLH approaches": a kind's list's title. */
export function listTitle(ident: string, kind: Kind): string {
  return `${ident} ${KIND_TITLE[kind].toLowerCase()}`;
}

/**
 * One kind of a field's procedures, each by its chart's title, a page of
 * its own a tap away (ProcedurePage), the one in the route checked, an
 * approach to the runway the wind favours said so. Drawn from the FAA's
 * coded procedure: a sketch on the chart, not the chart.
 */
export function ProcedurePicker({ kind, list, failed, chosen, stale, wind, onOpen }: {
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
  if (!list) return <p role="status" className="px-1 text-muted-foreground">Fetching the procedures…</p>;
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
export function ProcedurePage({ kind, ident, procedure, chosen, stale, onAdd, onRemove, onPreview, onChart }: {
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
