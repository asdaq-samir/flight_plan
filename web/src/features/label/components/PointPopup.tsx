import Badge from "../../../components/Badge";
import { isEndpoint, type Point, type Rating } from "../../../lib/api/types";
import { CATEGORIES, COLORS, compassPoint, roleOf } from "../logic";

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
}: Props) {
  if (isEndpoint(point)) {
    return (
      <div className="min-w-[150px] text-sm">
        <Badge color="#142430">{point.category === "departure" ? "DEP" : "DEST"}</Badge>{" "}
        <b>{point.ident}</b>
        <div className="text-slate-500">{point.name}</div>
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
    <div className="min-w-[210px] space-y-2 text-sm">
      {place && (
        <div className={`rounded px-0.5 text-slate-500 ${
          countChanged ? "animate-[count-flash_0.8s_ease-out]" : ""
        }`}>
          #{place}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {RATINGS.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => onRate(r)}
            className={`rounded px-1.5 py-1 text-xs font-semibold text-white ${
              rating === r ? "ring-2 ring-offset-1 ring-slate-800" : "opacity-70 hover:opacity-100"
            }`}
            style={{ backgroundColor: COLORS[r] }}
          >
            {r}
          </button>
        ))}
      </div>

      <select
        value={category}
        onChange={e => onCategoryChange(e.target.value)}
        className="w-full rounded border border-slate-300 px-1.5 py-1"
      >
        {options.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <div className="space-y-0.5 text-slate-500">
        <div>{point.along_track_nm.toFixed(1)} nm {compassPoint(bearingDeg)} of {departureIdent}</div>
        {/* DR points are on the line by definition (that's what makes
            them DR) -- the distance only means something for a visual
            point, which is picked precisely because it sits off it. */}
        {roleOf(point) === "visual" && <div>{Math.abs(cross).toFixed(2)} nm off course</div>}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="w-full rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50"
      >
        Remove point
      </button>
    </div>
  );
}
