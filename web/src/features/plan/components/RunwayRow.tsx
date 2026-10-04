import { ListRow } from "../../../components/GroupedList";
import type { Runway } from "../../../lib/api/types";
import { cn } from "cn";
import { runwayWind, surfaceName } from "../format";
import { usePreferences } from "../../../lib/preferences";

/** A runway as an airport's card and the briefing list it: its ends, its
 *  surface and lights, its size, and the reported wind on the end it
 *  favours -- in amber where its crosswind is over the pilot's own
 *  minimum (lib/minimums). */
export function RunwayRow({ runway }: { runway: Runway }) {
  const detail = [surfaceName(runway.surface), runway.lighted && "lighted", runway.closed && "closed"].filter(Boolean).join(" · ");
  const most = usePreferences(s => s.minimums.crosswindKt);
  const wind = runway.wind;
  const over = !!wind && most != null && Math.max(Math.abs(wind.crosswind_kt), Math.abs(wind.gust_crosswind_kt ?? 0)) > most;
  return (
    <ListRow
      title={`Runway ${runway.ends ?? "—"}`}
      description={(detail || runway.wind) && (
        <>
          {detail && <span className="block">{detail}</span>}
          {wind && (
            <span className={cn("block", over && "font-medium text-amber-700 dark:text-amber-400")} data-testid="runway-wind">
              {runwayWind(wind)}{over && `, over your ${most} kt`}
            </span>
          )}
        </>
      )}
      value={runway.length_ft ? `${runway.length_ft.toLocaleString()} × ${runway.width_ft ?? "—"} ft` : "—"}
    />
  );
}
