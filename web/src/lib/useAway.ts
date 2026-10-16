import { distanceNm } from "./geo";
import { useOwnShip } from "./map/ownShip";
import type { RecentAirport } from "./preferences";

/** How far a kept airport is from own ship's fix as it is, for its tile's
 *  second line (Favorites' and Recents' tiles): nothing while own ship is
 *  off. */
export function useAway(): (airport: RecentAirport) => string | undefined {
  const from = useOwnShip(o => (o.enabled ? o.fix : null));
  return a => (from && a.lat !== undefined && a.lon !== undefined ? `${Math.round(distanceNm(from, { lat: a.lat, lon: a.lon }))} nm` : undefined);
}
