import { useCallback } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { Detour, ProcedureDrawing } from "../../../lib/api/types";
import { fieldListParams, fieldListsOf, prunedFieldLists } from "../../../lib/fieldLists";
import { MAX_STOPS, altitudesOf, altitudesParam, departureOf, identOf, routeOf, stopsOf } from "../../../lib/identSchema";
import { sameField, type PickedProcedure } from "../../../lib/procedures";
import { courseQuery, queryClient } from "../../../lib/queryClient";
import { rebasedRoute } from "../../../lib/routeRebase";
import { patched } from "../../../lib/useSearchParamsNow";
import type { RouteParts } from "../components/RouteBox";

/** A picked procedure's kind, from its drawing where it has been asked for:
 *  what prunedFieldLists needs to keep an approach only where the route
 *  lands. Unknown, it is kept. */
export const procedureKind = (p: PickedProcedure) =>
  queryClient.getQueryData<ProcedureDrawing>(["procedure", p.ident, p.id, p.transition])?.kind;

/**
 * The route's edits, the planner screen's view model for them: each a
 * change of the address, which re-plans -- the route typed in its box,
 * a stop added, taken out or put after a point, a point's own altitude,
 * the altitude flown, and Class B allowed or avoided. The address is the
 * one place the route is kept, so each edit reads it as it is when the
 * change is made (setSearchParams' `prev`), never a copy of it.
 */
export function useRouteEdits({ planned, routePoints, setSearchParams }: {
  /** The route this render drew. */
  planned: { dep: string; stops: string[]; dest: string };
  /** Its points as typed, the departure first (empty ones left out). */
  routePoints: string[];
  setSearchParams: SetURLSearchParams;
}) {
  // The route, changed in its box (RouteBox): in the address at once,
  // which re-plans, as the airplane and the time do -- the departure,
  // the stops, the destination.
  // Either end may be missing -- taken out in the box, half a route with
  // the other still to be typed -- and with neither, there is no route:
  // FPL's box empty to type another in, the panel left the height it was,
  // as the route's close leaves it (clearRoute).
  // An edit is worked out from the route this render drew; made while the
  // address is a change ahead of it, it is carried onto the address's
  // route (lib/routeRebase), never written over it.
  const drawnDep = planned.dep, drawnDest = planned.dest, stops = planned.stops;
  const setRoute = useCallback((parts: RouteParts, fuelAdded: string[] = [], keepLists = false) => {
    const { dep, dest } = parts;
    const drawn = { dep: drawnDep, stops, dest: drawnDest };
    if (!dep && !dest) {
      setSearchParams({}, { replace: true });
      return;
    }
    // The course asked for now, as the route goes in, not once the page
    // has drawn it: the draw is half a second of a phone's before the
    // plan's own requests went (measured 2026-10-07), and the course's
    // answer starts the planner's chart read and ground (app.prefetch).
    const via = stopsOf(parts.stops.join(","));
    const whole = routeOf(dep, dest, via);
    if (whole) void queryClient.prefetchQuery(courseQuery(whole.dep, whole.dest, via));
    setSearchParams(prev => {
      const { dep, stops, dest } = rebasedRoute(drawn, parts, { dep: departureOf(prev.get("dep")), stops: stopsOf(prev.get("stops")), dest: identOf(prev.get("dest")) });
      // What was picked at a field goes with it out of the route -- its
      // runways, procedures, altitude, time on the ground and hold -- in
      // the same change, so the planner is not asked once with them.
      // Not while the Routes' cards are browsed (`keepLists`): a way in
      // sight that skips a stop took the stop's approach and ground time
      // with it, and Your Route came back without them.
      const lists = fieldListsOf(prev);
      const kept = keepLists ? lists : prunedFieldLists(lists, { dep, stops, dest }, procedureKind);
      // A route changed by hand is the route: a Direct to's own is kept,
      // and Cancel has nothing to go back to.
      // The fuel stops among the stops (useFuelStops): those added now, and
      // those before that are stops still.
      const fuel = [...(prev.get("fuel") ?? "").split(","), ...fuelAdded]
        .filter((id, i, all) => id && all.indexOf(id) === i && stops.some(stop => sameField(stop, id)));
      return patched(prev, { dep, dest, stops: stops.join(","), ...fieldListParams(kept), direct: null, was: null, fuel: fuel.length ? fuel.join(",") : null });
    }, { replace: true });
  }, [setSearchParams, drawnDep, stops, drawnDest]);
  // An airport's card's Add Stop, at the pilot's ask: the field the
  // route's next stop, after the ones it makes and before its destination
  // (it was Add to Route, the field the new destination); with half a
  // route, the end it lacks; with none, the first point of one, its box
  // asking for the destination next (RouteBox). The card put away for the
  // route under it.
  const addStop = useCallback((to: { ident: string }) => {
    const points = [...routePoints];
    if (points.includes(to.ident)) return;
    if (planned.dep && planned.dest) points.splice(-1, 0, to.ident);
    else if (planned.dest) points.unshift(to.ident);
    else points.push(to.ident);
    // One change of the address: two in a row, the second read the first's
    // address from before it.
    setSearchParams(prev => {
      return patched(prev, {
        dep: points[0]!,
        stops: points.length > 2 ? points.slice(1, -1).join(",") : null,
        dest: points.length > 1 ? points.at(-1)! : null,
        place: null, direct: null, was: null,
      });
    }, { replace: true });
  }, [routePoints, planned.dep, planned.dest, setSearchParams]);
  // A point's own altitude set, or (null) given back to the plan.
  const setPointAltitude = useCallback((ident: string, feet: number | null) => {
    setSearchParams(prev => {
      const own = altitudesOf(prev.get("altitudes"));
      if (feet === null) delete own[ident];
      else own[ident] = feet;
      return patched(prev, { altitudes: altitudesParam(own) });
    }, { replace: true });
  }, [setSearchParams]);
  const setStops = useCallback(
    (stops: string[], fuelAdded?: string[], keepLists = false) => setRoute({ dep: planned.dep, stops, dest: planned.dest }, fuelAdded, keepLists),
    [setRoute, planned.dep, planned.dest]);
  // A stop taken out from its menu in FPL's list, as from its pill's.
  const removeStop = useCallback(
    (ident: string) => setStops(planned.stops.filter(stop => !sameField(stop, ident))), [setStops, planned.stops]);
  // The pilot's own point (FixFromDialog), flown over straight after the
  // point it was made off: the first stop after the departure, before the
  // destination off the destination. Past the planner's most stops, none.
  const insertStopAfter = useCallback((after: string, ident: string) => {
    if (planned.stops.length >= MAX_STOPS) return;
    const at = sameField(planned.dep, after) ? 0 : planned.stops.findIndex(stop => sameField(stop, after)) + 1 || planned.stops.length;
    setStops([...planned.stops.slice(0, at), ident, ...planned.stops.slice(at)]);
  }, [setStops, planned.dep, planned.stops]);
  // Allowed again: the waypoint Avoid Class B put round it (class_b_via)
  // taken out of the stops too, where it still is -- left in, the route
  // still bent round the Class B it was now planned through.
  const acceptClassB = useCallback((accept: boolean) => {
    setSearchParams(prev => {
      const via = prev.get("class_b_via");
      const stops = stopsOf(prev.get("stops")).filter(stop => !accept || stop !== via);
      return patched(prev, {
        class_b: accept ? null : "0", class_b_via: accept ? null : via, stops: stops.length ? stops.join(",") : null,
      });
    }, { replace: true });
  }, [setSearchParams]);
  // "Avoid Class B": the planner's waypoint round it put in the stops where
  // it says (Detour.stop_index, before that stop), and the clearance taken
  // back, so the rest is planned under or round it; with no waypoint in
  // reach, the clearance alone. One change of the address.
  // The waypoint only where the route has room for another stop
  // (MAX_STOPS): a ninth was refused by the planner (422), the clearance
  // alone taken back then. Its ident kept (class_b_via), for Allow.
  const avoidClassB = useCallback((detour: Detour | null) => {
    setSearchParams(prev => {
      const stops = stopsOf(prev.get("stops"));
      const added = !!detour && !stops.includes(detour.ident) && stops.length < MAX_STOPS;
      if (added) stops.splice(Math.min(detour.stop_index, stops.length), 0, detour.ident);
      return patched(prev, { class_b: "0", class_b_via: added ? detour.ident : null, stops: stops.length ? stops.join(",") : null });
    }, { replace: true });
  }, [setSearchParams]);
  // An altitude of the pilot's own, the rest of the address as it was.
  // An altitude typed beside the airplane is flown on every leg, legal or
  // not, with its cautions; one picked on the wheel (`nearest`) on each
  // leg where that leg may fly it, else at the leg's nearest legal one, as
  // the wheel's figures said -- flown on every leg, it could be under a
  // leg's floor or on the wrong thousands for its course (14 CFR 91.119,
  // 91.159).
  const flyAltitude = useCallback((ft: number, nearest = false) => {
    setSearchParams(prev => patched(prev, { altitude_ft: String(ft), altitude_nearest: nearest ? "1" : null, altitude_choice: null }), { replace: true });
  }, [setSearchParams]);
  return { setRoute, addStop, setPointAltitude, setStops, removeStop, insertStopAfter, acceptClassB, avoidClassB, flyAltitude };
}
