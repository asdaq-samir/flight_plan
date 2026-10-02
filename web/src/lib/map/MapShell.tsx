import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AttributionControl, MapContainer } from "react-leaflet";
import MapControls from "../../components/MapControls";
import ProblemBanner from "../../components/ProblemBanner";
import { MapInsetsContext } from "../../components/mapChrome";
import type { Course } from "../api/types";
import { chartQuery } from "../queryClient";
import { ChartTiles } from "./ChartTiles";
import { ClassBLayer } from "./ClassBLayer";
import { ResizeAware } from "./MapEffects";
import { OwnShipLayer } from "./OwnShipLayer";

interface Props {
  course: Course | null;
  /** The map, once there is a course on it -- the training page keeps
   *  it to bring the map to a point. */
  onReady?: (map: L.Map) => void;
  /** The layers this particular map draws, inside the container. */
  children: ReactNode;
  /** A Class B airport's chip tapped: the planner opens its card. */
  onSelectPlace?: (ident: string) => void;
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
/** Where a map with no route on it opens: the lower 48, whole on a
 *  phone, as Maps opens on the country before it knows where you are. */
const COUNTRY: [number, number] = [39.5, -98.35];
const COUNTRY_ZOOM = 4;

export function MapShell({ course, onReady, children, onSelectPlace }: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  // The chart alone while there is no route: the planner opens on a
  // search bar over the chart, where it waited on a route to draw any.
  const { data: chartOnly } = useQuery({ ...chartQuery, enabled: !course });
  const chart = course ?? chartOnly ?? null;
  const [previewing, setPreviewing] = useState(false);
  const bounds = useMemo(() => (course ? L.latLngBounds(course.course_line as [number, number][]) : null), [course]);

  // invalidateSize before fitBounds: on a fresh reload the map can fit
  // against a stale cached container size before it's ever been measured.
  // Clear of what the map panel covers at rest, as well as the margin:
  // the map runs under the panel, and a route fitted to the whole map
  // had its far end behind the sheet.
  const insets = useContext(MapInsetsContext);
  const insetsRef = useRef(insets);
  useEffect(() => { insetsRef.current = insets; }, [insets]);
  const fit = useCallback(() => {
    if (!map || !bounds) return;
    map.invalidateSize();
    const { top, bottom, left } = insetsRef.current;
    map.fitBounds(bounds, { paddingTopLeft: [30 + left, 30 + top], paddingBottomRight: [30, 30 + bottom] });
  }, [map, bounds]);

  // Fit to the route when it changes.
  //
  // Once per route, not once per `bounds`. The course is a query: it
  // can be answered again -- a refetch, a retry, the same route asked
  // for twice -- and each answer is a new object, so a fit keyed on the
  // bounds alone would snap the map back to the whole route from
  // wherever the pilot had got to, seconds after they tapped a marker
  // to go somewhere. Keyed on the two idents instead, which is what
  // "the route changed" actually means.
  const routeKey = course ? `${course.departure.ident}->${course.destination.ident}` : null;
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !bounds || !routeKey) return;
    onReady?.(map);
    if (fitted.current === routeKey) return;
    fitted.current = routeKey;
    fit();
  }, [map, bounds, routeKey, onReady, fit]);

  // bg-slate-100: purely cosmetic, so the gap before the course loads
  // reads as "a map is about to be here" rather than a blank white
  // rectangle.
  return (
    <div className="relative h-full w-full">
      {chart ? (
        <MapContainer
          ref={setMap}
          {...(bounds ? { bounds, boundsOptions: { padding: [30, 30] } } : { center: COUNTRY, zoom: COUNTRY_ZOOM })}
          // zoomControl off drops the +/- buttons, not zooming itself;
          // minZoom 3 is where the whole country fits a phone screen,
          // and as far out as the chart layer has tiles.
          zoomControl={false} minZoom={3} keyboard={false} attributionControl={false}
          className="h-full w-full bg-slate-100 dark:bg-slate-900"
        >
          <AttributionControl prefix={false} />
          <ResizeAware />
          <ChartTiles chart={chart} previewing={previewing} />
          {/* Both maps get it: a Class B is worth seeing whether
              planning a route past it or rating chart detections
              near it. Draws nothing unless switched on. */}
          <ClassBLayer
            chart={chart} endpoints={course ? [course.departure.ident, course.destination.ident] : []}
            onPreview={setPreviewing} onSelectPlace={onSelectPlace}
          />
          {children}
          {/* Own ship on both maps, with the location arrow among the
              map's buttons: the training page's as well as the planner's. */}
          <OwnShipLayer />
        </MapContainer>
      ) : (
        <div className="h-full w-full bg-slate-100 dark:bg-slate-900" />
      )}
      <ProblemBanner />
      <MapControls />
    </div>
  );
}
