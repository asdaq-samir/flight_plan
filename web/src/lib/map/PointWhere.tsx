import { cn } from "cn";
import { degreesMinutes } from "../coords";
import { TEXT } from "../text";
import { awayFrom } from "../useAway";
import { useOwnFix } from "./ownShip";

/**
 * Where a point on the chart is, for its card -- a VFR waypoint's, a VOR's,
 * an enroute fix's: how far and which way from the airplane where its
 * position is known, and its latitude and longitude as a chart's margins
 * and a GPS write them. A VFR waypoint's card tapped with no route open had
 * its name alone, an empty sheet under it, which the owner took for one
 * still loading (2026-10-29).
 */
export function PointWhere({ lat, lon }: { lat: number; lon: number }) {
  const ship = useOwnFix();
  return (
    <p className={cn("flex flex-col gap-0.5 tabular-nums", TEXT.detail)} data-testid="point-where">
      {ship && <span>{awayFrom(ship, { lat, lon })} of you</span>}
      <span className="text-muted-foreground">{degreesMinutes({ lat, lon })}</span>
    </p>
  );
}
