import type { PathOptions } from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Circle, Marker, useMap, useMapEvents } from "react-leaflet";
import { nearestQuery } from "../queryClient";
import { glideRangeNm } from "./glide";
import { centreClear } from "./clear";
import { ownShipIcon } from "./icons";
import { COUNTRY_ZOOM, OPEN_ZOOM, useOwnShip } from "./ownShip";
import { usePreferences } from "../preferences";

/**
 * Own ship on the chart, from the position store: the arrow turned to
 * the GPS heading, the GPS's own accuracy as a faint circle under it,
 * and while `follow` the map kept centred on it -- until a pan by the
 * pilot's own finger, which ends following until the map's location
 * arrow is tapped again (MyPositionButton). A tap that starts it flies
 * the map there and closes in, as Maps' does, to LOCAL_ZOOM or nearer --
 * from the whole country it was a pan at the country's zoom. Nothing
 * about it is interactive: a pilot's finger over their own position is
 * panning the map, not asking for a popup.
 */

/** A sectional's look at the country round the pilot: some 25 nm across
 *  a phone. */
const LOCAL_ZOOM = 11;

/** As far out as the map opens (COUNTRY_ZOOM), and a level further in:
 *  the country, not a place the pilot is looking at. */
const COUNTRY_VIEW = COUNTRY_ZOOM + 1;

// Constants, not literals: react-leaflet restyles a path whenever its
// pathOptions is a new object, and own ship draws at every fix.
const GLIDE_RING: PathOptions = { color: "#16a34a", weight: 2, dashArray: "8 6", fillOpacity: 0, interactive: false };
const ACCURACY: PathOptions = { color: "#1d4ed8", weight: 1, opacity: 0.5, fillColor: "#3b82f6", fillOpacity: 0.08, interactive: false };


export function OwnShipLayer() {
  const map = useMap();
  const enabled = useOwnShip(s => s.enabled);
  const look = usePreferences(s => s.ownShipLook);
  const fix = useOwnShip(s => s.fix);
  const follow = useOwnShip(s => s.follow);
  const setFollow = useOwnShip(s => s.setFollow);
  const recentred = useOwnShip(s => s.recentred);
  const recentreZoom = useOwnShip(s => s.recentreZoom);
  // Memoized handlers: see `AirportsLayer` -- a literal re-registers on
  // every commit and can miss an event fired during one. Only a pan
  // while own ship is on ends following: `follow` is remembered per
  // browser, and a pan at the desk with own ship off would otherwise
  // leave it off in the air, with the checkbox disabled and nothing
  // saying why the map no longer keeps up.
  useMapEvents(useMemo(
    () => ({
      dragstart: () => {
        const { enabled, follow } = useOwnShip.getState();
        if (enabled && follow) setFollow(false);
      },
    }),
    [setFollow],
  ));
  // Kept in the middle of what the panel leaves of the map, not of the
  // whole container under it (centreClear).
  // A tap's recentre waits for the first fix where the GPS has none yet,
  // then flies; later fixes only keep the map on it.
  const flown = useRef(0);
  useEffect(() => {
    if (!enabled || !fix || !follow) return;
    if (flown.current !== recentred) {
      flown.current = recentred;
      // The zoom asked for -- the region round it on opening (locateOnOpen's
      // OPEN_ZOOM) -- or the arrow's close in. From the whole country
      // straight there, as Maps opens on the position: a flight in from the
      // country was a second of the chart streaming by.
      const zoom = recentreZoom ?? Math.min(map.getMaxZoom(), Math.max(map.getZoom(), LOCAL_ZOOM));
      if (map.getZoom() <= COUNTRY_VIEW) {
        map.setView(centreClear(map, [fix.lat, fix.lon], zoom), zoom, { animate: false });
        return;
      }
      // Already in sight at that zoom -- the opening, placed on the last
      // position, with the first fix a few miles off -- a pan, not a
      // flight: flyTo arcs out and in again even for a short hop, and on
      // the owner's phone a fresh load sat 0.8 s zoomed in and then jumped
      // out to the opening's zoom (their screen recording, 2026-10-15).
      const target = centreClear(map, [fix.lat, fix.lon], zoom);
      if (map.getZoom() === zoom && map.getBounds().contains([fix.lat, fix.lon])) {
        // The page's own opening (locateOnOpen, at OPEN_ZOOM): put there,
        // not panned. The map is made where the pilot last was, and the
        // first fix is that place or near it: the pan was the map settling
        // into place on every reload, at the owner's notice ("On a reload
        // why is there animation in the maps"), 35 points under the pill
        // over half a second. The arrow's recentre still pans.
        if (recentreZoom === OPEN_ZOOM) map.setView(target, zoom, { animate: false });
        else map.panTo(target, { animate: true, duration: 0.5 });
        return;
      }
      map.flyTo(target, zoom, { duration: 0.8 });
      return;
    }
    map.panTo(centreClear(map, [fix.lat, fix.lon], map.getZoom()), { animate: true, duration: 0.5 });
  }, [map, enabled, fix, follow, recentred, recentreZoom]);
  // The still-air glide from the GPS's altitude over the nearest field
  // (lib/map/glide), a dashed ring in the air, as an EFB's glide advisor
  // draws it; nothing on the ground. The last field's answer held while
  // the next is asked: asked again every few miles (nearestQuery's 0.05°),
  // the ring went out until each answer came -- flickering under a dry
  // run's airplane, at the owner's notice ("During the dry run, the ring
  // around the plane is flickering").
  const { data: nearest } = useQuery({ ...nearestQuery(fix?.lat ?? 0, fix?.lon ?? 0), enabled: enabled && !!fix, placeholderData: keepPreviousData });
  const glide = glideRangeNm(fix, nearest?.[0]?.elevation_ft);
  if (!fix) return null;
  // Off: the last position alone, grey, with nothing round it.
  if (!enabled) return <Marker position={[fix.lat, fix.lon]} icon={ownShipIcon(null, true, look)} interactive={false} zIndexOffset={1000} keyboard={false} />;
  return (
    <>
      {glide != null && (
        <Circle
          center={[fix.lat, fix.lon]} radius={glide * 1852}
          pathOptions={GLIDE_RING}
        />
      )}
      <Circle
        center={[fix.lat, fix.lon]} radius={fix.accuracyM}
        pathOptions={ACCURACY}
      />
      <Marker position={[fix.lat, fix.lon]} icon={ownShipIcon(fix.headingDeg, false, look)} interactive={false} zIndexOffset={1000} keyboard={false} />
    </>
  );
}
