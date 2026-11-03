import { useCallback, useMemo, useState } from "react";
import type { FuelStopSuggestion, Totals } from "../../../lib/api/types";
import { MAX_STOPS } from "../../../lib/identSchema";
import { sameField } from "../../../lib/procedures";

const NO_FUEL_STOPS: FuelStopSuggestion[] = [];
const NO_IDENTS: string[] = [];

/** The route with `idents` put in after `after` (the departure, or one of
 *  its stops), as many as the planner takes (MAX_STOPS), and those that
 *  went in; null where none can. */
export function withStopsAfter(dep: string, stops: string[], after: string, idents: string[]): { stops: string[]; added: string[] } | null {
  const room = MAX_STOPS - stops.length;
  if (room <= 0 || idents.length === 0) return null;
  const at = sameField(dep, after) ? 0 : stops.findIndex(stop => sameField(stop, after)) + 1 || stops.length;
  const added = idents.slice(0, room);
  return { stops: [...stops.slice(0, at), ...added, ...stops.slice(at)], added };
}

/**
 * The stops the planner suggests -- fuel for a flight too long for its
 * tanks, a break on a long one -- the planner screen's view model for
 * them: those the pilot took out of the route box for this route, the
 * tanks FPL's fuel at each point is read against, their pins on the map,
 * and keeping one, or a field from the map's Stops, as the pilot's own.
 */
export function useSuggestedStops({ totals, local, planned, setStops }: {
  totals: Totals | null | undefined;
  /** A local flight, one airport to itself: no stops to suggest. */
  local: boolean;
  planned: { dep: string; stops: string[]; dest: string };
  setStops: (stops: string[], fuelAdded?: string[]) => void;
}) {
  // The fuel stops the planner suggests for a flight too long for its
  // tanks (the totals' fuel_stops), kept: put in after the flight's
  // departure, in order, as many as the planner takes.
  const allFuelStops = local ? NO_FUEL_STOPS : totals?.fuel_stops ?? NO_FUEL_STOPS;
  // Suggested fuel stops the pilot took out of the route box (its chip's
  // Remove), for this route: left out of the box, the list and the map,
  // and put back by the route menu's Show Fuel Stops, at the owner's ask
  // ("Fuel stops should also have a way to delete them and add them back
  // as pleased", 2026-10-24). FPL's Routes keep their own card for them.
  const fuelRoute = `${planned.dep}|${planned.stops.join(",")}|${planned.dest ?? ""}`;
  const [hiddenFuel, setHiddenFuel] = useState<{ route: string; idents: string[] }>({ route: "", idents: [] });
  const hiddenHere = hiddenFuel.route === fuelRoute ? hiddenFuel.idents : NO_IDENTS;
  const fuelStops = useMemo(() => (hiddenHere.length
    ? allFuelStops.map(f => ({ ...f, stops: f.stops.filter(x => !hiddenHere.includes(x.ident)) })).filter(f => f.stops.length)
    : allFuelStops), [allFuelStops, hiddenHere]);
  const hideFuelStop = useCallback((ident: string) => setHiddenFuel(was => ({
    route: fuelRoute, idents: [...(was.route === fuelRoute ? was.idents : []), ident],
  })), [fuelRoute]);
  const showFuelStops = useCallback(() => setHiddenFuel({ route: "", idents: [] }), []);
  // The tanks for FPL's fuel at each point: the fuel check's usable fuel,
  // allowance and reserve, the first flight's where the route has stops
  // (each is filled again), the strictest reserve of them.
  const tankFigures = useMemo(() => {
    const t = local ? null : totals;
    const flights = t?.hops?.length ? t.hops.map(h => h.totals) : t ? [t] : [];
    const usable = flights[0]?.usable_fuel_gal;
    if (!usable) return null;
    return {
      usableGal: usable, taxiGal: flights[0]?.taxi_gal ?? 0,
      reserveGal: Math.max(0, ...flights.map(f => f.reserve_gal ?? 0)),
    };
  }, [local, totals]);
  // Their pins on the map, every flight's.
  const fuelStopPins = useMemo(() => fuelStops.flatMap(f => f.stops.map(({ ident, lat, lon }) => ({ ident, lat, lon, reason: f.reason }))), [fuelStops]);
  // A break the planner suggests on a long flight its tanks hold is the
  // pilot's own stop once kept, not a fuel stop (useFuelStops).
  const keepFuelStops = useCallback((after: string, idents: string[]) => {
    const next = withStopsAfter(planned.dep, planned.stops, after, idents);
    const isBreak = fuelStops.some(f => f.reason === "break" && [...f.stops, ...(f.choices ?? [])].some(c => idents.includes(c.ident)));
    if (next) setStops(next.stops, isBreak ? [] : next.added);
  }, [setStops, planned.dep, planned.stops, fuelStops]);
  // A field from the map's Stops put in the route after its flight's
  // departure, the pilot's own stop: by the route's own points, not its
  // course, which a tap before the course was in found missing.
  const addStopField = useCallback((field: { ident: string; departure?: string | null }) => {
    const next = withStopsAfter(planned.dep, planned.stops, field.departure ?? planned.dep, [field.ident]);
    if (next) setStops(next.stops);
  }, [setStops, planned.dep, planned.stops]);
  // Whether the pilot took any out here: the route menu's Show Fuel Stops.
  const fuelHidden = hiddenHere.length > 0;
  return { fuelStops, fuelHidden, hideFuelStop, showFuelStops, tankFigures, fuelStopPins, keepFuelStops, addStopField };
}
