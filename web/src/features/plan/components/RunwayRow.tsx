import { ListRow } from "../../../components/GroupedList";
import type { Runway } from "../../../lib/api/types";
import { runwayWind, surfaceName } from "../format";

/** A runway as an airport's card and the briefing list it: its ends, its
 *  surface and lights, its size, and the reported wind on the end it
 *  favours. */
export function RunwayRow({ runway }: { runway: Runway }) {
  const detail = [surfaceName(runway.surface), runway.lighted && "lighted", runway.closed && "closed"].filter(Boolean).join(" · ");
  return (
    <ListRow
      title={`Runway ${runway.ends ?? "—"}`}
      description={(detail || runway.wind) && (
        <>
          {detail && <span className="block">{detail}</span>}
          {runway.wind && <span className="block" data-testid="runway-wind">{runwayWind(runway.wind)}</span>}
        </>
      )}
      value={runway.length_ft ? `${runway.length_ft.toLocaleString()} × ${runway.width_ft ?? "—"} ft` : "—"}
    />
  );
}
