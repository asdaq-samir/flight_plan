import type { RouteOption, RouteOptions } from "./api/types";
import { hoursMinutes } from "./clock";
import { sameField } from "./procedures";

/** A way's names, the kinds it is the best of (FPL's Routes, the map's lines). */
const KIND_TITLES: Record<RouteOption["kind"], string> = { fastest: "Fastest", weather: "Best Weather", stops: "", own: "" };

/** The ways FPL offers (the owner's four routes, 2026-10-23: the route,
 *  it with its fuel stops, the best weather's and the fastest, each with
 *  its fuel stops): the planner's fewest-stops way is not one of them. */
export function offered(option: RouteOption): boolean {
  return option.kinds.some(k => k === "fastest" || k === "weather");
}

export function wayTitle(option: RouteOption): string {
  return option.kinds.map(k => KIND_TITLES[k]).filter(Boolean).join(" · ");
}

/** How the planner's grid times the route itself against its nav log
 *  (`ownMinutes`): the ways' air times scaled by it are told on one clock
 *  with the route's (RouteChoices). 1 where either is not known. */
export function gridScale(found: RouteOptions | undefined, ownMinutes: number | null | undefined): number {
  const grid = (found?.current_along?.bands ?? []).reduce((sum, b) => sum + b.min, 0);
  return ownMinutes && grid > 0 ? ownMinutes / grid : 1;
}

/** "3 h 10 min", "45 min": a way's whole time, its stops' too, its air
 *  time on the route's clock (`scale`, gridScale). */
export function wayTime(option: RouteOption, scale = 1): string {
  const t = hoursMinutes(option.air_min * scale + option.ground_min);
  return t.hours ? `${t.hours} h ${t.minutes} min` : `${t.minutes} min`;
}

/** Whether a way is the route as it is now: the same points in order. */
export function isRoute(option: RouteOption, stops: string[]): boolean {
  return option.stops.length === stops.length && option.stops.every((s, i) => sameField(s, stops[i]!));
}

/** Whether FPL has routes to offer for one with these stops: a way not the
 *  route itself, its fuel stops' card, or something it meets to say. */
export function routesOffered(found: RouteOptions | undefined, stops: string[], withFuel: boolean): boolean {
  if (!found) return false;
  const meets = stops.length ? found.current : found.direct;
  return meets.length > 0 || withFuel || found.options.some(o => offered(o) && !isRoute(o, stops));
}
