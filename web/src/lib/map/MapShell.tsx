import L from "leaflet";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AttributionControl, MapContainer } from "react-leaflet";
import MapControls, { type ZoomControl } from "../../components/MapControls";
import type { Course } from "../api/types";
import { ChartTiles } from "./ChartTiles";
import { ClassBLayer } from "./ClassBLayer";
import { ResizeAware } from "./MapEffects";

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
  /** The layers this particular map draws, inside the container. */
  children: ReactNode;
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
export function MapShell({ course, onReady, zoom, ownShip, candidates, children }: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const bounds = useMemo(() => (course ? L.latLngBounds(course.course_line as [number, number][]) : null), [course]);

  // Fit to the route when it changes, and hand the page the same fit.
  // invalidateSize before fitBounds: on a fresh reload the map can fit
  // against a stale cached container size before it's ever been measured.
  useEffect(() => {
    if (!map || !bounds) return;
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [30, 30] });
    };
    fit();
    onReady?.(map, fit);
  }, [map, bounds, onReady]);

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
          <ChartTiles course={course} previewing={previewing} />
          {/* Both maps get it: a Class B is worth seeing whether
              planning a route past it or rating chart detections
              near it. Draws nothing unless switched on. */}
          <ClassBLayer course={course} onPreview={setPreviewing} />
          {children}
        </MapContainer>
      ) : (
        <div className="h-full w-full bg-slate-100 dark:bg-slate-900" />
      )}
      <MapControls zoom={zoom} ownShip={ownShip} candidates={candidates} />
    </div>
  );
}
