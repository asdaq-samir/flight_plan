import { create } from "zustand";

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
}>(() => ({ addToRoute: null, directTo: null, avoidClassB: null }));
