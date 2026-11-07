import { Map as GlMap, type LngLatBoundsLike, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The worker MapLibre parses its sources in (lib/map/gl/worker).
import "../../../lib/map/gl/worker";
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api/client";
import { chartPagePicture } from "../../../lib/diagram";
import { TEXT } from "../../../lib/text";
import { cn } from "cn";
import FullScreenViewer from "./FullScreenViewer";

/** Between one page and the next, in the pages' own pixels. */
const GAP = 60;
/** Degrees a page's pixel is laid on: the pages sit on a sliver of the
 *  equator, a few hundredths of a degree across, where the map's Mercator
 *  is flat to a part in a million -- MapLibre has no plane of plain pixels
 *  as Leaflet's CRS.Simple was. */
const K = 1e-5;
/** No further in than two screen points a picture's pixel: past that the
 *  picture, drawn at 360 dots an inch (wingtip.publications), only grows
 *  coarser (Leaflet's MAX_ZOOM 1). MapLibre's world is 512 points across
 *  360 degrees at zoom 0. */
const MAX_ZOOM = Math.log2((2 * 360) / (512 * K));

export interface Page {
  src: string;
  width: number;
  height: number;
}

type Box = [west: number, south: number, east: number, north: number];

/** The pages one under another, each centred, in degrees (down the pages
 *  is south). */
function laidOut(pages: Page[]) {
  const wide = Math.max(...pages.map(p => p.width));
  let top = 0;
  const placed = pages.map(p => {
    const left = (wide - p.width) / 2;
    const box: Box = [left * K, -(top + p.height) * K, (left + p.width) * K, -top * K];
    top += p.height + GAP;
    return { ...p, box };
  });
  const all: Box = [0, -(top - GAP) * K, wide * K, 0];
  return { placed, all };
}

const corners = ([w, s, e, n]: Box): [[number, number], [number, number], [number, number], [number, number]] => [[w, n], [e, n], [e, s], [w, s]];
const bounds = ([w, s, e, n]: Box): LngLatBoundsLike => [[w, s], [e, n]];

/** The pages on a MapLibre map of their own: a pinch, a drag and a double
 *  tap do what they do on the chart; the first page whole as the furthest
 *  out, however the screen is turned, the rest a drag down. */
function Pages({ placed, all }: ReturnType<typeof laidOut>) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    const style: StyleSpecification = {
      version: 8,
      sources: Object.fromEntries(placed.map((p, i) => [`page-${i}`, { type: "image" as const, url: new URL(p.src, window.location.href).href, coordinates: corners(p.box) }])),
      layers: [
        // The chart's paper round the pages.
        { id: "paper", type: "background", paint: { "background-color": "#ffffff" } },
        ...placed.map((_, i) => ({ id: `page-${i}`, type: "raster" as const, source: `page-${i}`, paint: { "raster-fade-duration": 0 } })),
      ],
    };
    const map = new GlMap({
      container: box.current, style, bounds: bounds(placed[0]!.box), maxBounds: bounds(all), maxZoom: MAX_ZOOM,
      attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false,
    });
    map.touchZoomRotate.disableRotation();
    const fit = () => {
      const whole = map.cameraForBounds(bounds(placed[0]!.box))?.zoom;
      if (whole === undefined) return;
      map.setMinZoom(Math.min(whole, MAX_ZOOM));
      if (map.getZoom() < whole) map.fitBounds(bounds(placed[0]!.box), { duration: 0 });
    };
    map.on("load", fit);
    map.on("resize", fit);
    return () => { map.remove(); };
  }, [placed, all]);
  // Black at night where it is drawn white on black: the canvas inverted.
  return <div ref={box} data-pages={placed.length} className="min-h-0 flex-1 bg-white dark:bg-black dark:[&_canvas]:invert" />;
}

/**
 * One of the FAA's charts full screen, to pinch in on as the chart is: its
 * pages on a MapLibre map of their own (Pages), one under
 * another, so a pinch, a drag and a double tap do what they do on the
 * chart and the pages stay on the screen. In the app, at the pilot's ask,
 * where a chart was a link out to the FAA's site and its PDF. A modal
 * dialog, the map behind it waiting; the close in the corner every panel
 * has it in.
 */
export default function ChartViewer({ title, pages, loading = false, failed = false, onRetry, onClose }: {
  title: string;
  pages: Page[];
  /** Its pages still being asked for (FaaChartViewer). */
  loading?: boolean;
  failed?: boolean;
  /** Asks again after a failure, beside the failure. */
  onRetry?: () => void;
  onClose: () => void;
}) {
  const layout = useMemo(() => (pages.length ? laidOut(pages) : null), [pages]);
  return (
    <FullScreenViewer title={title} testId="airport-diagram-viewer" closeTestId="airport-diagram-close" onClose={onClose}>
      {layout ? (
        <Pages {...layout} />
      ) : (
        <div className="flex flex-col items-start gap-2 px-4 pt-4" data-testid="chart-viewer-status">
          <p className={cn("text-muted-foreground", TEXT.prose)}>
            {failed
              ? "The FAA's chart could not be had. Try again in a moment."
              : loading
                ? "Drawing the chart…"
                // A booklet lists a field only where it has an entry (takeoff
                // minimums, alternates, hot spots).
                : "The FAA lists nothing for this field in this chart."}
          </p>
          {failed && onRetry && (
            <Button type="button" variant="ghost" className="relative -ml-2 rounded-full text-tint after:absolute after:-inset-1" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </FullScreenViewer>
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
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["faaChart", url, airport], queryFn: () => api.faaChart(url, airport), staleTime: Infinity, meta: { silent: true },
  });
  const pages = useMemo(() => (data?.pages ?? []).map(p => ({ src: chartPagePicture(p), width: p.width, height: p.height })), [data]);
  return <ChartViewer title={title} pages={pages} loading={isFetching && !data} failed={isError && !isFetching} onRetry={() => { void refetch(); }} onClose={onClose} />;
}
