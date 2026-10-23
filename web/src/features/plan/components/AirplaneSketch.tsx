import { cn } from "cn";
import type { PlanePhoto } from "../../../lib/planePhoto";
import { TEXT } from "../../../lib/text";
import { PhotoSlide, PictureSlides } from "../../../components/PictureSlides";
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
  const drawn = points.length + (now ? 1 : 0) >= 2;
  const sketch = (
    <div className="relative size-full" data-testid="flight-trail">
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
  // A page at a time, across, as the airport card's pictures go
  // (PictureSlides): the sketch, then the photo.
  return (
    <PictureSlides
      label={`${name}: where it has flown${photo ? ", and its photo" : ""}`}
      className="min-w-0 flex-1 bg-background/70"
      slides={[
        sketch,
        photo && (
          <PhotoSlide
            key="photo" src={photo.src} alt={name} href={photo.link} label={`${name}'s photo on Planespotters`}
            // Planespotters' terms: the photographer named beside it.
            credit={`© ${photo.photographer} · Planespotters`} testId="flight-photo" creditTestId="flight-photo-credit"
          />
        ),
      ]}
    />
  );
}
