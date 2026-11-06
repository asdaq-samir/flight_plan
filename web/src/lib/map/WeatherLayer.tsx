import { memo, useEffect, useMemo, useState } from "react";
import L, { type PathOptions } from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { Marker, Pane, Polygon, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { api } from "../api/client";
import type { MapPirep, StationWind, WeatherArea } from "../api/types";
import { faaWords } from "../advisories";
import { altitudeWords, areaColour, areaWords, barbSvg, pirepMark, routeThrough } from "../weatherMap";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";
import { useWeatherLayers } from "./weatherLayers";

/** IEM's tile cache: the NEXRAD base reflectivity mosaic and the GOES-East
 *  infrared picture, each kept current there, five minutes apart. */
const IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0";
const RADAR_URL = `${IEM}/nexrad-n0q-900913/{z}/{x}/{y}.png`;
const SATELLITE_URL = `${IEM}/goes-east-ir-4km-900913/{z}/{x}/{y}.png`;
/** Past this a radar mosaic is called old: IEM makes one every five
 *  minutes, so three missed ones mean it has stopped. */
const RADAR_STALE_MIN = 15;
const CREDIT = 'Radar and satellite: NWS NEXRAD and NOAA GOES via <a href="https://mesonet.agron.iastate.edu" target="_blank" rel="noreferrer">IEM</a>';

/** How far out the box asked for is rounded, degrees: a pan within it asks
 *  nothing new. */
const GRID_DEG = 2;
/** How often what is drawn is asked for again: the products are held five
 *  minutes by the planner (wingtip.weather). */
const REFRESH_MS = 5 * 60_000;

/** The part of the chart in sight, rounded out to the grid. */
function boxOf(map: L.Map) {
  const b = map.getBounds();
  const out = (v: number, up: boolean) => (up ? Math.ceil(v / GRID_DEG) : Math.floor(v / GRID_DEG)) * GRID_DEG;
  return {
    south: Math.max(-90, out(b.getSouth(), false)), north: Math.min(90, out(b.getNorth(), true)),
    west: Math.max(-180, out(b.getWest(), false)), east: Math.min(180, out(b.getEast(), true)),
  };
}

/**
 * The weather on the planner's map, at the owner's pick (the canvas's map
 * weather, the map's own button): the radar and the satellite picture as
 * tiles over the chart and under the route, the SIGMETs and G-AIRMETs as
 * their areas, the pilot reports where they were made, and the winds
 * aloft as barbs at one altitude -- each turned on or off from the map's
 * button (MapSettings). A tap on an area or a report opens its card; an
 * area's says how the route crosses it, at the plan's altitude.
 */
export const WeatherLayer = memo(function WeatherLayer({ line, altitudeFt }: {
  /** The course the map draws ([lat, lon] pairs), for an area's card. */
  line: [number, number][] | null;
  /** The plan's cruise: the winds' "plan" altitude, and an area's. */
  altitudeFt: number | null;
}) {
  const { radar, satellite, areas, pireps, winds } = useWeatherLayers();
  const map = useMap();
  const [box, setBox] = useState(() => boxOf(map));
  // One handlers object for the map's life: a new one at each render drops
  // the events fired in that commit (react-leaflet's useMapEvents).
  const handlers = useMemo(() => ({
    moveend: () => setBox(prev => {
      const next = boxOf(map);
      return next.south === prev.south && next.north === prev.north && next.west === prev.west && next.east === prev.east ? prev : next;
    }),
  }), [map]);
  useMapEvents(handlers);
  const windsFt = winds === "off" ? null : winds === "plan" ? altitudeFt ?? 9000 : winds;
  const wanted = areas || pireps || windsFt !== null || radar;
  const { data } = useQuery({
    queryKey: ["weatherMap", box, windsFt],
    queryFn: () => api.weatherMap(box, windsFt),
    enabled: wanted, staleTime: REFRESH_MS, refetchInterval: REFRESH_MS, meta: { silent: true },
  });
  // The radar's tiles asked for again as a new mosaic is made: IEM's
  // cache keeps one URL for the newest.
  const radarUrl = data?.radar_valid ? `${RADAR_URL}?v=${encodeURIComponent(data.radar_valid)}` : RADAR_URL;
  // The radar is only useful with its time: said on the map's credit line,
  // and unknown where the planner could not read it, never taken as current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const made = data?.radar_valid ? Date.parse(data.radar_valid) : NaN;
  const minutes = Math.round((now - made) / 60_000);
  const radarAge = Number.isNaN(made) ? "time unknown" : `${zulu(made / 1000)}${minutes > RADAR_STALE_MIN ? `, ${minutes} min old` : ""}`;
  const credit = `${CREDIT}${radar ? ` · radar ${radarAge}` : ""}`;
  return (
    <>
      {(radar || satellite) && (
        <Pane name="weather-tiles" style={{ zIndex: 420 }}>
          {satellite && <TileLayer url={SATELLITE_URL} opacity={0.45} maxNativeZoom={9} attribution={credit} pane="weather-tiles" />}
          {radar && <TileLayer key={`${radarUrl}${radarAge}`} url={radarUrl} opacity={0.6} maxNativeZoom={10} attribution={credit} pane="weather-tiles" />}
        </Pane>
      )}
      {areas && data?.advisories.map(a => <AreaShape key={a.id} area={a} line={line} altitudeFt={altitudeFt} />)}
      {pireps && data?.pireps.map((p, i) => <PirepMark key={`${p.lat},${p.lon},${p.observed_at ?? i}`} pirep={p} />)}
      {windsFt !== null && data?.winds?.stations.map(w => <WindBarb key={w.ident} wind={w} altitudeFt={windsFt} />)}
    </>
  );
});

const styleOf = new Map<string, PathOptions>();
/** One style a colour, kept: react-leaflet restyles a path whenever its
 *  pathOptions is new. */
function areaStyle(colour: string, dashed: boolean): PathOptions {
  const key = `${colour}${dashed}`;
  let style = styleOf.get(key);
  if (!style) {
    style = { color: colour, weight: 2, fillColor: colour, fillOpacity: 0.12, dashArray: dashed ? "6 5" : undefined };
    styleOf.set(key, style);
  }
  return style;
}

const AreaShape = memo(function AreaShape({ area, line, altitudeFt }: { area: WeatherArea; line: [number, number][] | null; altitudeFt: number | null }) {
  // A G-AIRMET is a forecast snapshot, dashed; a SIGMET is in force, solid.
  return (
    <Polygon positions={area.coords as [number, number][]} pathOptions={areaStyle(areaColour(area), area.kind === "gairmet")}>
      <MapPopup>
        <AreaCard area={area} line={line} altitudeFt={altitudeFt} />
      </MapPopup>
    </Polygon>
  );
});

const zulu = (unix: number) => `${new Date(unix * 1000).toISOString().slice(11, 16)}Z`;

function AreaCard({ area, line, altitudeFt }: { area: WeatherArea; line: [number, number][] | null; altitudeFt: number | null }) {
  const { title, altitudes } = areaWords(area);
  const when = area.kind === "gairmet"
    ? area.valid_from != null ? `Forecast for ${zulu(area.valid_from)}` : null
    : [area.valid_from != null && `From ${zulu(area.valid_from)}`, area.valid_to != null && `to ${zulu(area.valid_to)}`].filter(Boolean).join(" ");
  const through = line ? routeThrough(area, line, altitudeFt) : null;
  return (
    <MapCard title={title} subtitle={[area.severity && faaWords(area.severity), when].filter(Boolean).join(" · ")}>
      <div className="space-y-1 text-left" data-testid="weather-area-card">
        {altitudes && <p>{altitudes}</p>}
        {/* What it means for this flight: how far the route is in it, and
            whether the planned altitude is under, in or over it. */}
        {through && (
          <p className="font-semibold" data-testid="weather-area-route">
            Your route crosses it for {Math.round(through.nm)} nm
            {through.relation && altitudeFt != null ? `, at ${altitudeWords(altitudeFt)}: ${through.relation === "in" ? "in it" : `${through.relation} it`}` : ""}.
          </p>
        )}
        {area.raw && <p className="text-muted-foreground">{area.kind === "gairmet" ? faaWords(area.raw) : area.raw}</p>}
      </div>
    </MapCard>
  );
}

const iconOf = new Map<string, L.DivIcon>();
function pirepIcon(p: MapPirep): L.DivIcon {
  const { glyph, colour, level } = pirepMark(p);
  const key = `${glyph}${colour}${level}`;
  let icon = iconOf.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: "",
      html: `<span style="display:flex;height:44px;align-items:center;justify-content:center"><span style="display:inline-flex;align-items:center;gap:2px;white-space:nowrap;background:#fff;border:2px solid ${colour};border-radius:10px;padding:0 5px;font:700 12px/18px -apple-system,system-ui,sans-serif;color:${colour}">${glyph} ${level}</span></span>`,
      iconSize: [56, 44], iconAnchor: [28, 22],
    });
    iconOf.set(key, icon);
  }
  return icon;
}

const PirepMark = memo(function PirepMark({ pirep }: { pirep: MapPirep }) {
  return (
    <Marker position={[pirep.lat, pirep.lon]} icon={pirepIcon(pirep)} keyboard={false}>
      <MapPopup>
        <MapCard title={pirep.urgent ? "Urgent PIREP" : "PIREP"} subtitle={[pirep.observed_at && `${pirep.observed_at.slice(11, 16)}Z`, pirep.aircraft].filter(Boolean).join(" · ")}>
          <div className="space-y-1 text-left" data-testid="pirep-card">
            {pirep.altitude_ft != null && <p>At {altitudeWords(pirep.altitude_ft)}</p>}
            {pirep.turbulence && <p>Turbulence: {faaWords(pirep.turbulence)}</p>}
            {pirep.icing && <p>Icing: {faaWords(pirep.icing)}</p>}
            {/* The report as it was sent, as every raw report stays. */}
            {pirep.raw && <p className="font-mono text-muted-foreground">{pirep.raw}</p>}
          </div>
        </MapCard>
      </MapPopup>
    </Marker>
  );
});

const barbOf = new Map<string, L.DivIcon>();
function barbIcon(w: StationWind): L.DivIcon {
  const key = `${Math.round(w.dir_true_deg / 10)}-${Math.round(w.speed_kt / 5)}`;
  let icon = barbOf.get(key);
  if (!icon) {
    icon = L.divIcon({ className: "", html: barbSvg(w.dir_true_deg, w.speed_kt), iconSize: [44, 44], iconAnchor: [22, 22] });
    barbOf.set(key, icon);
  }
  return icon;
}

const WindBarb = memo(function WindBarb({ wind, altitudeFt }: { wind: StationWind; altitudeFt: number }) {
  return (
    <Marker position={[wind.lat, wind.lon]} icon={barbIcon(wind)} keyboard={false} title={`${wind.ident}: ${Math.round(wind.dir_true_deg)}° true at ${Math.round(wind.speed_kt)} kt`}>
      <MapPopup>
        <MapCard title={`${String(Math.round(wind.dir_true_deg)).padStart(3, "0")}° true at ${Math.round(wind.speed_kt)} kt`} subtitle={`${wind.ident} · at ${altitudeWords(altitudeFt)}`}>
          {wind.temp_c != null && <p className="text-left" data-testid="wind-card">{wind.temp_c > 0 ? "+" : ""}{wind.temp_c} °C</p>}
        </MapCard>
      </MapPopup>
    </Marker>
  );
});
