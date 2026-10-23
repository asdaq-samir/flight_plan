import type { RouteOption } from "./api/types";
import { hoursMinutes } from "./clock";
import { sameField } from "./procedures";

/** A way's names, the kinds it is the best of (FPL's Routes, the map's lines). */
const KIND_TITLES: Record<RouteOption["kind"], string> = { fastest: "Fastest", weather: "Best Weather", stops: "Fewest Stops" };

export function wayTitle(option: RouteOption): string {
  return option.kinds.map(k => KIND_TITLES[k]).join(" · ");
}

/** "3 h 10 min", "45 min": a way's whole time, its stops' too. */
export function wayTime(option: RouteOption): string {
  const t = hoursMinutes(option.air_min + option.ground_min);
  return t.hours ? `${t.hours} h ${t.minutes} min` : `${t.minutes} min`;
}

/** Whether a way is the route as it is now: the same points in order. */
export function isRoute(option: RouteOption, stops: string[]): boolean {
  return option.stops.length === stops.length && option.stops.every((s, i) => sameField(s, stops[i]!));
}
