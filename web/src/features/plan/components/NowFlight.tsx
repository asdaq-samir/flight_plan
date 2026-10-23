import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import type { FlightRoute, TrafficAircraft } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { SQUAWKS } from "../../../lib/squawks";
import type { Fix } from "../../../lib/map/ownShip";
import { nearInHeight } from "../../../lib/map/traffic";
import { awayFrom, nmAway } from "../../../lib/useAway";
import { TEXT } from "../../../lib/text";
import { altFt, bearing } from "../../../lib/units";
import { FlightEnds } from "./PastFlights";
import { lasted, placeOf } from "./pastFlightFormat";

/** Feet against own ship's: "500 ft above", "1,200 ft below", "level". */
function against(feet: number): string {
  const rounded = Math.round(feet / 100) * 100;
  if (rounded === 0) return "level";
  return `${altFt(Math.abs(rounded))} ft ${rounded > 0 ? "above" : "below"}`;
}

/**
 * The flight the airplane is on now, first in its Flights, at the owner's
 * ask ("Now tab can be removed and instead flights can have the now entry
 * on top as the latest"), laid out as FlightAware's entry for a flight in
 * the air: how long it has flown and its type; where it left -- the field
 * its track shows it on the ground at, else its flight number's route's
 * first -- and when, and where it is bound -- the route's last where it is
 * flying it -- else where it is now; then how it is flying (height and
 * climb, ground speed, track), its squawk, and, with own ship on, how far
 * and which way it is, how high against own ship, and when and how near
 * it comes, which FlightAware does not say. Seconds-old internet data
 * from adsb.lol's receivers: for knowing what is about, not for avoiding it.
 */
export default function NowFlight({ plane, type, departed, departedPlace, route, startedAt, fix, here, cpa, now }: {
  plane: TrafficAircraft;
  /** This device's clock, ms, counted on by the card. */
  now: number;
  type: string | null;
  departed: { ident: string; name?: string | null; at: number } | null;
  /** The field it left, for its town. */
  departedPlace: { city?: string | null; region?: string | null; name?: string | null } | null;
  /** Its flight number's route, where it is flying it. */
  route: FlightRoute | null;
  /** When this flight began, s: its takeoff, else its track's first report. */
  startedAt: number | null;
  fix: Fix | null;
  /** Where it is now, carried on from its report. */
  here: { lat: number; lon: number } | null;
  cpa: { inMin: number; nm: number; aboveFt: number | null } | null;
}) {
  const rate = plane.vertical_fpm ?? 0;
  const squawk = plane.squawk ?? null;
  const first = route?.airports[0] ?? null;
  const last = route && route.airports.length > 1 ? route.airports[route.airports.length - 1]! : null;
  const fromIdent = departed?.ident ?? first?.ident ?? "?";
  const climb = Math.abs(rate) >= 100 ? `${rate > 0 ? "↑" : "↓"} ${altFt(Math.abs(Math.round(rate / 100) * 100))} fpm` : "level";
  const flown = startedAt ? lasted(now / 1000 - startedAt) : null;
  return (
    // No footnote: the map credits adsb.lol where it draws the airplane,
    // and the owner asked for fewer ("Avoid putting so many footnotes").
    <ListGroup title="Now">
      <ListRow
        wide data-testid="flight-now"
        title={
          <span className="flex w-full flex-col gap-1.5 py-1">
            <span className={cn("flex items-center gap-2 font-semibold", TEXT.detail)}>
              <span className="size-2 shrink-0 rounded-full bg-go" aria-hidden />
              <span className="text-go-ink">{flown ? `In the air · ${flown}` : "In the air"}</span>
              {type && <span className="ml-auto text-muted-foreground">{type}</span>}
            </span>
            <FlightEnds
              // The field its track shows it leave, where it does (FlightAware's "Departed").
              testIds={{ from: departed ? "flight-departed" : undefined, to: "flight-bound" }}
              from={{
                ident: fromIdent,
                place: departed ? placeOf(departedPlace) ?? departed.name ?? null : first?.location ?? first?.name ?? null,
                when: departed ? clockTime(new Date(departed.at * 1000)) : null,
              }}
              to={last ? { ident: last.ident, place: last.location ?? last.name ?? null } : { ident: "Now" }}
            />
            <span className={cn("font-semibold text-foreground tabular-nums", TEXT.detail)} data-testid="flight-altitude">
              {plane.altitude_ft == null ? "—" : `${altFt(Math.round(plane.altitude_ft / 25) * 25)} ft`} {climb}
              {" · "}{plane.speed_kt == null ? "—" : `${Math.round(plane.speed_kt)} kt`}
              {plane.track_deg != null && ` · ${bearing(plane.track_deg)} true`}
            </span>
            {squawk && (
              <span
                className={cn("tabular-nums", TEXT.detail, SQUAWKS[squawk] ? "font-semibold text-destructive-ink" : "text-muted-foreground")}
                data-testid="flight-squawk"
              >
                Squawk {squawk}{SQUAWKS[squawk] ? ` · ${SQUAWKS[squawk]}` : ""}
              </span>
            )}
            {fix && here && (
              <span className={cn("text-muted-foreground", TEXT.detail)} data-testid="flight-from-you">
                {`${awayFrom({ lat: fix.lat, lon: fix.lon }, here)} of you`}
                {fix.altitudeFt != null && plane.altitude_ft != null ? `, ${against(plane.altitude_ft - fix.altitudeFt)}` : ""}
                {cpa && (
                  <span
                    data-testid="flight-closest"
                    className={cn(cpa.nm < 1 && (cpa.aboveFt == null || nearInHeight(cpa.aboveFt)) && "font-semibold text-destructive-ink")}
                  >
                    {" · closest "}{cpa.inMin < 0.5 ? "now, drawing apart" : `in ${Math.round(cpa.inMin)} min`}
                    {`: ${nmAway(cpa.nm)}${cpa.aboveFt != null ? `, ${against(cpa.aboveFt)}` : ""}`}
                  </span>
                )}
              </span>
            )}
          </span>
        }
      />
    </ListGroup>
  );
}
