import { ChevronLeft, ChevronRight } from "lucide-react";
import IconButton from "../../../components/IconButton";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { MapCard } from "../../../lib/map/MapCard";
import { isEndpoint, type Point, type Rating } from "../../../lib/api/types";
import { inkOn } from "../../../lib/scoreScale";
import { CATEGORIES, COLORS, RATINGS, compassPoint, roleOf, sourceOf } from "../logic";

interface Props {
  point: Point;
  /** "3 of 12", or "" when the point isn't in the current walk. */
  place: string;
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


/**
 * Everything about the selected point, in one Leaflet popup pinned above
 * it -- the info that used to be a separate tooltip, and the rating/
 * category controls that used to live in the sidebar, combined so
 * there's one place on screen this happens, right where the point is.
 */
export default function PointPopup({
  point, place, bearingDeg, departureIdent, onRate, onCategoryChange, onRemove,
  onLeft, onRight, canLeft = true, canRight = true,
}: Props) {
  // Same row either way -- an endpoint is the first or last stop in the
  // walk, and needs a way off itself just as much as any other point
  // does (this used to be endpoint-only content with no arrows at all,
  // which meant landing on departure via "Start" had no way forward).
  // The close sits at the row's end, where Leaflet's own would be.
  /** The two steps, drawn either side of the title: the card's heading
   *  reads "back, where you are, forward", which is what a rating pass
   *  is doing. They keep their 40px target -- this is how the pass
   *  moves on a touchscreen, not corner chrome. */
  const stepLeft = (
    <IconButton
      type="button" label="Step left" variant="outline" size="icon-lg"
      onClick={onLeft} disabled={!onLeft || !canLeft} className="flex-shrink-0 rounded-full"
    >
      <ChevronLeft className="size-5" strokeWidth={3} />
    </IconButton>
  );
  const stepRight = (
    <IconButton
      type="button" label="Step right" variant="outline" size="icon-lg"
      onClick={onRight} disabled={!onRight || !canRight} className="flex-shrink-0 rounded-full"
    >
      <ChevronRight className="size-5" strokeWidth={3} />
    </IconButton>
  );

  const counter = place && <span className="rounded px-0.5">#{place}</span>;


  if (isEndpoint(point)) {
    return (
      <MapCard
        // Falls back to the ident when this point is not in the current
        // walk, so the card never opens with no title at all.
        title={<>{stepLeft}{counter || point.ident}{stepRight}</>}
        subtitle={
          <span className="flex items-center gap-1.5">
            <Badge variant="secondary">{point.category === "departure" ? "DEP" : "DEST"}</Badge>
            {point.ident} · {point.name}
          </span>
        }
      />
    );
  }

  const rating = (point as { rating: Rating | null }).rating;
  const category = (point as { category: string }).category;
  const cross = (point as { cross_track_nm: number }).cross_track_nm ?? 0;
  const options = (CATEGORIES as readonly string[]).includes(category)
    ? CATEGORIES
    : [category, ...CATEGORIES];

  return (
    <MapCard

      title={<>{stepLeft}{counter || category}{stepRight}</>}
      subtitle={
        <>
          {point.along_track_nm.toFixed(1)} nm {compassPoint(bearingDeg)} of {departureIdent}
          {/* DR points are on the line by definition (that's what makes
              them DR) -- the distance only means something for a visual
              point, which is picked precisely because it sits off it. */}
          {roleOf(point) === "visual" && <> · {Math.abs(cross).toFixed(2)} nm off course</>}
        </>
      }
    >
      {/* No flex-wrap: Leaflet measures a popup's width by briefly
          forcing everything onto one line, and a row that's still
          allowed to wrap at that moment gets measured at whatever
          narrower, wrapped width it happens to collapse to instead of
          its real one-line width -- pinning this row flat gives it (and
          so the popup) a stable, correctly-measured width instead. */}
      <div className="flex gap-1">
        {RATINGS.map(r => (
          <Button
            key={r}
            type="button"
            variant="ghost"
            onClick={() => onRate(r)}
            className={`h-9 px-2.5 font-bold ${
              rating === r ? "ring-2 ring-offset-1 ring-foreground" : "opacity-70 hover:opacity-100"
            }`}
            style={{ backgroundColor: COLORS[r], color: inkOn(COLORS[r]) }}
          >
            {r}
          </Button>
        ))}
      </div>

      {/* Unlabelled: the select shows the category it would change, a
          dropdown reads as a control without being told, and the card
          is opened a few hundred times in a rating pass -- every word
          in it is a word of chart it covers. */}
      <div className="flex items-center gap-2">
        <Select value={category} onValueChange={onCategoryChange}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Button type="button" size="sm" variant="destructive" onClick={onRemove} className="w-full">
        {/* A detected point is still a detection either way -- this
            only ever unrates it. An added point exists purely as a
            pick, so the same action really does delete it. */}
        {sourceOf(point) === "added" ? "Remove point" : "Reset rating"}
      </Button>
    </MapCard>
  );
}
