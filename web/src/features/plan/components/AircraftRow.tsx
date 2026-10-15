import { Plane } from "lucide-react";
import { ListRow } from "../../../components/GroupedList";
import type { TrafficAircraft } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { bearingDeg, distanceNm, type LatLon } from "../../../lib/geo";
import { trafficLabel } from "../../../lib/map/traffic";
import { altFt } from "../../../lib/units";

/** One airplane in a list: its name, what it is and how it flies, and
 *  how far and which way it is from `from`. */
export default function AircraftRow({ plane, from, ownFt, onPick, testId = "aircraft-row" }: {
  plane: TrafficAircraft; from: LatLon | null; ownFt: number | null; onPick: () => void; testId?: string;
}) {
  const where = from ? `${distanceNm(from, plane).toFixed(1)} nm ${compassPoint(bearingDeg(from, plane))}` : undefined;
  const height = plane.altitude_ft == null ? null
    : ownFt != null ? trafficLabel(plane, ownFt) : `${altFt(Math.round(plane.altitude_ft / 100) * 100)} ft`;
  return (
    <ListRow
      media={<Plane className="size-5 text-muted-foreground" style={{ transform: `rotate(${(plane.track_deg ?? 45) - 45}deg)` }} />}
      title={<span className="font-semibold">{plane.callsign ?? plane.registration ?? plane.hex.toUpperCase()}</span>}
      description={[plane.type, height, plane.speed_kt != null ? `${Math.round(plane.speed_kt)} kt` : null].filter(Boolean).join(" · ")}
      value={where} chevron onClick={onPick} data-testid={testId}
    />
  );
}
