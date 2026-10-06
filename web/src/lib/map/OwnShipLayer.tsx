import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Circle, Marker, useMap, useMapEvents } from "react-leaflet";
import { nearestQuery } from "../queryClient";
import { glideRangeNm } from "./glide";
import { centreClear } from "./clear";
import { ownShipIcon } from "./icons";
import { useOwnShip } from "./ownShip";

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

/** As far out as the map opens (MapShell's COUNTRY_ZOOM), and a little
 *  further in: the country, not a place the pilot is looking at. */
const COUNTRY_ZOOM = 5;

/** Where the planner opens on the pilot's position: four levels out from
 *  LOCAL_ZOOM, some 200 nm across a phone -- the region a flight from
 *  here goes to, the pilot found, where LOCAL_ZOOM was too close in. */
const OPEN_ZOOM = LOCAL_ZOOM - 4;

export function OwnShipLayer() {
  const map = useMap();
  const enabled = useOwnShip(s => s.enabled);
  const fix = useOwnShip(s => s.fix);
  const follow = useOwnShip(s => s.follow);
  const setFollow = useOwnShip(s => s.setFollow);
  const recentred = useOwnShip(s => s.recentred);
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
      // From the whole country, as the planner opens before it knows where
      // the pilot is, straight there, as Maps opens on the position -- a
      // flight in from the country was a second of the chart streaming by
      // -- and to the region round it (OPEN_ZOOM), not the fields next door.
      if (map.getZoom() <= COUNTRY_ZOOM) {
        map.setView(centreClear(map, [fix.lat, fix.lon], OPEN_ZOOM), OPEN_ZOOM, { animate: false });
        return;
      }
      const zoom = Math.min(map.getMaxZoom(), Math.max(map.getZoom(), LOCAL_ZOOM));
      map.flyTo(centreClear(map, [fix.lat, fix.lon], zoom), zoom, { duration: 0.8 });
      return;
    }
    map.panTo(centreClear(map, [fix.lat, fix.lon], map.getZoom()), { animate: true, duration: 0.5 });
  }, [map, enabled, fix, follow, recentred]);
  // The still-air glide from the GPS's altitude over the nearest field
  // (lib/map/glide), a dashed ring in the air, as an EFB's glide advisor
  // draws it; nothing on the ground.
  const { data: nearest } = useQuery({ ...nearestQuery(fix?.lat ?? 0, fix?.lon ?? 0), enabled: enabled && !!fix });
  const glide = glideRangeNm(fix, nearest?.[0]?.elevation_ft);
  if (!fix) return null;
  // Off: the last position alone, grey, with nothing round it.
  if (!enabled) return <Marker position={[fix.lat, fix.lon]} icon={ownShipIcon(null, true)} interactive={false} zIndexOffset={1000} keyboard={false} />;
  return (
    <>
      {glide != null && (
        <Circle
          center={[fix.lat, fix.lon]} radius={glide * 1852}
          pathOptions={{ color: "#16a34a", weight: 2, dashArray: "8 6", fillOpacity: 0, interactive: false }}
        />
      )}
      <Circle
        center={[fix.lat, fix.lon]} radius={fix.accuracyM}
        pathOptions={{ color: "#1d4ed8", weight: 1, opacity: 0.5, fillColor: "#3b82f6", fillOpacity: 0.08, interactive: false }}
      />
      <Marker position={[fix.lat, fix.lon]} icon={ownShipIcon(fix.headingDeg)} interactive={false} zIndexOffset={1000} keyboard={false} />
    </>
  );
}
