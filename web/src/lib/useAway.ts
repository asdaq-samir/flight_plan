import { compassPoint } from "./compass";
import { bearingDeg, distanceNm, type LatLon } from "./geo";
import { useOwnFix } from "./map/ownShip";
import type { RecentAirport } from "./preferences";

/** How far, as a figure: to a tenth under 10 nm, where a few tenths are
 *  worth saying -- an airplane 2.3 nm off, a field 4.6 nm away -- and whole
 *  miles from there. One field read "12 nm" on Nearest's strip and "12.3
 *  nm" in its list and on its card. */
export function nmFigure(nm: number): string {
  const tenths = Math.round(nm * 10) / 10;
  return tenths < 10 ? tenths.toFixed(1) : String(Math.round(nm));
}

/** How far, with its unit: "4.6 nm", "12 nm". */
export const nmAway = (nm: number) => `${nmFigure(nm)} nm`;

/** How far and which way from `from`: "4.6 nm NE". */
export function awayFrom(from: LatLon, to: LatLon): string {
  return `${nmAway(distanceNm(from, to))} ${compassPoint(bearingDeg(from, to))}`;
}

/** How far and which way the point is from the airplane ("12 nm NE of
 *  you"), for a card's pill; none where the position is not known. */
export function useAwayWords(lat: number, lon: number): string | undefined {
  const ship = useOwnFix();
  return ship ? `${awayFrom(ship, { lat, lon })} of you` : undefined;
}

/** A kept airport's tile's second line -- Home's, the Favorites', the
 *  Recents', the search's and the route pickers' -- how far it is from own
 *  ship's fix as it is, else its town, else its name. Each strip had its
 *  own: the town in one, nothing or Home's ident in another. */
export function useAway(): (airport: RecentAirport) => string {
  const from = useOwnFix();
  return a => (from && a.lat !== undefined && a.lon !== undefined
    ? nmAway(distanceNm(from, { lat: a.lat, lon: a.lon }))
    : a.municipality || a.name);
}
