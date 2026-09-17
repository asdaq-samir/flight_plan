import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { isEndpoint, type Point, type Rating } from "../../../lib/api/types";
import { CATEGORIES, COLORS, compassPoint, roleOf, sourceOf } from "../logic";

interface Props {
  point: Point;
  /** "3 of 12", or "" when the point isn't in the current walk. */
  place: string;
  /** True only when the total just went up (more detections streamed
   *  in) -- not on every popup refresh, e.g. a rating click. */
  countChanged: boolean;
  /** The course's own bearing and departure ident, so distance reads as
   *  a direction on the chart rather than "along" an axis nobody sees. */
  bearingDeg: number;
  departureIdent: string;
  onRate: (rating: Rating) => void;
  onCategoryChange: (category: string) => void;
  onRemove: () => void;
  /** Touch has no arrow keys, so stepping needs an on-screen equivalent
   *  too. Named by screen side, not by step direction: which one moves
   *  forward through the route depends on the course's own bearing (a
   *  route running west has "forward" on the left), so the caller
   *  works that out and hands over whichever action belongs on which
   *  side -- this component just draws two arrows. */
  onLeft?: () => void;
  onRight?: () => void;
  canLeft?: boolean;
  canRight?: boolean;
}

const RATINGS: Rating[] = [0, 1, 2, 3, 4, 5];

/**
 * Everything about the selected point, in one Leaflet popup pinned above
 * it -- the info that used to be a separate tooltip, and the rating/
 * category controls that used to live in the sidebar, combined so
 * there's one place on screen this happens, right where the point is.
 */
export default function PointPopup({
  point, place, countChanged, bearingDeg, departureIdent, onRate, onCategoryChange, onRemove,
  onLeft, onRight, canLeft = true, canRight = true,
}: Props) {
  // Same row either way -- an endpoint is the first or last stop in the
  // walk, and needs a way off itself just as much as any other point
  // does (this used to be endpoint-only content with no arrows at all,
  // which meant landing on departure via "Start" had no way forward).
  const arrows = (place || onLeft || onRight) && (
    <div className="flex items-center justify-between gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={onLeft}
        disabled={!onLeft || !canLeft}
        aria-label="Step left"
        className="flex-shrink-0 rounded-full"
      >
        <ChevronLeft className="size-5" strokeWidth={3} />
      </Button>
      {place && (
        <div className={`rounded px-0.5 text-muted-foreground ${
          countChanged ? "animate-[count-flash_0.8s_ease-out]" : ""
        }`}>
          #{place}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={onRight}
        disabled={!onRight || !canRight}
        aria-label="Step right"
        className="flex-shrink-0 rounded-full"
      >
        <ChevronRight className="size-5" strokeWidth={3} />
      </Button>
    </div>
  );

  if (isEndpoint(point)) {
    return (
      <div className="space-y-2 text-sm">
        {arrows}
        <div>
          <Badge style={{ backgroundColor: "#142430", color: "white" }}>
            {point.category === "departure" ? "DEP" : "DEST"}
          </Badge>{" "}
          <b>{point.ident}</b>
          <div className="text-muted-foreground">{point.name}</div>
        </div>
      </div>
    );
  }

  const rating = (point as { rating: Rating | null }).rating;
  const category = (point as { category: string }).category;
  const cross = (point as { cross_track_nm: number }).cross_track_nm ?? 0;
  const options = (CATEGORIES as readonly string[]).includes(category)
    ? CATEGORIES
    : [category, ...CATEGORIES];

  return (
    <div className="space-y-2 text-sm">
      {arrows}

      {/* No flex-wrap: Leaflet measures a popup's width by briefly
          forcing everything onto one line, and a row that's still
          allowed to wrap at that moment gets measured at whatever
          narrower, wrapped width it happens to collapse to instead of
          its real one-line width -- pinning this row flat gives it (and
          so the popup) a stable, correctly-measured width instead. */}
      {/* data-rating-row: how leaflet.tsx's createHalo measures this
          popup's real width in whichever browser opens it, rather than
          trusting a pixel constant tuned on a different one. */}
      <div className="flex gap-1" data-rating-row>
        {RATINGS.map(r => (
          <Button
            key={r}
            type="button"
            variant="ghost"
            onClick={() => onRate(r)}
            className={`h-9 px-2.5 font-bold text-white hover:text-white ${
              rating === r ? "ring-2 ring-offset-1 ring-foreground" : "opacity-70 hover:opacity-100"
            }`}
            style={{ backgroundColor: COLORS[r] }}
          >
            {r}
          </Button>
        ))}
      </div>

      <Select value={category} onValueChange={onCategoryChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="space-y-0.5 text-muted-foreground">
        <div>{point.along_track_nm.toFixed(1)} nm {compassPoint(bearingDeg)} of {departureIdent}</div>
        {/* DR points are on the line by definition (that's what makes
            them DR) -- the distance only means something for a visual
            point, which is picked precisely because it sits off it. */}
        {roleOf(point) === "visual" && <div>{Math.abs(cross).toFixed(2)} nm off course</div>}
      </div>

      <Button type="button" variant="destructive" onClick={onRemove} className="w-full">
        {/* A detected point is still a detection either way -- this
            only ever unrates it. An added point exists purely as a
            pick, so the same action really does delete it. */}
        {sourceOf(point) === "added" ? "Remove point" : "Reset rating"}
      </Button>
    </div>
  );
}
