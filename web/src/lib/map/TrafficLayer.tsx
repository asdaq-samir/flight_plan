import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Marker, useMap, useMapEvents } from "react-leaflet";
import { api } from "../api/client";
import { clearProblem, raiseProblem } from "../problems";
import { usePreferences } from "../preferences";
import { TRAFFIC_COLOURS, trafficIcon } from "./icons";
import { useOwnShip } from "./ownShip";
import { nearOwnHeight, ownShipHex, trafficLabel } from "./traffic";

/** How often the traffic is asked for again, ms: adsb.lol's answer is
 *  shared for five seconds (vfr.traffic). */
const EVERY_MS = 5000;
/** Closer in than this zoom the heights are drawn under the airplanes,
 *  and closer than the next the callsigns: further out, an airport's
 *  traffic is a heap of labels over one another. */
/** An answer older than this is not drawn: three asks missed. */
const STALE_MS = 3 * EVERY_MS;
const PROBLEM = "traffic";
const HEIGHT_ZOOM = 9;
const CALLSIGN_ZOOM = 10;
/** What the Open Database License asks of a map that draws the data. */
const ATTRIBUTION = 'Traffic <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a>, ODbL';

/**
 * The airplanes ADS-B receivers hear about the map (vfr.traffic, from
 * adsb.lol's open data), when the map's settings show them: each a
 * chevron on its track, amber within 1,000 ft of own ship's height, cyan
 * otherwise, with, closer in, its height against own ship's under it as
 * TCAS writes it and, closer still, its callsign. About own ship where it
 * is on, else the middle of the map, out to the map's corners (10 to 60
 * nm); asked again every five seconds while it shows. Own ship's own transponder is left
 * out. Seconds old, with holes where no receiver hears: for knowing
 * what is about, never for avoiding it. Nothing to tap: the map's taps
 * stay the map's.
 */
export function TrafficLayer() {
  const on = usePreferences(s => s.traffic);
  return on ? <Traffic /> : null;
}

function Traffic() {
  const map = useMap();
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const [view, setView] = useState(() => ({ centre: map.getCenter(), radiusNm: radiusOf(map), zoom: map.getZoom() }));
  useMapEvents(useMemo(() => ({
    moveend: () => setView({ centre: map.getCenter(), radiusNm: radiusOf(map), zoom: map.getZoom() }),
  }), [map]));
  // Said where it is drawn, as the licence asks; gone with it.
  useEffect(() => {
    const credit = L.control.attribution({ prefix: false, position: "bottomleft" }).addAttribution(ATTRIBUTION).addTo(map);
    return () => { credit.remove(); };
  }, [map]);
  const at = fix ? { lat: fix.lat, lon: fix.lon } : { lat: view.centre.lat, lon: view.centre.lng };
  // Asked again as the middle moves a mile or so or the view's size by
  // ten miles, not at every pan.
  const ask = { lat: Math.round(at.lat * 50) / 50, lon: Math.round(at.lon * 50) / 50, radius: Math.ceil(view.radiusNm / 10) * 10 };
  const { data, isError, dataUpdatedAt } = useQuery({
    queryKey: ["traffic", ask.lat, ask.lon, ask.radius],
    queryFn: () => api.traffic(ask),
    refetchInterval: EVERY_MS, staleTime: EVERY_MS - 1000, placeholderData: keepPreviousData,
  });
  // An answer that failed to refresh, or is old, is not where the airplanes
  // are now: nothing is drawn, and the map says why.
  const [lateFor, setLateFor] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setLateFor(dataUpdatedAt), STALE_MS);
    return () => clearTimeout(timer);
  }, [dataUpdatedAt]);
  const stale = isError || lateFor === dataUpdatedAt || !data;
  useEffect(() => {
    if (isError) raiseProblem({ id: PROBLEM, title: "Traffic isn't available right now." });
    else clearProblem(PROBLEM);
  }, [isError]);
  useEffect(() => () => clearProblem(PROBLEM), []);
  const planes = stale ? [] : data.aircraft;
  const own = ownShipHex(planes, fix);
  const ownFt = fix?.altitudeFt ?? null;
  const heights = view.zoom >= HEIGHT_ZOOM;
  const callsigns = view.zoom >= CALLSIGN_ZOOM;
  return (
    <>
      {planes.filter(plane => plane.hex !== own).map(plane => (
        <Marker
          key={plane.hex} position={[plane.lat, plane.lon]} interactive={false} keyboard={false}
          icon={trafficIcon(
            plane.track_deg ?? null, nearOwnHeight(plane, ownFt) ? TRAFFIC_COLOURS.near : TRAFFIC_COLOURS.far,
            heights ? trafficLabel(plane, ownFt) : "", callsigns ? plane.callsign ?? null : null,
          )}
        />
      ))}
    </>
  );
}

/** From the middle of the map to its corner, nm, kept between 10 and 60. */
function radiusOf(map: L.Map): number {
  const bounds = map.getBounds();
  const metres = map.getCenter().distanceTo(bounds.getNorthEast());
  return Math.min(60, Math.max(10, metres / 1852));
}
