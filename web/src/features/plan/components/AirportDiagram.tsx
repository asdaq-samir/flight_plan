import { lazy, Suspense, useState, type ReactNode } from "react";
import { ListRow } from "../../../components/GroupedList";
import { diagramPicture } from "../../../lib/diagram";

const ChartViewer = lazy(() => import("./AirportDiagramViewer"));
const FaaChartViewer = lazy(() => import("./AirportDiagramViewer").then(m => ({ default: m.FaaChartViewer })));

/**
 * The airport diagram's row, as the Chart Supplement's (ChartRow), at the
 * pilot's ask, where the whole sheet was a picture in the tab: a tap
 * shows the FAA's diagram full screen to pinch in on (ChartViewer) as
 * the planner draws it for the cycle -- the picture a route kept for the
 * air keeps too (keepRoute) -- its size read as it loads; where the
 * picture cannot be had, the FAA's PDF drawn in the app (FaaChartViewer).
 */
export function DiagramRow({ ident, cycle, url, media, testId }: {
  ident: string;
  cycle: string;
  /** The diagram's PDF on aeronav.faa.gov, where the picture fails. */
  url?: string | null;
  media?: ReactNode;
  testId: string;
}) {
  const [shown, setShown] = useState<{ width: number; height: number } | "pdf" | "missing" | null>(null);
  const src = diagramPicture(ident, cycle);
  const title = `${ident} airport diagram`;
  const open = () => {
    const picture = new Image();
    picture.onload = () => setShown({ width: picture.naturalWidth, height: picture.naturalHeight });
    picture.onerror = () => setShown(url ? "pdf" : "missing");
    picture.src = src;
  };
  return (
    <>
      <ListRow
        media={media} title="Airport diagram" onClick={open} data-testid={testId}
        description={shown === "missing" ? "The airport diagram could not be loaded" : undefined}
      />
      {shown && shown !== "missing" && (
        <Suspense fallback={null}>
          {shown === "pdf"
            ? <FaaChartViewer title={title} url={url!} airport={ident} onClose={() => setShown(null)} />
            : <ChartViewer title={title} pages={[{ src, ...shown }]} onClose={() => setShown(null)} />}
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
