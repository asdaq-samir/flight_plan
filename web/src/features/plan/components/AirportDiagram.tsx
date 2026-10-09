import { lazy, Suspense, useState } from "react";
import { cn } from "cn";
import { diagramPicture } from "../../../lib/diagram";

const AirportDiagramViewer = lazy(() => import("./AirportDiagramViewer"));

/**
 * An airport diagram's picture as a button that opens it full screen, to
 * pinch in on (AirportDiagramViewer, fetched at the first tap): the whole
 * sheet in the card's FAA section (PublicationRows), and a thumbnail over
 * the card's Freq. tile (PlaceCard). On the diagram's own white paper,
 * and black at night, where the diagram is drawn white on it.
 * `onMissing` where the picture cannot be had, for the caller to show
 * something else, or nothing.
 */
export function DiagramButton({ ident, cycle, pdf, className, imageClassName, testId, onMissing, eager }: {
  ident: string;
  cycle: string;
  /** The FAA's PDF, a tap away in the full screen. */
  pdf: string | null;
  className?: string;
  imageClassName?: string;
  testId: string;
  onMissing: () => void;
  /** Asked for at once, where it is in sight as the card opens. */
  eager?: boolean;
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
          src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async"
          onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={onMissing}
          className={cn("dark:invert", imageClassName)}
        />
      </button>
      {open && size && (
        <Suspense fallback={null}>
          <AirportDiagramViewer ident={ident} src={src} size={size} pdf={pdf} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
