import { Suspense, type ReactNode } from "react";
import { placeName } from "../../../../lib/radio";
import { SearchNear } from "../../../../lib/useAirportSearch";
import { RouteLine, RouteBox, RouteEnds, RouteSplit } from "../../routePanelParts";
import type { PlanWorkspaceModel } from "../../hooks/usePlanWorkspace";

/**
 * The route at FPL's head (PlanWorkspace's `route`): folded to its ends
 * and its controls once it is whole (RouteEdit), or the box of pills.
 */
export default function RouteHead({ vm, controls }: { vm: PlanWorkspaceModel; controls: ReactNode }) {
  const {
    addAt, addingChange, addingStop, airspaceOf, altitudeAt, clearRoute, course, directParam, directToPoint, fuelStops, hideFuelStop,
    keepFuelStops, metarColour, openProcedures, planned, routeEdit, routeFolded, routeLine, routeOpen, routePoints, routeProcedures, s,
    searchNear, selectPlace, setPointAltitude, setRoute, setRouteOpen, typeProcedures, typeStopAt, waypointStops, wholeRoute,
  } = vm;
  return routeFolded ? (
    <div className="flex min-w-0 flex-1 flex-col gap-2.5" data-testid="route-folded">
      {/* In the Plan, the owner's pick of the canvas's option 3 as
          cards (2026-11-05): until the route is whole, its departure
          and destination as two cards and nothing else -- no airplane,
          no altitude; once it is, those over the plan, whose Routes
          and cards follow (ProceduresRoute), with no title. */}
      {routeEdit === "plan" ? (!wholeRoute && (
        <Suspense fallback={<div className="h-[7.75rem]" />}>
          <RouteEnds
            dep={planned.dep} dest={planned.dest}
            onDep={dep => setRoute({ dep, stops: planned.stops, dest: planned.dest })}
            onDest={dest => setRoute({ dep: planned.dep, stops: planned.stops, dest })}
          />
        </Suspense>
      )) : (
        // One Line, the owner's pick L1 of the canvas (2026-11-05): the
        // route split in three, each end its own tap, the stops between
        // them the box's.
        <Suspense fallback={<div className="h-[3.25rem] rounded-[1.625rem] bg-card" />}>
          <RouteSplit
            dep={planned.dep} dest={planned.dest} stops={planned.stops}
            depName={wholeRoute && course ? placeName(course.departure.name, course.departure.ident) : null}
            destName={wholeRoute && course ? placeName(course.destination.name, course.destination.ident) : null}
            onDep={dep => setRoute({ dep, stops: planned.stops, dest: planned.dest })}
            onDest={dest => setRoute({ dep: planned.dep, stops: planned.stops, dest })}
            onStops={() => (planned.stops.length ? setRouteOpen(true) : typeStopAt(routePoints.length - 1))}
          />
        </Suspense>
      )}
      {/* The airplane, the altitude and the route's buttons once the route
          is whole, in either: none before, at the owner's ask ("no n
          number or altitude" till both ends are in). */}
      {/* In Route Cards, one white box of the flight's settings: the
          airplane, the altitude and the route's buttons, and under a
          hairline the Routes row, which was over the cards at the same
          spacing as everything else and read as one more card (the
          owner's pick B of the canvas, 2026-11-05: "show the controls
          and routes grouped"). The cards follow, out of the box. */}
      {wholeRoute && (routeEdit === "plan" ? (
        <div className="mb-3 w-full rounded-2xl bg-card ring-1 ring-black/5 dark:ring-white/10" data-testid="route-group">
          <div className="flex w-full items-center py-1.5 pr-1.5 pl-2">{controls}</div>
          {routeLine && (
            <>
              <div className="ml-11 h-px bg-border" aria-hidden="true" />
              <Suspense fallback={<div className="h-11" />}>
                <RouteLine line={routeLine} grouped />
              </Suspense>
            </>
          )}
        </div>
      ) : <div className="flex w-full items-center pr-0.5 pb-2 pl-1.5">{controls}</div>)}
    </div>
  ) : (
    <div className="min-w-0 flex-1">
      {/* Its room while its code comes: the box's own line. */}
      <Suspense fallback={<div className="h-10 rounded-[20.5px] bg-card" />}>
      <SearchNear.Provider value={searchNear}>
      <RouteBox
        dep={planned.dep} stops={planned.stops} dest={planned.dest} waypoints={waypointStops} airspaceOf={airspaceOf} metarColourOf={metarColour}
        altitudeAt={altitudeAt} onAltitudeChange={setPointAltitude}
        onChange={setRoute} onTypedProcedures={typeProcedures}
        adding={!!addingStop} onAddingChange={addingChange}
        via={addingStop === "via" ? s.unflyable?.detours : undefined}
        procedures={routeProcedures} onProcedures={openProcedures} fuelStops={fuelStops} onKeepFuelStops={keepFuelStops} onHideFuelStop={hideFuelStop}
        // An airport's pill tapped: its card over the route, as a tap on
        // it on the chart opens it, at the pilot's ask; closed, the route.
        onOpenAirport={selectPlace}
        directTo={directParam} onDirectTo={directToPoint}
        onClear={clearRoute}
        footer={controls}
        addAt={addAt}
        // Opened from its folded line: Done folds it again.
        onDone={routeEdit !== "box" && routeOpen ? () => setRouteOpen(false) : undefined}
      />
      </SearchNear.Provider>
      </Suspense>
    </div>
  );
}
