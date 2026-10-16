import { useState } from "react";
import { cn } from "cn";
import type { PlanePhoto } from "../../../lib/planePhoto";
import { TEXT } from "../../../lib/text";
import TrailSketch, { type SketchField } from "./TrailSketch";

/** The state on the sketch's corner: climbing, level or descending in the
 *  air; on the ground; or an emergency's code (AIM 6-2-2, 6-3-4, 6-4-2). */
export interface SketchBadge {
  word: string;
  tone: "air" | "ground" | "alarm";
}

const TONE = {
  air: "bg-teal-700",
  // iOS's dark grey: white on it reads at 7.7:1.
  ground: "bg-zinc-600",
  alarm: "bg-destructive",
} as const;

/**
 * The airplane card's picture, in the airport card's diagram's place, at
 * the owner's pick of the redesign: where it has flown, sketched (its
 * flight now, or where it is not heard its last), its state on the
 * corner ("And the status badge can be on the sketch") and its height and
 * speed or where it landed along the foot, each inside the box ("make sure
 * everything is visible in the sketch"); and, a swipe across, its photo
 * from Planespotters, the photographer named on it and the photo linked to
 * its page, where there is one. The dots under say which is shown.
 */
export default function AirplaneSketch({ name, points, now, trackDeg, from, to, badge, chip, photo }: {
  name: string;
  points: { lat: number; lon: number; altFt: number | null }[];
  now: { lat: number; lon: number; altFt: number | null } | null;
  trackDeg: number | null;
  from: SketchField | null;
  to: SketchField | null;
  badge: SketchBadge | null;
  /** Along its foot: "4,500 ft · 112 kt", "Landed KPSM 16:02". */
  chip: string | null;
  photo: PlanePhoto | null;
}) {
  const [page, setPage] = useState(0);
  const drawn = points.length + (now ? 1 : 0) >= 2;
  const sketch = (
    <div className="relative size-full shrink-0 snap-start" data-testid="flight-trail">
      {drawn ? (
        // Drawn between the corner's state and the foot's line, so neither
        // covers any of it.
        <div className={cn("absolute inset-x-1", badge ? "top-6" : "top-1", chip ? "bottom-7" : "bottom-1")}>
          <TrailSketch points={points} now={now} trackDeg={trackDeg} from={from} to={to} />
        </div>
      ) : (
        <p className={cn("flex size-full items-center justify-center px-2 text-center text-muted-foreground", TEXT.note)}>
          No flights heard
        </p>
      )}
      {badge && (
        <span
          className={cn("pointer-events-none absolute top-1.5 left-1.5 rounded-md px-1 font-bold text-white", TEXT.caption, TONE[badge.tone])}
          data-testid="flight-state"
        >{badge.word}</span>
      )}
      {chip && (
        <span
          className={cn("pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 w-fit max-w-[calc(100%-0.75rem)] truncate rounded-md bg-background/80 px-1 font-semibold text-foreground", TEXT.note)}
          data-testid="flight-chip"
        >{chip}</span>
      )}
    </div>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
      <div
        // A page at a time, across, as iOS's page views go: the sketch, then
        // the photo. Its own sideways scroll, which the tabs' swipe leaves
        // to it (TabBar) and the audit knows is meant (data-slides).
        className={cn(
          "flex min-h-0 flex-1 snap-x snap-mandatory overflow-hidden rounded-xl bg-background/70 [scrollbar-width:none]",
          photo && "overflow-x-auto",
        )}
        data-slides={photo ? "" : undefined}
        onScroll={event => {
          const box = event.currentTarget;
          setPage(Math.round(box.scrollLeft / Math.max(1, box.clientWidth)));
        }}
      >
        {sketch}
        {photo && (
          <a
            href={photo.link} target="_blank" rel="noopener"
            className="relative block size-full shrink-0 snap-start overflow-hidden" data-testid="flight-photo"
          >
            <img src={photo.src} alt={name} width={photo.width} height={photo.height} loading="lazy" className="size-full object-cover" />
            {/* Planespotters' terms: the photographer named beside it. */}
            <span className={cn("absolute inset-x-0 bottom-0 line-clamp-2 bg-black/60 px-1.5 py-0.5 break-words text-white", TEXT.caption)} data-testid="flight-photo-credit">
              © {photo.photographer} · Planespotters
            </span>
          </a>
        )}
      </div>
      {photo && (
        <div className="flex justify-center gap-1.5" aria-hidden="true">
          {[0, 1].map(i => (
            <span key={i} className={cn("size-1.5 rounded-full", i === page ? "bg-foreground" : "bg-muted-foreground/40")} />
          ))}
        </div>
      )}
    </div>
  );
}
