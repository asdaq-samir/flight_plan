import { lazy, Suspense, useState, type ReactNode } from "react";
import { cn } from "cn";
import { ListRow } from "../../../components/GroupedList";
import { diagramPicture } from "../../../lib/diagram";

const ChartViewer = lazy(() => import("./AirportDiagramViewer"));
const FaaChartViewer = lazy(() => import("./AirportDiagramViewer").then(m => ({ default: m.FaaChartViewer })));

/**
 * An airport diagram's picture as a button that opens it full screen, to
 * pinch in on (AirportDiagramViewer, fetched at the first tap): the whole
 * sheet in the card's Diagram tab (PublicationRows). On the diagram's own white paper,
 * and black at night, where the diagram is drawn white on it.
 * `onMissing` where the picture cannot be had, for the caller to show
 * something else, or nothing.
 */
export function DiagramButton({ ident, cycle, className, imageClassName, testId, onMissing }: {
  ident: string;
  cycle: string;
  className?: string;
  imageClassName?: string;
  testId: string;
  onMissing: () => void;
}) {
  const [open, setOpen] = useState(false);
  // The picture's own size, as it loaded, for the full screen to fit it.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const src = diagramPicture(ident, cycle);
  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)} disabled={!size}
        aria-label={`${ident} airport diagram, full screen`} data-testid={testId}
        className={cn("overflow-hidden bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-black", className)}
      >
        <img
          src={src} alt="" loading="lazy" decoding="async"
          onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={onMissing}
          className={cn("dark:invert", imageClassName)}
        />
      </button>
      {open && size && (
        <Suspense fallback={null}>
          <ChartViewer title={`${ident} airport diagram`} pages={[{ src, ...size }]} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

/**
 * A row for one of the FAA's charts -- an approach, the takeoff minimums,
 * the Chart Supplement -- that shows it in the app, full screen to pinch
 * in on (FaaChartViewer), at the pilot's ask: it opened the FAA's PDF, on
 * the FAA's site, out of the app.
 */
export function ChartRow({ title, url, airport, media, testId }: {
  title: string;
  /** Its address on aeronav.faa.gov, as the card lists it. */
  url: string;
  /** The field it is for: of a region's booklet, its pages alone. */
  airport: string;
  media?: ReactNode;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ListRow media={media} title={title} onClick={() => setOpen(true)} data-testid={testId} />
      {open && (
        <Suspense fallback={null}>
          <FaaChartViewer title={title} url={url} airport={airport} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

/** One of the FAA's charts full screen by its address, its code fetched
 *  at the first one (FaaChartViewer): for a caller with a button of its
 *  own, the card's runway sketch. */
export function FaaChart({ title, url, airport, onClose }: { title: string; url: string; airport: string; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <FaaChartViewer title={title} url={url} airport={airport} onClose={onClose} />
    </Suspense>
  );
}
