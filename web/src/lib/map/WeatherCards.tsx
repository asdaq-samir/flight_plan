import type { MapPirep, StationWind, WeatherArea } from "../api/types";
import { faaWords } from "../advisories";
import { altitudeWords, areaWords, barbSvg, pirepMark, routeThrough } from "../weatherMap";
import { divIcon, type IconLike } from "./icons";
import { MapCard } from "./MapCard";

/** A PIREP's chip on the map: its hazard's glyph and its level, in the
 *  hazard's colour, in a 44-point target. */
const pirepIcons = new Map<string, IconLike>();
export function pirepIcon(p: MapPirep): IconLike {
  const { glyph, colour, level } = pirepMark(p);
  const key = `${glyph}${colour}${level}`;
  let icon = pirepIcons.get(key);
  if (!icon) {
    icon = divIcon({
      className: "",
      html: `<span style="display:flex;height:44px;align-items:center;justify-content:center"><span style="display:inline-flex;align-items:center;gap:2px;white-space:nowrap;background:#fff;border:2px solid ${colour};border-radius:10px;padding:0 5px;font:700 12px/18px -apple-system,system-ui,sans-serif;color:${colour}">${glyph} ${level}</span></span>`,
      iconSize: [56, 44], iconAnchor: [28, 22],
    });
    pirepIcons.set(key, icon);
  }
  return icon;
}

/** A station's wind barb, to ten degrees and five knots. */
const barbIcons = new Map<string, IconLike>();
export function barbIcon(w: StationWind): IconLike {
  const key = `${Math.round(w.dir_true_deg / 10)}-${Math.round(w.speed_kt / 5)}`;
  let icon = barbIcons.get(key);
  if (!icon) {
    icon = divIcon({ className: "", html: barbSvg(w.dir_true_deg, w.speed_kt), iconSize: [44, 44], iconAnchor: [22, 22] });
    barbIcons.set(key, icon);
  }
  return icon;
}

/**
 * The weather on the planner's map, at the pilot's pick: where its tiles
 * and its box come from, and the cards a tap on an area, a PIREP or a
 * wind barb opens (the map draws them: lib/map/gl/layers/WeatherGl).
 */

/** The map's view as its four edges. */
type Bounds = { getSouth(): number; getWest(): number; getNorth(): number; getEast(): number };

/** IEM's tile cache: the NEXRAD base reflectivity mosaic and the GOES-East
 *  infrared picture, each kept current there, five minutes apart. */
export const IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0";
export const RADAR_URL = `${IEM}/nexrad-n0q-900913/{z}/{x}/{y}.png`;
export const SATELLITE_URL = `${IEM}/goes-east-ir-4km-900913/{z}/{x}/{y}.png`;

/** How far out the box asked for is rounded, degrees: a pan within it asks
 *  nothing new. */
const GRID_DEG = 2;

/** The part of the chart in sight, rounded out to the grid. */
export function weatherBoxOf(b: Bounds) {
  const out = (v: number, up: boolean) => (up ? Math.ceil(v / GRID_DEG) : Math.floor(v / GRID_DEG)) * GRID_DEG;
  return {
    south: Math.max(-90, out(b.getSouth(), false)), north: Math.min(90, out(b.getNorth(), true)),
    west: Math.max(-180, out(b.getWest(), false)), east: Math.min(180, out(b.getEast(), true)),
  };
}

const zulu = (unix: number) => `${new Date(unix * 1000).toISOString().slice(11, 16)}Z`;

export function AreaCard({ area, line, altitudeFt }: { area: WeatherArea; line: [number, number][] | null; altitudeFt: number | null }) {
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

/** A PIREP's card, on either map. */
export function PirepCard({ pirep }: { pirep: MapPirep }) {
  return (
    <MapCard title={pirep.urgent ? "Urgent PIREP" : "PIREP"} subtitle={[pirep.observed_at && `${pirep.observed_at.slice(11, 16)}Z`, pirep.aircraft].filter(Boolean).join(" · ")}>
      <div className="space-y-1 text-left" data-testid="pirep-card">
        {pirep.altitude_ft != null && <p>At {altitudeWords(pirep.altitude_ft)}</p>}
        {pirep.turbulence && <p>Turbulence: {faaWords(pirep.turbulence)}</p>}
        {pirep.icing && <p>Icing: {faaWords(pirep.icing)}</p>}
        {/* The report as it was sent, as every raw report stays. */}
        {pirep.raw && <p className="font-mono text-muted-foreground">{pirep.raw}</p>}
      </div>
    </MapCard>
  );
}

/** A station's wind aloft's card, on either map. */
export function WindCard({ wind, altitudeFt }: { wind: StationWind; altitudeFt: number }) {
  return (
    <MapCard title={`${String(Math.round(wind.dir_true_deg)).padStart(3, "0")}° true at ${Math.round(wind.speed_kt)} kt`} subtitle={`${wind.ident} · at ${altitudeWords(altitudeFt)}`}>
      {wind.temp_c != null && <p className="text-left" data-testid="wind-card">{wind.temp_c > 0 ? "+" : ""}{wind.temp_c} °C</p>}
    </MapCard>
  );
}

