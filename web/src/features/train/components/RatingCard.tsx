import { cn } from "cn";
import { Button } from "../../../components/ui/button";
import { isEndpoint, type Point, type Rating } from "../../../lib/api/types";
import { inkOn } from "../../../lib/scoreScale";
import { TEXT } from "../../../lib/text";
import { COLORS, RATINGS, modelNote, prettyCategory } from "../logic";
import { capitalised } from "../../../lib/advisories";

/** What the scale's ends and middle mean, under the buttons -- the
 *  Guide's scale (RatingGuide) in one line, each term kept whole where
 *  the line wraps. */
const SCALE_KEY = ["0 not a feature", "3 workable", "5 unmistakable"]
  .map(term => term.replaceAll(" ", " ")).join(" · ");

/**
 * The point to rate, in the training page's pill and all the way up under
 * the route (the owner's pick of the dev page's redesign): its number and
 * kind, where it is and what the model scored it, and the six ratings big
 * enough for a thumb -- the map popup's and the digit keys' scale. A
 * rating moves on to the next point (TrainWorkspace's `onRate`), so a
 * route rates from here top to bottom. With nothing picked, a way to the
 * first point not yet rated.
 */
export default function RatingCard({ point, number, onRate, onStart }: {
  /** The point picked, if it is one to rate (not an end of the route). */
  point: Point | null;
  /** Its place among the route's points, as the list numbers it. */
  number: number | null;
  onRate: (rating: Rating) => void;
  /** To the first point not yet rated; none when every one is. */
  onStart?: () => void;
}) {
  if (!point || isEndpoint(point)) {
    return (
      <div className="flex w-full items-center gap-3 rounded-xl bg-background/70 px-3 py-2.5" data-testid="rating-card">
        <p className={cn("min-w-0 flex-1 truncate", TEXT.prose)}>{onStart ? "The next point not yet rated" : "Every point here is rated"}</p>
        {onStart && <Button type="button" size="sm" onClick={onStart} data-testid="rating-start">Start</Button>}
      </div>
    );
  }
  const rating = (point as { rating: Rating | null }).rating;
  const kind = prettyCategory((point as { category: string }).category);
  const where = [`${point.along_track_nm.toFixed(1)} nm out`, modelNote(point)].filter(Boolean).join(" · ");
  return (
    <div className="flex w-full flex-col gap-2 rounded-xl bg-background/70 px-3 py-2" data-testid="rating-card">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={cn("shrink-0 font-semibold", TEXT.row)}>{number != null && `${number} · `}{capitalised(kind)}</span>
        <span className={cn("min-w-0 truncate text-muted-foreground", TEXT.detail)}>{where}</span>
      </div>
      {/* Six across the card, eight apart: each 40 tall, its 44-point hit
          area its own (index.css), not grown to it. */}
      <div className="grid grid-cols-6 gap-2" role="group" aria-label="Rate this waypoint">
        {RATINGS.map(r => (
          <Button
            key={r} type="button" onClick={() => onRate(r)}
            aria-label={`Rate ${r}`} aria-pressed={rating === r}
            className={cn("h-10 px-0 text-base font-bold", rating === r && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}
            style={{ backgroundColor: COLORS[r], color: inkOn(COLORS[r]) }}
          >
            {r}
          </Button>
        ))}
      </div>
      {/* All the way up, under the buttons; in the pill the room is theirs
          (MapPanel's data-pill-hides). */}
      <p className={cn("text-foreground/70 in-data-capsule:hidden", TEXT.note)}>{SCALE_KEY}</p>
    </div>
  );
}
