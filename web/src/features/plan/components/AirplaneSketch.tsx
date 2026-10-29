import { cn } from "cn";
import { TEXT } from "../../../lib/text";
import TrailSketch, { type SketchField } from "./TrailSketch";

/**
 * Where an airplane has flown, sketched -- its flight now, or where it is
 * not heard its last -- a page of the pictures across its card's top
 * (FlightCard's PhotoHead), after its photo: drawn in the top of the box,
 * clear of its name set over the box's foot.
 */
export default function AirplaneSketch({ points, now, trackDeg, from, to }: {
  points: { lat: number; lon: number; altFt: number | null }[];
  now: { lat: number; lon: number; altFt: number | null } | null;
  trackDeg: number | null;
  from: SketchField | null;
  to: SketchField | null;
}) {
  const drawn = points.length + (now ? 1 : 0) >= 2;
  return (
    <div className="relative size-full bg-background" data-testid="flight-trail">
      {drawn ? (
        <div className="absolute inset-x-4 top-8 bottom-24">
          <TrailSketch points={points} now={now} trackDeg={trackDeg} from={from} to={to} />
        </div>
      ) : (
        <p className={cn("flex size-full items-start justify-center px-2 pt-16 text-center text-muted-foreground", TEXT.note)}>
          No flights heard
        </p>
      )}
    </div>
  );
}
