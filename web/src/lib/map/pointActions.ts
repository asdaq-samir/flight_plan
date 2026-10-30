import { create } from "zustand";
import type { Station } from "../navaid";

/** A point on the chart a card can send the route to: a VOR, a fix. */
export type ChartPoint = { ident: string; lat: number; lon: number };

/**
 * What the map's point cards (a VOR's, a fix's, NavaidsLayer) can do with
 * the route, given by the planner's page (PlanWorkspace) while there is a
 * route to do it to: Add to Route, the point a stop where it fits best;
 * Direct To, from where the airplane is to the point and on along the
 * route. None on a page with no route, the tiles then left out.
 */
export const usePointActions = create<{
  addToRoute: ((point: ChartPoint) => void) | null;
  directTo: ((point: ChartPoint) => void) | null;
  /** The route planned round the Class B (the planner's Avoid Class B),
   *  from a Class B's card, while it goes through. */
  avoidClassB: (() => void) | null;
  /** The route's course line, [lat, lon], for an area's card to say
   *  whether the route goes through it (a TFR's). */
  courseLine: readonly (readonly [number, number])[] | null;
  /** The VORs on the map (NavaidsLayer), for a point's place off the
   *  nearest. */
  stations: readonly Station[];
}>(() => ({ addToRoute: null, directTo: null, avoidClassB: null, courseLine: null, stations: [] }));
