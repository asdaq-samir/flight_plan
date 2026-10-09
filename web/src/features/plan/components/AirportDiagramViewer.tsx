import L from "leaflet";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOverlay, MapContainer, useMap } from "react-leaflet";
import CloseButton from "../../../components/CloseButton";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../../../components/ui/dialog";
import { api } from "../../../lib/api/client";
import { chartPagePicture } from "../../../lib/diagram";
import { TEXT } from "../../../lib/text";
import { cn } from "cn";

/** No further out than the whole first page in sight (FitFirst), and in
 *  to two of its pixels a point: past that the picture, drawn at 360 dots
 *  an inch (vfr.publications), only grows coarser. */
const MAX_ZOOM = 1;
/** Between one page and the next, in the pages' own pixels. */
const GAP = 60;

export interface Page {
  src: string;
  width: number;
  height: number;
}

/** The pages one under another, each centred, in the map's own pixels
 *  (CRS.Simple: up is north, so down the pages is south). */
function laidOut(pages: Page[]) {
  const wide = Math.max(...pages.map(p => p.width));
  let top = 0;
  const placed = pages.map(p => {
    const left = (wide - p.width) / 2;
    const bounds = L.latLngBounds([-(top + p.height), left], [-top, left + p.width]);
    top += p.height + GAP;
    return { ...p, bounds };
  });
  return { placed, all: L.latLngBounds([-(top - GAP), 0], [0, wide]) };
}

/** The first page whole as the furthest out, however the screen is turned:
 *  the rest is a drag down, as a document is. */
function FitFirst({ first }: { first: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      const whole = map.getBoundsZoom(first);
      map.setMinZoom(whole);
      if (map.getZoom() < whole) map.fitBounds(first);
    };
    fit();
    map.on("resize", fit);
    return () => {
      map.off("resize", fit);
    };
  }, [map, first]);
  return null;
}

/**
 * One of the FAA's charts full screen, to pinch in on as the chart is: its
 * pages on a Leaflet map of their own pixels (CRS.Simple), one under
 * another, so a pinch, a drag and a double tap do what they do on the
 * chart and the pages stay on the screen. In the app, at the pilot's ask,
 * where a chart was a link out to the FAA's site and its PDF. A modal
 * dialog, the map behind it waiting; the close in the corner every panel
 * has it in.
 */
export default function ChartViewer({ title, pages, loading = false, failed = false, onClose }: {
  title: string;
  pages: Page[];
  /** Its pages still being asked for (FaaChartViewer). */
  loading?: boolean;
  failed?: boolean;
  onClose: () => void;
}) {
  const layout = useMemo(() => (pages.length ? laidOut(pages) : null), [pages]);
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        aria-describedby={undefined} data-testid="airport-diagram-viewer" showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        {/* Under the status bar, the close where every panel has it. */}
        <div className="flex shrink-0 items-center gap-4 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(1rem,env(safe-area-inset-left))]">
          <DialogTitle className={cn("min-w-0 flex-1 truncate font-semibold", TEXT.title)}>{title}</DialogTitle>
          <DialogClose asChild>
            <CloseButton data-testid="airport-diagram-close" />
          </DialogClose>
        </div>
        {layout ? (
          <MapContainer
            crs={L.CRS.Simple} bounds={layout.placed[0]!.bounds} maxBounds={layout.all} maxBoundsViscosity={1}
            zoomSnap={0} minZoom={-5} maxZoom={MAX_ZOOM}
            attributionControl={false} zoomControl={false}
            // The chart's paper round it, black at night where it is drawn
            // white on black.
            className="min-h-0 flex-1 bg-white! dark:bg-black! dark:[&_.leaflet-image-layer]:invert"
          >
            {layout.placed.map(p => <ImageOverlay key={p.src} url={p.src} bounds={p.bounds} />)}
            <FitFirst first={layout.placed[0]!.bounds} />
          </MapContainer>
        ) : (
          <p className={cn("px-4 pt-4 text-muted-foreground", TEXT.prose)} data-testid="chart-viewer-status">
            {failed ? "The FAA's chart could not be had. Try again in a moment." : loading ? "Drawing the chart…" : null}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One of the FAA's charts by its address (a card's approaches, the
 *  Chart Supplement): its pages asked of the planner (/api/faa-chart),
 *  which draws them and, of a region's booklet, picks the field's. */
export function FaaChartViewer({ title, url, airport, onClose }: {
  title: string;
  url: string;
  airport: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["faaChart", url, airport], queryFn: () => api.faaChart(url, airport), staleTime: Infinity, meta: { silent: true },
  });
  const pages = useMemo(() => (data?.pages ?? []).map(p => ({ src: chartPagePicture(p), width: p.width, height: p.height })), [data]);
  return <ChartViewer title={title} pages={pages} loading={isLoading} failed={isError} onClose={onClose} />;
}
