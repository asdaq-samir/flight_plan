import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMap, useMapEvents } from "react-leaflet";
import { api } from "../api/client";
import type { TrafficAircraft } from "../api/types";
import { clearProblem, raiseProblem } from "../problems";
import { usePreferences } from "../preferences";
import { TRAFFIC_COLOURS, trafficIcon } from "./icons";
import { useOwnShip, type Fix } from "./ownShip";
import { CARRY_S, agedBy, carriedOn, nearOwnHeight, ownShipHex, trafficLabel, trendPx } from "./traffic";

/** How often the traffic is asked for again, ms: the planner asks
 *  adsb.lol about a region at most every five seconds (vfr.traffic). */
const EVERY_MS = 5000;
/** How often the airplanes are moved on the map between answers, ms:
 *  ten times a second reads as gliding, at a tenth of the frames. */
const FRAME_MS = 100;
/** A new report for an airplane already drawn takes it there over this
 *  long, ms, from where it had been carried to, rather than at a jump. */
const BLEND_MS = 1000;
/** Closer in than this zoom the heights are drawn under the airplanes,
 *  and closer than the next the callsigns: further out, an airport's
 *  traffic is a heap of labels over one another. */
const HEIGHT_ZOOM = 9;
const CALLSIGN_ZOOM = 10;
const PROBLEM = "traffic";
/** What the Open Database License asks of a map that draws the data. */
const ATTRIBUTION = 'Traffic <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a>, ODbL';

/** One airplane on the map: its report, when that position was (this
 *  phone's clock, ms), and what is left of the step to it from where it
 *  was being drawn. */
interface Target {
  marker: L.Marker;
  plane: TrafficAircraft;
  at: number;
  shift: { lat: number; lon: number; from: number } | null;
  icon: L.DivIcon | null;
}

/**
 * The airplanes ADS-B receivers hear about the map (vfr.traffic, from
 * adsb.lol's open data), when the map's settings show them: each a
 * chevron on its track with a line to where it will be in a minute,
 * amber within 1,000 ft of own ship's height, cyan otherwise, with,
 * closer in, its height against own ship's under it as TCAS writes it
 * and, closer still, its callsign.
 *
 * Smooth, as ForeFlight and FlightAware draw theirs: the reports come
 * every five seconds, seconds old, and between them each airplane is
 * carried on from its report along its track at its ground speed, moved
 * ten times a second; a new report takes it to where it should be over a
 * second rather than at a jump. Past half a minute since its report it is
 * not drawn. About own ship where it is on, else the middle of the map,
 * out to the map's corners (10 to 60 nm). Own ship's own transponder is
 * left out. For knowing what is about, never for avoiding it. Nothing to
 * tap: the map's taps stay the map's.
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
  const { data, isError, isPlaceholderData, dataUpdatedAt } = useQuery({
    queryKey: ["traffic", ask.lat, ask.lon, ask.radius],
    queryFn: () => api.traffic(ask),
    refetchInterval: EVERY_MS, staleTime: EVERY_MS - 1000, placeholderData: keepPreviousData,
    // Said here, in words of its own, not as the planner's failure.
    meta: { silent: true },
  });
  // The planner answers 503 only once adsb.lol has given nothing for a
  // minute (vfr.traffic): then the map says so, and the airplanes, carried
  // on no further than half a minute, have gone.
  useEffect(() => {
    if (isError) raiseProblem({ id: PROBLEM, title: "Traffic isn't available right now." });
    else clearProblem(PROBLEM);
  }, [isError]);
  useEffect(() => () => clearProblem(PROBLEM), []);

  const targets = useRef(new Map<string, Target>());
  const layer = useMemo(() => L.layerGroup(), []);
  // Own ship's fix as an answer comes, to leave its own transponder out.
  const fixNow = useRef<Fix | null>(null);
  useEffect(() => { fixNow.current = fix; }, [fix]);
  useEffect(() => {
    layer.addTo(map);
    const drawn = targets.current;
    return () => {
      layer.remove();
      drawn.clear();
    };
  }, [map, layer]);

  // Each answer: its airplanes, when each was where it is given (now, less
  // the answer's age and each one's own), into the targets.
  useEffect(() => {
    // The last view's answer, held while this one's is asked: already in.
    if (!data || isPlaceholderData) return;
    const received = dataUpdatedAt;
    const own = ownShipHex(agedBy(data.aircraft, data.age_s ?? 0), fixNow.current);
    const seen = new Set<string>();
    for (const plane of data.aircraft) {
      if (plane.hex === own) continue;
      seen.add(plane.hex);
      const at = received - ((data.age_s ?? 0) + (plane.seen_s ?? 0)) * 1000;
      const held = targets.current.get(plane.hex);
      if (!held) {
        const marker = L.marker([plane.lat, plane.lon], { interactive: false, keyboard: false });
        targets.current.set(plane.hex, { marker, plane, at, shift: null, icon: null });
        continue;
      }
      if (at <= held.at) continue;
      // From where it is drawn now to where the new report puts it now,
      // over BLEND_MS.
      const now = Date.now();
      const drawnAt = held.marker.getLatLng();
      const should = carriedOn(plane, (now - at) / 1000);
      held.shift = { lat: drawnAt.lat - should.lat, lon: drawnAt.lng - should.lon, from: now };
      held.plane = plane;
      held.at = at;
    }
    for (const [hex, target] of targets.current) {
      if (!seen.has(hex)) {
        layer.removeLayer(target.marker);
        targets.current.delete(hex);
      }
    }
  }, [data, isPlaceholderData, dataUpdatedAt, layer]);

  // The icons, as the reports, own ship's height and the zoom change.
  const ownFt = fix?.altitudeFt ?? null;
  useEffect(() => {
    const heights = view.zoom >= HEIGHT_ZOOM, callsigns = view.zoom >= CALLSIGN_ZOOM;
    for (const target of targets.current.values()) {
      const { plane } = target;
      const icon = trafficIcon(
        plane.track_deg ?? null, nearOwnHeight(plane, ownFt) ? TRAFFIC_COLOURS.near : TRAFFIC_COLOURS.far,
        heights ? trafficLabel(plane, ownFt) : "", callsigns ? plane.callsign ?? null : null,
        trendPx(plane.speed_kt, plane.lat, view.zoom),
      );
      if (icon !== target.icon) {
        target.icon = icon;
        target.marker.setIcon(icon);
      }
    }
  }, [data, ownFt, view.zoom]);

  // Ten times a second, each airplane carried on to where it is now; none
  // moved while the map zooms, whose animation places the markers itself.
  useEffect(() => {
    let zooming = false;
    const zoomStart = () => { zooming = true; };
    const zoomEnd = () => { zooming = false; };
    map.on("zoomstart", zoomStart);
    map.on("zoomend", zoomEnd);
    let frame = 0, last = 0;
    const step = (time: number) => {
      frame = requestAnimationFrame(step);
      if (zooming || time - last < FRAME_MS) return;
      last = time;
      const now = Date.now();
      for (const [hex, target] of targets.current) {
        const age = (now - target.at) / 1000;
        if (age > CARRY_S) {
          layer.removeLayer(target.marker);
          targets.current.delete(hex);
          continue;
        }
        let { lat, lon } = carriedOn(target.plane, age);
        if (target.shift) {
          const left = 1 - (now - target.shift.from) / BLEND_MS;
          if (left <= 0) target.shift = null;
          else {
            lat += target.shift.lat * left;
            lon += target.shift.lon * left;
          }
        }
        target.marker.setLatLng([lat, lon]);
        if (!layer.hasLayer(target.marker) && target.icon) layer.addLayer(target.marker);
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      map.off("zoomstart", zoomStart);
      map.off("zoomend", zoomEnd);
    };
  }, [map, layer]);
  return null;
}

/** From the middle of the map to its corner, nm, kept between 10 and 60. */
function radiusOf(map: L.Map): number {
  const bounds = map.getBounds();
  const metres = map.getCenter().distanceTo(bounds.getNorthEast());
  return Math.min(60, Math.max(10, metres / 1852));
}
