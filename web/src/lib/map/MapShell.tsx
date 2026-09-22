import L from "leaflet";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AttributionControl, MapContainer, useMap } from "react-leaflet";
import MapControls, { type ZoomControl } from "../../components/MapControls";
import type { Course } from "../api/types";
import { ChartTiles } from "./ChartTiles";
import { ClassBLayer } from "./ClassBLayer";
import { FitRoute } from "./fitRoute";
import { ResizeAware } from "./MapEffects";
import { useZoomLevel } from "./useZoomLevel";

interface Props {
  course: Course | null;
  /** The map, and a fit-to-route, once there is a course to fit. The
   *  planner keeps the fit for its own button and key; the training
   *  page keeps the map. */
  onReady?: (map: L.Map, fit: () => void) => void;
  /** The fit-route / show-selected toggle, drawn on the map. */
  zoom: ZoomControl;
  /** Whether the layers popover also offers own ship and the
   *  every-landmark switch -- the planner's map has both. */
  ownShip?: boolean;
  candidates?: { on: boolean; onToggle: (on: boolean) => void };
  /** Whether the map is closer in than the whole route needs -- what
   *  the zoom toggle offers next. */
  onZoomChange?: (zoomedIn: boolean) => void;
  /** The layers this particular map draws, inside the container. */
  children: ReactNode;
}

/**
 * Whether the map is closer in than fitting the whole route needs.
 *
 * `getBoundsZoom` is Leaflet's own answer to "what zoom would fit
 * this", with the same padding the fit uses, so this is exactly "the
 * pilot is looking at less than the route" however long the route is.
 * It used to be `zoom >= course.max_zoom`, a fixed 12, which is wrong
 * at both ends: a ten-mile route *fits* at 12, so the button offered
 * to fit a route it was already showing and could never offer the
 * selection; and a 2,000 nm route needed nine zoom levels of scrolling
 * before the button admitted it was zoomed in.
 */
function FitReporter({ bounds, onChange }: { bounds: L.LatLngBounds; onChange: (zoomedIn: boolean) => void }) {
  const map = useMap();
  const zoom = useZoomLevel();
  useEffect(() => {
    onChange(zoom > map.getBoundsZoom(bounds, false, L.point(30, 30)));
  }, [zoom, bounds, map, onChange]);
  return null;
}

/**
 * What both maps are underneath: a Leaflet container sized to the
 * route, the chart tiles, and the control stack at the corner. The
 * planner's route and the training page's candidates differ in what
 * they draw on top, which is `children`, and in nothing else -- the
 * container options, the fit, the tile layer, the terminal sheet's
 * preview state and the placeholder before a course arrives were the
 * same code in both files.
 */
export function MapShell({ course, onReady, zoom, ownShip, candidates, onZoomChange, children }: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const bounds = useMemo(() => (course ? L.latLngBounds(course.course_line as [number, number][]) : null), [course]);

  // invalidateSize before fitBounds: on a fresh reload the map can fit
  // against a stale cached container size before it's ever been measured.
  const fit = useCallback(() => {
    if (!map || !bounds) return;
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, bounds]);

  // Fit to the route when it changes, and hand the page the same fit.
  useEffect(() => {
    if (!map || !bounds) return;
    fit();
    onReady?.(map, fit);
  }, [map, bounds, onReady, fit]);

  // bg-slate-100: purely cosmetic, so the gap before the course loads
  // reads as "a map is about to be here" rather than a blank white
  // rectangle.
  return (
    <div className="relative h-full w-full">
      {course && bounds ? (
        <MapContainer
          ref={setMap} bounds={bounds} boundsOptions={{ padding: [30, 30] }}
          // zoomControl off drops the +/- buttons, not zooming itself;
          // minZoom 3 is where the whole country fits a phone screen,
          // and as far out as the chart layer has tiles.
          zoomControl={false} minZoom={3} keyboard={false} attributionControl={false}
          className="h-full w-full bg-slate-100 dark:bg-slate-900"
        >
          <AttributionControl prefix={false} />
          <ResizeAware />
          {/* Everything drawn inside the map gets the fit, not just
              `children`: the Class B layer's own cards close the same
              way the planner's and the training map's do, and with the
              provider wrapped around `children` alone they had no fit
              to call and closed without coming back out. */}
          <FitRoute value={fit}>
            <ChartTiles course={course} previewing={previewing} />
            {/* Both maps get it: a Class B is worth seeing whether
                planning a route past it or rating chart detections
                near it. Draws nothing unless switched on. */}
            <ClassBLayer course={course} onPreview={setPreviewing} />
            {onZoomChange && <FitReporter bounds={bounds} onChange={onZoomChange} />}
            {children}
          </FitRoute>
        </MapContainer>
      ) : (
        <div className="h-full w-full bg-slate-100 dark:bg-slate-900" />
      )}
      <MapControls zoom={zoom} ownShip={ownShip} candidates={candidates} />
    </div>
  );
}
