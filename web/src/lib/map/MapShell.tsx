import L from "leaflet";
// With the map, not the page's first script: its stylesheet has Leaflet's
// chunk preloaded for everyone (issue #87).
import "leaflet/dist/leaflet.css";
// Its lines and shapes drawn to the fraction of a point, and no restyle of
// every mark at a drag's start and end (subpixel).
import { dropDraggingCursorRules } from "./subpixel";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapContainer, ZoomControl } from "react-leaflet";
import MapControls from "../../components/MapControls";
import MapBanners from "../../components/MapBanners";
import { MapInsetsContext, SHEET_SECONDS } from "../../components/mapChrome";
import { useSheetCards } from "../sheetCards";
import type { Course } from "../api/types";
import { chartQuery } from "../queryClient";
import { ChartTiles } from "./ChartTiles";
import { OverlayTiles } from "./OverlayTiles";
import { ClassBLayer } from "./ClassBLayer";
import { ResizeAware } from "./MapEffects";
import { prefersReducedMotion } from "../motion";
import { BUTTONS_CLEAR, centreClearFor, hideLinesWhileZooming } from "./clear";
// The marks held to the chart under a pinch: a patch to Leaflet's markers.
import "./pinch";
import { OwnShipLayer } from "./OwnShipLayer";
import { OwnTrailLayer } from "./OwnTrailLayer";
import { AheadLayer } from "./AheadLayer";
import { TrafficLayer } from "./TrafficLayer";
import { COUNTRY_ZOOM, OPEN_ZOOM, useOwnShip } from "./ownShip";
import TvMapKeys from "./TvMapKeys";
import { tvPlatform } from "../tv";
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
/** No route's airports: one array, the same at every render. */
const NO_IDENTS: string[] = [];
/** Where a map with no route on it opens (COUNTRY_ZOOM): the lower 48. */
const COUNTRY: [number, number] = [39.5, -98.35];

/** The least the map is fitted to round a route: about 10 nm across. */
const MIN_FIT_M = 18_520;

export function MapShell({ course, onReady, children, onSelectPlace, held: heldAsked = false }: Props) {
  // And while a card from the chart or a control is open in the sheet
  // (SheetCard): the sheet coming up for a VFR waypoint's card fitted the
  // route again, out past the waypoints' zoom, and took the diamond and
  // its card off the map a tenth of a second after it opened (stops:753).
  const cardsOpen = useSheetCards(s => s.stack.length > 0);
  const held = heldAsked || cardsOpen;
  // Leaflet's stylesheet may come in after the module ran: once more as the
  // map first draws.
  useEffect(() => dropDraggingCursorRules(), []);
  // Once: a page is on a TV or not for its whole visit.
  const [onTv] = useState(() => tvPlatform() !== null);
  // With no route, where the pilot's position last was, at the zoom the
  // planner opens on it (ownShip's OPEN_ZOOM) -- that region's chart drawn
  // while the GPS finds the position -- else the whole country. Read once,
  // as the map is made: in the middle of what the panel leaves of the map
  // where the panel has measured itself by then, as the map is put once
  // it has (below) -- it was made in the screen's middle and moved after,
  // and a reload slid the chart up under the pill as it settled, at the
  // owner's notice ("On a reload why is there animation in the maps and
  // the pill? It seems they are settling to their desired position").
  const insets = useContext(MapInsetsContext);
  const [opening] = useState(() => {
    const last = useOwnShip.getState().lastFix;
    const [point, zoom] = last ? [[last.lat, last.lon] as [number, number], OPEN_ZOOM] : [COUNTRY, COUNTRY_ZOOM];
    return { center: centreClearFor(point, zoom, insets), zoom, insets };
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
  const insetsRef = useRef(insets);
  useEffect(() => { insetsRef.current = insets; }, [insets]);
  const fit = useCallback((fly: boolean) => {
    if (!map || !bounds) return;
    map.invalidateSize();
    const { top, bottom, left } = insetsRef.current;
    const padding = { paddingTopLeft: L.point(30 + BUTTONS_CLEAR + left, 30 + top), paddingBottomRight: L.point(30 + BUTTONS_CLEAR, 30 + bottom) };
    // A route on the map is the map gone somewhere: own ship stops pulling
    // it back to the position with every fix (Maps' tracking ends too),
    // until the location arrow is tapped. Only while own ship is on, as a
    // pan ends it (OwnShipLayer): `follow` is remembered, and stored off
    // at the desk it would leave the map not keeping up in the air.
    const ownShip = useOwnShip.getState();
    if (ownShip.enabled && ownShip.follow) ownShip.setFollow(false);
    fitAtQuarterLevels(map, bounds, padding, fly);
  }, [map, bounds]);

  // The whole route again, asked from the location arrow in a dry run
  // (MyPositionButton): flown to it, own ship no longer followed.
  const recheckRoute = useRef<(() => void) | null>(null);
  const shownRoute = useRef(false);
  const routeAsked = useOwnShip(s => s.routeAsked);
  const routeAskedWas = useRef(routeAsked);
  useEffect(() => {
    if (routeAsked === routeAskedWas.current) return;
    routeAskedWas.current = routeAsked;
    useOwnShip.getState().setFollow(false);
    // The route is what the pilot asked to see: in view until the pilot
    // moves the map, whatever the fit's last quarter level leaves at the
    // edges (the arrow kept offering the route it had just fitted, CI on a
    // phone, where the fit and the panel's settling crossed).
    shownRoute.current = true;
    useOwnShip.setState({ routeOutOfView: false });
    fit(true);
  }, [routeAsked, fit]);

  // Whether the whole route is in sight, clear of the panel, each time the
  // map comes to rest: panned or zoomed off it, the location arrow turns
  // to the route, a tap fitting the course again, at the owner's ask
  // ("When the route is entered, and map is panned away from the route,
  // have the locator icon change to fit the course"). A hair of slack
  // round the view, so a route fitted to its padding counts as in sight.
  useEffect(() => {
    const setOut = (out: boolean) => {
      if (useOwnShip.getState().routeOutOfView !== out) useOwnShip.setState({ routeOutOfView: out });
    };
    const drawn = !!map && !!course;
    if (useOwnShip.getState().routeDrawn !== drawn) useOwnShip.setState({ routeDrawn: drawn });
    if (!map || !course) {
      setOut(false);
      return;
    }
    const line = L.latLngBounds(course.course_line as [number, number][]);
    const check = () => {
      if (shownRoute.current) return setOut(false);
      const { top, bottom, left } = insetsRef.current;
      const size = map.getSize();
      const clear = L.latLngBounds(map.containerPointToLatLng([left, top]), map.containerPointToLatLng([size.x, Math.max(top + 1, size.y - bottom)]));
      setOut(!clear.pad(0.02).contains(line));
    };
    // The pilot's own move of the map (a drag, the wheel, a finger) ends
    // the route asked for: from then on it is measured again.
    const moved = () => { shownRoute.current = false; };
    const container = map.getContainer();
    check();
    recheckRoute.current = check;
    map.on("moveend", check);
    map.on("dragstart", moved);
    container.addEventListener("wheel", moved, { passive: true });
    container.addEventListener("touchstart", moved, { passive: true });
    return () => {
      recheckRoute.current = null;
      map.off("moveend", check);
      map.off("dragstart", moved);
      container.removeEventListener("wheel", moved);
      container.removeEventListener("touchstart", moved);
      useOwnShip.setState({ routeDrawn: false });
    };
  }, [map, course]);
  // And again as the panel comes to rest at another size: the map's last
  // rest was read against the panel as it was, and a route fitted while
  // the sheet was still settling stayed "out of view", the arrow offering
  // the route it had just shown (route-fit's arrow test, CI on a phone).
  useEffect(() => { recheckRoute.current?.(); }, [insets]);

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
  // What the map follows the panel's size for, for a moment (below).
  // A "slide" keeps `focus`, the point that was in the middle of what the
  // panel left, in the middle of what it leaves now.
  const following = useRef<{ until: number; what: "route" | "ship" | "slide"; focus?: L.LatLng } | null>(null);
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
    // And again as the panel settles round the route that has come: half
    // way the sheet grows by the route's figures pinned at its foot as
    // they arrive, and a route fitted to the half before them sat a third
    // under them (route-fit.spec: a card's Fly Here, half way).
    following.current = { until: performance.now() + 2000, what: "route" };
  }, [map, bounds, routeKey, onReady, fit]);

  // The map follows the panel as it goes out or comes back to rest --
  // raised to half, lowered to its capsule -- in the sheet's own time, as
  // Maps' does, when what it follows is in sight: the route, left where it
  // is while all of it stays clear, else slid at its zoom so what was in
  // the middle of what the panel left is in the middle of what it leaves
  // now (the whole screen at the capsule, above the sheet when it is
  // out); else the pilot's position,
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
  // The map made before the panel had measured what it covers, its
  // opening view the whole screen's (or the panel's as it was then): once
  // the panel has, the view is put right at once -- the route fitted clear
  // of it, or what was in the middle of what the panel left in the middle
  // of what it leaves now. On a reload the position opened in the
  // screen's middle, under the half sheet's edge, and the map slid up as
  // the GPS answered. Not a view moved since it was made -- own ship put
  // on its first fix (OwnShipLayer), or the pilot's -- which is where it
  // was put.
  const placedFor = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!map || placedFor.current === map || (!insets.top && !insets.bottom && !insets.left)) return;
    placedFor.current = map;
    if (bounds && fitted.current === routeKey) {
      fit(false);
      return;
    }
    const was = opening.insets;
    if (was.top === insets.top && was.bottom === insets.bottom && was.left === insets.left) return;
    const zoom = map.getZoom();
    if (zoom !== opening.zoom || map.project(map.getCenter(), zoom).distanceTo(map.project(opening.center, zoom)) > 1) return;
    const size = map.getSize();
    const middle = (i: { top: number; bottom: number; left: number }) => L.point((i.left + size.x) / 2, (i.top + size.y - i.bottom) / 2);
    map.panBy(middle(was).subtract(middle(insets)), { animate: false });
  }, [insets, map, bounds, routeKey, fit, opening]);
  useEffect(() => {
    const was = settledInsets.current;
    settledInsets.current = insets;
    if (!map || held) return;
    // Half way to all the way up and back, the map stays exactly where it
    // is, at the owner's ask ("when going from half card to full card, map
    // should not move or zoom"): only the pill to half and back moves it.
    if (insets.up !== was.up && insets.out === was.out) return;
    const turned = insets.out !== was.out;
    const settling = following.current && performance.now() < following.current.until ? following.current.what : null;
    if (!turned && !settling) return;
    let what = settling;
    const size = map.getSize();
    const middle = (i: { top: number; bottom: number; left: number }) => L.point((i.left + size.x) / 2, (i.top + size.y - i.bottom) / 2);
    if (turned) {
      // In sight: on the map and out from under the panel where it was.
      const sight = L.bounds(L.point(was.left, was.top), L.point(size.x, size.y - was.bottom));
      const ownShip = useOwnShip.getState();
      // On, or off and grey at its last place: the dot on the map either way.
      const ship = ownShip.fix;
      const shipInSight = !!ship && sight.contains(map.latLngToContainerPoint([ship.lat, ship.lon]));
      const routeInSight = !!course && !!bounds && fitted.current === routeKey
        && lineInSight(course.course_line as [number, number][], map, sight);
      // A dry run's airplane (ownShip's simulateFix) is what the map is
      // for while it flies: in sight, the sheet's turn brings it to the
      // middle of what the panel leaves and follows it on, as the GPS's is
      // followed -- a pan had left it behind, and the turn fitted the route
      // instead, the airplane flying off under the sheet, at the owner's
      // notice ("during dry run map should adjust as well to the pill and
      // half card").
      const flying = ownShip.simulated;
      const keepingUp = shipInSight && (flying || (ownShip.follow && underway(ship)));
      // The route slid, not fitted again: at the same zoom the chart's
      // tiles are the ones already drawn, where a fit to the new room
      // zoomed and drew the chart afresh at every turn, at the owner's ask
      // ("Medium to small detent redraws the map?", 2026-10-27).
      // And not moved at all where it is all clear of the panel and the
      // map's buttons as it is, as Apple Maps' map stays put under its
      // sheet: lowered to the capsule the room only grows, and the slide
      // down showed the chart above it blank until its tiles came (the
      // owner, "Medium to small detent does need some polishing",
      // 2026-10-27). Slid where it would be clear once slid; fitted again
      // where not even then: raised from the capsule after a pan, or to a
      // half sheet with less room than it was fitted to.
      const fitsAfter = (shift: L.Point) => {
        const corner = (p: L.LatLng) => map.latLngToContainerPoint(p).add(shift);
        return !!bounds && L.bounds(L.point(insets.left + BUTTONS_CLEAR, insets.top), L.point(size.x - BUTTONS_CLEAR, size.y - insets.bottom))
          .contains(L.bounds(corner(bounds.getNorthWest()), corner(bounds.getSouthEast())));
      };
      const stays = routeInSight && !keepingUp && fitsAfter(L.point(0, 0));
      const routeWay = fitsAfter(middle(insets).subtract(middle(was))) ? "slide" : "route";
      what = stays ? null : routeInSight && !keepingUp ? routeWay : shipInSight ? "ship" : null;
      if (what === "ship" && flying && !ownShip.follow) ownShip.setFollow(true);
      following.current = what
        ? { until: performance.now() + SHEET_SECONDS * 1000 + 300, what, focus: map.containerPointToLatLng(middle(was)) }
        : null;
    }
    if (what === "route") fit(true);
    else if (what === "slide" && following.current?.focus) {
      // panBy, not panTo: panTo snaps the zoom to a whole level, and the
      // route is fitted at a quarter one.
      const by = map.latLngToContainerPoint(following.current.focus).subtract(middle(insets)).round();
      if (by.x || by.y) map.panBy(by, { animate: !prefersReducedMotion(), duration: SHEET_SECONDS });
    }
    else if (what === "ship" && turned) {
      // Once, as the sheet turns, to the middle of the room it is going
      // to (`insets`, the panel's at rest), in the sheet's own time: panned
      // again at each change of the room on the way, and by own ship's
      // next fix (OwnShipLayer), the map went part of the way, jumped 51
      // points as the sheet landed and slid on again a second later
      // (sampled on the phone project with the GPS on, half to the pill:
      // -153 to -96 over the slide, -45.7 the frame after, 0 at 2 s). The
      // owner, 2026-10-27: "the map can slide down more smoothly".
      const ship = useOwnShip.getState().fix;
      if (ship) {
        const by = map.latLngToContainerPoint([ship.lat, ship.lon]).subtract(middle(insets)).round();
        if (by.x || by.y) map.panBy(by, { animate: !prefersReducedMotion(), duration: SHEET_SECONDS, easeLinearity: 0.5 });
      }
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
          {...(bounds ? { bounds, boundsOptions: { padding: [30, 30] } } : { center: opening.center, zoom: opening.zoom })}
          // zoomControl off drops the +/- buttons, not zooming itself;
          // minZoom 3 is where the whole country fits a phone screen,
          // and as far out as the chart layer has tiles. On a TV (lib/tv)
          // the map takes the remote's arrows while it is focused, to pan.
          zoomControl={false} minZoom={3} keyboard={onTv} attributionControl={false} zoomAnimationThreshold={12}
          className="h-full w-full bg-slate-100 dark:bg-slate-900"
        >
          {/* A remote has no pinch: Leaflet's own + and - to reach with
              its arrows, and OK and the channel keys on the map. */}
          {onTv && <ZoomControl position="bottomright" />}
          {onTv && <TvMapKeys />}
          <ResizeAware />
          <ChartTiles chart={chart} previewing={previewing} />
          <OverlayTiles />
          {/* Both maps get it: a Class B is worth seeing whether
              planning a route past it or rating chart detections
              near it. Draws nothing unless switched on. */}
          <ClassBLayer
            chart={chart} route={course ? [course.departure.ident, ...(course.stops ?? []).map(s => s.ident), course.destination.ident] : NO_IDENTS}
            onPreview={setPreviewing} onSelectPlace={onSelectPlace}
          />
          {children}
          {/* Own ship on both maps, with the location arrow among the
              map's buttons: the training page's as well as the planner's. */}
          {/* Where own ship has flown, under the arrow, at the pilot's ask. */}
          <OwnTrailLayer />
          <OwnShipLayer />
          {/* What is ahead of it in the air, where it is (lib/map/ahead). */}
          <AheadLayer />
          {/* The airplanes about, where the map's settings show them. */}
          <TrafficLayer />
        </MapContainer>
      ) : (
        <div className="h-full w-full bg-slate-100 dark:bg-slate-900" />
      )}
      <MapBanners />
      <MapControls />
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
  // Under Reduce Motion put there at once, as on the page's opening.
  if (fly && !prefersReducedMotion()) {
    hideLinesWhileZooming(map, map.getBoundsZoom(bounds, false, L.point(0, 0)));
    map.fitBounds(bounds, { ...padding, animate: true });
  }
  else map.fitBounds(bounds, padding);
  map.options.zoomSnap = snap;
}
