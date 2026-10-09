import { lazy, Suspense, useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "cn";
import { ListRow } from "../../../components/GroupedList";
import { ItemSeparator } from "../../../components/ui/item";
import { TEXT } from "../../../lib/text";
import { diagramPicture } from "../../../lib/diagram";

const AirportDiagramViewer = lazy(() => import("./AirportDiagramViewer"));

/**
 * The FAA's own pages for a field -- its airport diagram and its Chart
 * Supplement page, the current editions' -- for a field that has them
 * (most small fields have no diagram). The diagram is shown as itself, at
 * the pilot's ask, the whole sheet in the card and a tap away from full
 * screen to pinch in on, where it was a row that left the app for the
 * FAA's PDF; the PDF stays a tap away in the full screen, and is the row
 * again where the picture cannot be had. The Chart Supplement is a row
 * that opens its page.
 */
export function PublicationRows({ ident, diagram, diagramCycle, supplement }: {
  ident: string;
  diagram?: string | null;
  diagramCycle?: string | null;
  supplement?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  // The picture's own size, as it loaded, for the full screen to fit it.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const picture = diagramCycle && !failed ? diagramPicture(ident, diagramCycle) : null;
  return (
    <>
      {picture ? (
        <button
          type="button" onClick={() => setOpen(true)}
          aria-label={`${ident} airport diagram, full screen`} data-testid="airport-diagram-picture"
          // The diagram's own white paper round it, and black at night,
          // where the diagram is drawn white on it.
          className={cn(
            "block w-full overflow-hidden bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-black",
            supplement ? "rounded-t-lg" : "rounded-lg",
          )}
        >
          <img
            // Already loaded when React attaches (a remount, a cached hit),
            // its load event has gone by: read its size now.
            ref={img => { if (img?.complete && img.naturalWidth) setSize({ width: img.naturalWidth, height: img.naturalHeight }); }}
            src={picture} alt="" loading="lazy" decoding="async"
            onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
            // A whole sheet in the card's width at most, no taller than
            // most of a phone's half sheet.
            className="mx-auto block max-h-[22rem] w-auto max-w-full dark:invert"
          />
          {/* Which d-TPP cycle it is of, for a picture kept for the air. */}
          <span className={cn("block pb-1 text-center text-black/60 dark:text-white/60", TEXT.note)}>d-TPP cycle {diagramCycle}</span>
        </button>
      ) : diagram && (
        <ListRow media={<FileText className="size-5" />} title="Airport diagram" href={diagram} data-testid="airport-diagram" />
      )}
      {(picture || diagram) && supplement && <ItemSeparator className="my-0" />}
      {supplement && (
        <ListRow media={<FileText className="size-5" />} title="Chart Supplement" href={supplement} data-testid="chart-supplement" />
      )}
      {open && picture && diagramCycle && size && (
        <Suspense fallback={null}>
          <AirportDiagramViewer ident={ident} cycle={diagramCycle} src={picture} size={size} pdf={diagram ?? null} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
