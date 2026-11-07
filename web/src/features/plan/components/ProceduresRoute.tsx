import { lazy, Suspense, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../../components/CloseButton";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import { sameField } from "../../../lib/procedures";
import { TEXT } from "../../../lib/text";
import { frdOf, isPosition, placeOfPoint } from "../../../lib/identSchema";
import { etaAt } from "../format";
import { PointMark } from "./navlog/PointMark";
import { PointFigures } from "./PointControls";
import { FuelGauge } from "./FuelGauge";
import { legOf, rowPoint, type NavLogRow } from "./navlog/rows";
import { useProceduresRoute, type ProcedureAirport, type ProceduresRouteProps } from "../hooks/useProceduresRoute";
import { RouteLine } from "./procedures/RouteLine";
import { FieldStep, pointEnd } from "./procedures/FieldStep";
import { HoldRow, NewStopCard, RouteListDrag, Step } from "./procedures/RouteRows";
import { listTitle, ProcedurePage, ProcedurePicker } from "./procedures/ProcedureSheet";

// The list's types and its Routes row, where PlanWorkspace and the
// routePanel chunk import them from.
export type { FitInputs, ProcedureAirport, ProcedureKind, ProceduresAt, RouteListEdit } from "../hooks/useProceduresRoute";
export { RouteLine, type RouteLineChoices } from "./procedures/RouteLine";

// Opened only from a point's menu, so fetched as one first is: in the
// first load they took it over its 1.10 MB budget (CI, 2026-10-20).
const FixFromDialog = lazy(() => import("./FixFromDialog"));
const PointAltitudeDialog = lazy(() => import("./PointAltitudeDialog"));
const HoldSheet = lazy(() => import("./HoldSheet"));
const ApproachLesson = lazy(() => import("./ApproachLesson"));

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
 * (wingtip.procedures) is picked in a sheet of its own, as ForeFlight's
 * Procedure Advisor picks one: the field's of that kind, then the one
 * procedure, its transition chosen, the map above the sheet drawing it
 * as it is chosen (`onPreview`, ProcedureLayer), its fixes listed, and
 * Add to Route at the foot. Its close goes back to the list.
 *
 * The view: its state, its asks and the runways picked into the wind are
 * its view model's (useProceduresRoute).
 */
export default function ProceduresRoute(props: ProceduresRouteProps) {
  const vm = useProceduresRoute(props);
  const {
    airports, rows, depart, weather, onCharts, chartsDisabled, onPreview, at, onPointAltitude, onCreateFix, onHoldSet, routePoints, stopsFull,
    routeLine, edit, fit, on, procedure, setPage, editing, setEditing, fixFrom, setFixFrom, holdAt, setHoldAt, editingUsed, fixFromUsed, holdUsed,
    lesson, setLesson, lessonUsed, holdOn, heldAs, lists, pick, close, destination, along, asCards, pointIndex, tanks, points, newAt, field,
    list, chosen, stale, windOf,
  } = vm;

  // The route's own rows where the course is in: its fields as steps and
  // the fixes flown through between them, the checkpoints and the tops of
  // climb and descent left to the nav log. Before then, the fields alone.
  const steps: ReactNode[] = [];
  const shown = new Set<ProcedureAirport>();
  // Routes, over the route's fields (RouteLine), four points clear of the
  // first field's toggle under it, whose 44-point hit area came 3 up into
  // the Routes row's (the iOS audit's P1, CI on 4d7da5f0).
  const lineRow = routeLine ? <RouteLine line={routeLine} /> : null;
  // The stop being added, its card before the point at its place.
  const newCard = newAt !== null ? <NewStopCard key="new-stop" via={edit!.newVia ?? null} onCommit={v => edit!.onInsert!(newAt, v)} onCancel={() => edit!.onCancelNew?.()} /> : null;
  let newPut = false;
  const newBefore = (index: number | undefined, into: ReactNode[]) => {
    if (newCard && !newPut && index === newAt) {
      into.push(newCard);
      newPut = true;
    }
  };
  const fieldStep = (a: ProcedureAirport, row: NavLogRow | undefined, last: boolean, leads: boolean) => (
    <FieldStep key={`${a.role}:${a.ident}`} vm={vm} a={a} row={row} last={last} leads={leads} />
  );
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
      return hold ? (
        <HoldRow
          key={`hold-${ident}`} hold={hold} flown={heldAs(ident)} last={last}
          onOpen={() => setHoldAt({ fix: hold.fix, hold, altitudeFt: legOf(row)?.altitude_ft ?? null, arrivalDeg: null })}
        />
      ) : null;
    };
    if (field) {
      shown.add(field);
      newBefore(pointIndex(field.ident, field.role), steps);
      steps.push(fieldStep(field, row, last, steps.length === 0));
      if (field.role === "Destination") steps.push(holdRow(field.ident));
      return;
    }
    // A waypoint the route flies over (VPBNG), or ends at: its altitude
    // and Direct to, as a field's landing has. Not where it starts.
    const time = etaAt(depart || new Date().toISOString(), row.minutesFlown);
    const to = row.kind !== "departure" && "airport" in row && !isPosition(row.airport.ident);
    const typedAt = to ? routePoints.findIndex(p => sameField(p, row.airport.ident)) : -1;
    const end = to ? pointEnd(vm, row.airport.ident, { time, waypoint: true, elevationFt: null, to: true, stop: row.kind === "stop", holdable: true, row, index: typedAt >= 0 ? typedAt : undefined }) : null;
    if (typedAt >= 0) newBefore(typedAt, steps);
    steps.push(
      <Step
        key={row.key} first={steps.length === 0} last={last}
        rename={asCards && edit?.onReplace && typedAt >= 0 ? v => edit.onReplace!(typedAt, v) : undefined} mark={<PointMark row={row} number={undefined} weather={weather} />}
        title={rowPoint(row).name} testId={`route-${row.kind}`}
        icon={tanks.has(row.key) ? <FuelGauge gal={tanks.get(row.key)!.gal} usable={tanks.get(row.key)!.usable} tone={tanks.get(row.key)!.low ? "low" : undefined} /> : undefined}
        // A present position, POS0, by its coordinates under it, where its
        // role was ("Instead of Departure under POS0, say the coordinates").
        // Direct to in the line's own colour: it says how the leg is
        // flown, and only what is tapped is in the tint.
        sub={end?.direct ? <span className="font-semibold">Direct to</span> : `${row.kind === "stop" ? (to && frdOf(row.airport.ident) ? row.airport.name : "Fly over") : row.kind === "destination" ? "Destination" : "airport" in row && isPosition(row.airport.ident) ? placeOfPoint(row.airport.ident) : "Departure"}${along(row)}`}
        figures={end?.figures ?? <PointFigures time={time} altitude={null} kind="cruise" />} menu={end?.menu} grip={end?.grip} card={asCards}
      />,
    );
    if (to) steps.push(holdRow(row.airport.ident));
  });
  const fieldsAlone = rows.length === 0
    ? airports.flatMap((a, i) => {
      const before: ReactNode[] = [];
      newBefore(pointIndex(a.ident, a.role), before);
      return [...before, fieldStep(a, undefined, i === airports.length - 1, i === 0)];
    })
    : null;

  return (
    <>
    {/* Its own popover beside the procedures' sheet's, not inside its root:
        there, on a desktop, it closed as it opened. */}
    {holdUsed && (
      <Suspense fallback={null}>
        <HoldSheet at={holdAt} onClose={() => setHoldAt(null)} onSet={(fix, hold) => { onHoldSet(fix, hold); setHoldAt(null); }} />
      </Suspense>
    )}
    {lessonUsed && (
      <Suspense fallback={null}>
        <ApproachLesson at={lesson} aircraft={fit?.aircraft ?? null} onClose={() => setLesson(null)} />
      </Suspense>
    )}
    {lineRow}
    {/* The grips' drag round the list where it changes the route
        (RouteListDrag): its own element, not the anchor's child. */}
    <RouteListDrag on={edit?.onMove}>
    <ResponsivePopover open={!!at} onOpenChange={open => { if (!open) close(); }}>
      <ResponsivePopoverAnchor asChild>
        <ol className="pt-2 pb-1" aria-label="The route" data-testid="procedures">{fieldsAlone ?? steps}</ol>
      </ResponsivePopoverAnchor>
      {/* A stop before the destination, as Maps' Add Stop is, at the
          list's end where the list changes the route (the FPL canvas's A
          and B, 2026-11-05). */}
      {edit && routePoints.length > 1 && (
        <button
          type="button" disabled={stopsFull} onClick={() => edit.onAddAt(routePoints.length - 1)} data-testid="route-add-stop"
          className={cn("flex h-11 w-full items-center gap-2.5 text-left text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40", TEXT.row)}
        >
          <span className="grid w-7 shrink-0 place-items-center">
            <span className="grid size-6 place-items-center rounded-full bg-tint text-white"><Plus className="size-4" strokeWidth={2.6} aria-hidden /></span>
          </span>
          Add a Stop
        </button>
      )}
      {editingUsed && (
        <Suspense fallback={null}>
          <PointAltitudeDialog
            point={editing} onClose={() => setEditing(null)}
            onSet={(ident, feet) => { onPointAltitude(ident, feet); setEditing(null); }}
          />
        </Suspense>
      )}
      {fixFromUsed && (
        <Suspense fallback={null}>
          <FixFromDialog
            from={fixFrom} onClose={() => setFixFrom(null)}
            onCreate={ident => { if (fixFrom) onCreateFix(fixFrom, ident); setFixFrom(null); }}
          />
        </Suspense>
      )}
      {/* On a phone a card in the map's panel (ResponsivePopover), half
          way up, the map above it in sight and clear as a procedure is
          picked, as ForeFlight's Procedure Advisor keeps it, at the
          owner's pick. */}
      <ResponsivePopoverContent
        title={on ? (procedure ? `${on.ident} ${procedure.name}` : listTitle(on.ident, on.kind)) : "Procedures"}
        className="max-h-[70vh] w-80 overflow-y-auto p-3" align="start" side="right"
        // No Back: the close goes back to the list from a procedure's page,
        // at the owner's ask ("close button should behave as the back
        // button", 2026-10-22).
        action={<CloseButton label={procedure ? "Back" : "Close"} onClick={() => (procedure ? setPage(null) : close())} data-testid="procedures-close" />}
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
            failed={lists[airports.findIndex(a => sameField(a.ident, on.ident))]?.isError ?? false}
            wind={windOf(on.ident)} onOpen={p => setPage({ at: on, procedure: p })}
          />
        ))}
      </ResponsivePopoverContent>
    </ResponsivePopover>
    </RouteListDrag>
    </>
  );
}
