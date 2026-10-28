import { PlaneMark } from "../../../components/Favorites";
import { ListRow } from "../../../components/GroupedList";
import type { TrafficAircraft } from "../../../lib/api/types";
import type { LatLon } from "../../../lib/geo";
import { awayFrom } from "../../../lib/useAway";
import { trafficLabel } from "../../../lib/map/traffic";
import { altFt } from "../../../lib/units";

/** One airplane in a list: its name, what it is and how it flies, and
 *  how far and which way it is from `from`. */
export default function AircraftRow({ plane, from, ownFt, onPick, testId = "aircraft-row" }: {
  plane: TrafficAircraft; from: LatLon | null; ownFt: number | null; onPick: () => void; testId?: string;
}) {
  const where = from ? awayFrom(from, plane) : undefined;
  const height = plane.altitude_ft == null ? null
    : ownFt != null ? trafficLabel(plane, ownFt) : `${altFt(Math.round(plane.altitude_ft / 100) * 100)} ft`;
  return (
    <ListRow
      media={<PlaneMark small trackDeg={plane.track_deg ?? 45} />}
      title={<span className="font-semibold">{plane.callsign ?? plane.registration ?? plane.hex.toUpperCase()}</span>}
      description={[plane.type, height, plane.speed_kt != null ? `${Math.round(plane.speed_kt)} kt` : null].filter(Boolean).join(" · ")}
      value={where} chevron onClick={onPick} data-testid={testId}
    />
  );
}
