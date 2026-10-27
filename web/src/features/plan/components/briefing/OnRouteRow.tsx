import { Route } from "lucide-react";
import { ListRow } from "../../../../components/GroupedList";
import type { Briefing, OnRoute } from "../../../../lib/api/types";
import { legLines, onRouteLine } from "../../../../lib/onRoute";
import { useLegHighlight } from "../../../../lib/map/legHighlight";

/**
 * Under a hazard's row in the Brief, where and when the flight meets it
 * -- "Legs 2–3 · 14:20–14:45, valid till 15:00", the planner's
 * (Briefing's `on_route`) -- and a tap shows those legs on the map, a
 * second puts them away: in the tint, as everything tappable is. None
 * for a hazard the planner could not place.
 */
export default function OnRouteRow({ on, briefing, hazardKey }: { on: OnRoute | null | undefined; briefing: Briefing; hazardKey: string }) {
  const toggle = useLegHighlight(s => s.toggle);
  const shown = useLegHighlight(s => s.shown?.key === hazardKey);
  if (!on || on.legs.length === 0) return null;
  return (
    <ListRow
      media={<Route className="size-4" aria-hidden />}
      title={onRouteLine(on)}
      aria-label={`${onRouteLine(on)}. ${shown ? "Shown on the map" : "Show on the map"}`}
      onClick={() => toggle(hazardKey, legLines(on.legs, briefing.leg_fixes ?? []))}
      data-testid="on-route"
      data-shown={shown || undefined}
    />
  );
}
