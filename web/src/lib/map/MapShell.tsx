import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapContainer } from "react-leaflet";
import MapControls, { MapControlsLeft } from "../../components/MapControls";
import ProblemBanner from "../../components/ProblemBanner";
import { MapInsetsContext, NO_INSETS, SHEET_SECONDS } from "../../components/mapChrome";
import type { Course } from "../api/types";
import { chartQuery } from "../queryClient";
import { ChartTiles } from "./ChartTiles";
import { ClassBLayer } from "./ClassBLayer";
import { ResizeAware } from "./MapEffects";
import { centreClear } from "./clear";
// The marks held to the chart under a pinch: a patch to Leaflet's markers.
import "./pinch";
import { OwnShipLayer } from "./OwnShipLayer";
import { OPEN_ZOOM, useOwnShip } from "./ownShip";
import { underway } from "./glide";

interface Props {
  course: Course | null;
  /** The map, once there is a course on it -- the training page keeps
   *  it to bring the map to a point. */
  onReady?: (map: L.Map) => void;
  /** The layers this particular map draws, inside the container. */
  children: ReactNode;
  /** A Class B airport's chip tapped: the planner opens its card. */
  onSelectPlace?: (ident: string) => void;
  /** The map is on a point the pilot picked -- a checkpoint, an airport's
   *  card, a point held for its airspace -- which the panel settling at
   *  another height keeps in sight rather than fitting the route again. */
  held?: boolean;
  /** The map's buttons on its left, where a map has any (the planner's
   *  Nearest). */
  leftControls?: ReactNode;
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

/** The least the map is fitted to round a route: about 10 nm across. */
const MIN_FIT_M = 18_520;

export function MapShell({ course, onReady, children, onSelectPlace, held = false, leftControls }: Props) {
  // With no route, where the pilot's position last was, at the zoom the
  // planner opens on it (ownShip's OPEN_ZOOM) -- that region's chart drawn
  // while the GPS finds the position, and only a short pan once it has --
  // else the whole country. Read once, as the map is made.
  const [opening] = useState(() => {
    const last = useOwnShip.getState().lastFix;
    return last ? { center: [last.lat, last.lon] as [number, number], zoom: OPEN_ZOOM } : { center: COUNTRY, zoom: COUNTRY_ZOOM };
  });
  const [map, setMap] = useState<L.Map | null>(null);
  // The chart alone while there is no route: the planner opens on a
  // search bar over the chart, where it waited on a route to draw any.
  const { data: chartOnly } = useQuery({ ...chartQuery, enabled: !course });
  const chart = course ?? chartOnly ?? null;
  const [previewing, setPreviewing] = useState(false);
  // At least a few miles round the route: a local flight's course is the
  // one airport, and fitted to a point the map went in past the chart's
  // own zoom, to blocks of pixels.
  const bounds = useMemo(() => {
    if (!course) return null;
    const line = L.latLngBounds(course.course_line as [number, number][]);
    const centre = line.getCenter();
    return line.extend(centre.toBounds(MIN_FIT_M));
  }, [course]);

  // invalidateSize before fitBounds: on a fresh reload the map can fit
  // against a stale cached container size before it's ever been measured.
  // Clear of what the map panel covers where it has settled, as well as
  // the margin: the map runs under the panel, and a route fitted to the
  // whole map had its far end behind the sheet.
  //
  // Flown there, as Maps moves to a route, when the map was already
  // showing something -- the country, the pilot's position, another
  // route -- and the route arrives over it; put there at once when the
  // page opens on the route.
  const insets = useContext(MapInsetsContext);
  const insetsRef = useRef(insets);
  useEffect(() => { insetsRef.current = insets; }, [insets]);
  const fit = useCallback((fly: boolean) => {
    if (!map || !bounds) return;
    map.invalidateSize();
    const { top, bottom, left } = insetsRef.current;
    const padding = { paddingTopLeft: L.point(30 + left, 30 + top), paddingBottomRight: L.point(30, 30 + bottom) };
    // A route on the map is the map gone somewhere: own ship stops pulling
    // it back to the position with every fix (Maps' tracking ends too),
    // until the location arrow is tapped. Only while own ship is on, as a
    // pan ends it (OwnShipLayer): `follow` is remembered, and stored off
    // at the desk it would leave the map not keeping up in the air.
    const ownShip = useOwnShip.getState();
    if (ownShip.enabled && ownShip.follow) ownShip.setFollow(false);
    fitAtQuarterLevels(map, bounds, padding, fly);
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
  // Whether the map opened on a route, or on something else first, and
  // whether it has been fitted to one since.
  const openedOn = useRef<"route" | "other" | null>(null);
  const everFitted = useRef(false);
  useEffect(() => {
    if (map && openedOn.current === null) openedOn.current = bounds ? "route" : "other";
  }, [map, bounds]);
  useEffect(() => {
    // The route put away: the same one entered again is fitted again.
    if (!routeKey) {
      fitted.current = null;
      return;
    }
    if (!map || !bounds) return;
    onReady?.(map);
    if (fitted.current === routeKey) return;
    const opening = !everFitted.current && openedOn.current === "route";
    everFitted.current = true;
    fitted.current = routeKey;
    fit(!opening);
  }, [map, bounds, routeKey, onReady, fit]);

  // The map follows the panel as it goes out or comes back to rest --
  // raised to half, lowered to its capsule -- in the sheet's own time, as
  // Maps' does, when what it follows is in sight: the route, fitted again
  // to what the panel leaves (the whole screen at the capsule, above the
  // sheet when it is out), from wherever the map had got to -- the
  // location arrow's close-in view as well; else the pilot's position,
  // brought to the middle of what is left. Neither in sight -- the map
  // panned off somewhere else -- it stays where the pilot put it. With
  // own ship followed in the air the position wins over the route. Not
  // while the map is held on a point (a checkpoint picked, an airport's
  // card): FocusOn keeps that one in the middle.
  //
  // On the panel going out or coming back, and on its size as it settles
  // over the next moment (the capsule's head measured once it is the
  // capsule): not on a size changed later -- a notice under the route as
  // the plan streams in -- which would take the map from under the
  // pilot's finger.
  const settledInsets = useRef(insets);
  const following = useRef<{ until: number; what: "route" | "ship" } | null>(null);
  // The map is made before the panel has measured what it covers, its
  // opening view the whole screen's: once the panel has, the view is put
  // right at once -- the route fitted clear of it, or what was in the
  // middle of the screen in the middle of what the panel leaves. On a
  // reload the position opened in the screen's middle, under the half
  // sheet's edge, and the map slid up as the GPS answered.
  const placedFor = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!map || placedFor.current === map || (!insets.top && !insets.bottom && !insets.left)) return;
    placedFor.current = map;
    if (bounds && fitted.current === routeKey) {
      fit(false);
      return;
    }
    const size = map.getSize();
    const middle = (i: { top: number; bottom: number; left: number }) => L.point((i.left + size.x) / 2, (i.top + size.y - i.bottom) / 2);
    map.panBy(middle(NO_INSETS).subtract(middle(insets)), { animate: false });
  }, [insets, map, bounds, routeKey, fit]);
  useEffect(() => {
    const was = settledInsets.current;
    settledInsets.current = insets;
    if (!map || held) return;
    const turned = insets.out !== was.out;
    const settling = following.current && performance.now() < following.current.until ? following.current.what : null;
    if (!turned && !settling) return;
    let what = settling;
    if (turned) {
      // In sight: on the map and out from under the panel where it was.
      const size = map.getSize();
      const sight = L.bounds(L.point(was.left, was.top), L.point(size.x, size.y - was.bottom));
      const ownShip = useOwnShip.getState();
      // On, or off and grey at its last place: the dot on the map either way.
      const ship = ownShip.fix;
      const shipInSight = !!ship && sight.contains(map.latLngToContainerPoint([ship.lat, ship.lon]));
      const routeInSight = !!course && !!bounds && fitted.current === routeKey
        && lineInSight(course.course_line as [number, number][], map, sight);
      const keepingUp = shipInSight && ownShip.follow && underway(ship);
      what = routeInSight && !keepingUp ? "route" : shipInSight ? "ship" : null;
      following.current = what ? { until: performance.now() + SHEET_SECONDS * 1000 + 300, what } : null;
    }
    if (what === "route") fit(true);
    else if (what === "ship") {
      const ship = useOwnShip.getState().fix;
      if (ship) map.panTo(centreClear(map, [ship.lat, ship.lon], map.getZoom()), { animate: true, duration: SHEET_SECONDS });
    }
  }, [insets, map, course, bounds, routeKey, held, fit]);

  // bg-slate-100: purely cosmetic, so the gap before the course loads
  // reads as "a map is about to be here" rather than a blank white
  // rectangle.
  return (
    <div className="relative h-full w-full">
      {chart ? (
        <MapContainer
          ref={setMap}
          {...(bounds ? { bounds, boundsOptions: { padding: [30, 30] } } : opening)}
          // zoomControl off drops the +/- buttons, not zooming itself;
          // minZoom 3 is where the whole country fits a phone screen,
          // and as far out as the chart layer has tiles.
          zoomControl={false} minZoom={3} keyboard={false} attributionControl={false}
          className="h-full w-full bg-slate-100 dark:bg-slate-900"
        >
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
      <ProblemBanner clearLeft={!!leftControls} />
      <MapControls />
      {leftControls && <MapControlsLeft>{leftControls}</MapControlsLeft>}
    </div>
  );
}

/** Whether any of `line` crosses `sight`, in the map's container pixels:
 *  a point in it, or a leg through it. */
function lineInSight(line: [number, number][], map: L.Map, sight: L.Bounds): boolean {
  const points = line.map(p => map.latLngToContainerPoint(p));
  return points.some(p => sight.contains(p))
    || points.slice(1).some((p, i) => L.LineUtil.clipSegment(points[i]!, p, sight) !== false);
}

/**
 * The route fitted at a quarter level: fitted to what the sheet leaves, it
 * fills it, as Maps' does, where whole levels left it the same size at
 * the capsule as above the half sheet (the room had not quite doubled).
 * For the fit alone -- Leaflet reads the snap as the move starts -- so a
 * wheel or a pinch still goes a whole level, and lands on one; the
 * chart's tiles meanwhile are drawn at the nearest, scaled by at most a
 * fifth.
 */
function fitAtQuarterLevels(map: L.Map, bounds: L.LatLngBounds, padding: L.FitBoundsOptions, fly: boolean) {
  const snap = map.options.zoomSnap;
  map.options.zoomSnap = 0.25;
  if (fly) map.flyToBounds(bounds, { ...padding, duration: SHEET_SECONDS });
  else map.fitBounds(bounds, padding);
  map.options.zoomSnap = snap;
}
