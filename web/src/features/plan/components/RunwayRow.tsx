import { ListRow } from "../../../components/GroupedList";
import type { Runway } from "../../../lib/api/types";
import { cn } from "cn";
import { runwayWind, surfaceName } from "../format";
import { usePreferences } from "../../../lib/preferences";
import { runwayNumber } from "../../../lib/pattern";
import { RowBadge } from "../../../components/RowBadge";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { grouped } from "../../../lib/units";

/** A runway drawn on its badge, laid along its true heading as the
 *  chart lays it (north up), its centre line dashed; upright where its
 *  heading is not known. */
function RunwayGlyph({ headingDeg }: { headingDeg: number | null }) {
  return (
    <RowBadge colour={BADGE.runway}>
      <svg viewBox="-9 -9 18 18" fill="none">
        <g transform={`rotate(${headingDeg ?? 0})`}>
          <rect x="-2.6" y="-8.5" width="5.2" height="17" rx="1" fill="currentColor" />
          <line x1="0" y1="-6.5" x2="0" y2="6.5" stroke={BADGE.runway} strokeWidth="0.9" strokeDasharray="1.6 1.4" />
        </g>
      </svg>
    </RowBadge>
  );
}

/** A runway as an airport's card and the briefing list it: its ends, its
 *  surface and lights, its size, and the reported wind on the end it
 *  favours -- in amber where its crosswind is over the pilot's own
 *  minimum (lib/minimums) -- and any end flown with right traffic. */
export function RunwayRow({ runway }: { runway: Runway }) {
  // An end flown with right traffic is said, as the sectional's "RP 23"
  // says it: the rest are left, as every pattern is unless the FAA says.
  const right = (runway.runway_ends ?? []).filter(e => e.traffic === "right").map(e => runwayNumber(e.ident));
  const detail = [
    surfaceName(runway.surface), runway.lighted && "lighted", runway.closed && "closed",
    right.length > 0 && `right traffic ${right.join(", ")}`,
  ].filter(Boolean).join(" · ");
  const most = usePreferences(s => s.minimums.crosswindKt);
  const wind = runway.wind;
  const over = !!wind && most != null && Math.max(Math.abs(wind.crosswind_kt), Math.abs(wind.gust_crosswind_kt ?? 0)) > most;
  const heading = (runway.runway_ends ?? []).find(e => e.heading_true_deg != null)?.heading_true_deg ?? null;
  return (
    <ListRow
      media={<RunwayGlyph headingDeg={heading} />}
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
      // How long, the figure a pilot looks for, at the right in the text's
      // own colour, as Nearest has a field's distance; how wide under it.
      value={runway.length_ft ? (
        <span className="flex flex-col items-end">
          <span className="font-semibold text-foreground">{grouped(runway.length_ft)} ft</span>
          {runway.width_ft != null && <span className={cn("text-muted-foreground", TEXT.note)}>{runway.width_ft} ft wide</span>}
        </span>
      ) : "—"}
    />
  );
}
