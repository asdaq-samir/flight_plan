import type { RouteOption, RouteOptions } from "./api/types";
import { minutesWords } from "./clock";
import { sameField } from "./procedures";

/** How the planner's grid times the route itself against its nav log
 *  (`ownMinutes`): the ways' air times scaled by it are told on one clock
 *  with the route's (the route line's ways on the map). 1 where either is not known. */
export function gridScale(found: RouteOptions | undefined, ownMinutes: number | null | undefined): number {
  // The route's own grid time: its weather strip's minutes, else its own
  // way's air time where that way adds no stop (RouteOptions.own) -- with
  // neither, the two clocks are told as they are.
  const bands = (found?.current_along?.bands ?? []).reduce((sum, b) => sum + b.min, 0);
  const grid = bands || (found?.own && !found.own.fuel.length ? found.own.air_min : 0);
  return ownMinutes && grid > 0 ? ownMinutes / grid : 1;
}

/** "3 h 10 min", "45 min": a way's whole time, its stops' too, its air
 *  time on the route's clock (`scale`, gridScale). */
export function wayTime(option: RouteOption, scale = 1): string {
  return minutesWords(option.air_min * scale + option.ground_min);
}

/** Whether two routes' stops are the same points in order. */
export function sameStops(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((stop, i) => sameField(stop, b[i]!));
}
