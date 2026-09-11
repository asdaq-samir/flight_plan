import L from "leaflet";
import type { Course } from "../api/types";

/**
 * Leaflet, kept imperative on purpose.
 *
 * Every React binding for a map library is a wrapper over these same
 * calls, and the map was never where the faults were -- they were in
 * derived state, which React now owns. So the map stays a plain object
 * the components talk to, and the only rule is that nothing here reads
 * React state.
 */

/** Sectional tiles stop at zoom 12 and 404 below 8, so the chart alone can
 *  never frame a long leg. OpenStreetMap sits underneath for that. */
export function createBasemaps(map: L.Map, cfg: Course) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors", maxZoom: 19, opacity: 0.85,
  }).addTo(map);

  const layers = {
    // maxNativeZoom upscales chart tiles past their real limit rather than
    // showing blanks when the map is zoomed in.
    faa: L.tileLayer(cfg.tile_url, {
      attribution: "FAA Aeronautical Information Services",
      maxNativeZoom: cfg.max_zoom, maxZoom: 18, minZoom: cfg.min_zoom,
    }),
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    }),
  };
  let active: keyof typeof layers = "faa";
  layers[active].addTo(map);

  return {
    get active() { return active; },
    get belowChart() { return map.getZoom() < (cfg.min_zoom || 8); },
    toggle() {
      map.removeLayer(layers[active]);
      active = active === "faa" ? "osm" : "faa";
      layers[active].addTo(map);
      return active;
    },
  };
}

/**
 * The course: a white casing under an orange-red core, plus a wide
 * invisible line to hover.
 *
 * A sectional already uses blue, magenta, black, brown, yellow and green,
 * so no single stroke wins on colour -- the casing is what makes it read,
 * the same way the chart draws its own linework. The hit line exists
 * because an SVG stroke is hoverable only where it is painted, and a
 * 3.5 px dashed line is mostly not painted.
 */
export function createCourseLine(
  map: L.Map,
  line: [number, number][],
  opts: { tooltip?: string; onClick?: (latlng: L.LatLng) => void } = {},
) {
  const hit = L.polyline(line, {
    color: "#000", weight: 18, opacity: 0, className: "course-hit",
    interactive: true, bubblingMouseEvents: !opts.onClick, lineCap: "butt",
  });
  if (opts.tooltip) hit.bindTooltip(opts.tooltip, { sticky: true });
  if (opts.onClick) {
    hit.on("click", (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      opts.onClick!(e.latlng);
    });
  }
  return L.layerGroup([
    L.polyline(line, { color: "#ffffff", weight: 8, opacity: 0.85, interactive: false }),
    L.polyline(line, {
      color: "#ff3b00", weight: 3.5, opacity: 1, dashArray: "11,7", interactive: false,
    }),
    hit,
  ]).addTo(map);
}

/**
 * The ring around the selected point: cased both sides so it holds over
 * black roads and blank paper alike, and pulsing, because on a chart full
 * of circles the one that moves is the one the eye finds.
 */
export function createHalo(map: L.Map, at: L.LatLngExpression, label?: string) {
  const ring = L.featureGroup([
    L.circleMarker(at, { radius: 19, color: "rgba(10,20,28,.55)", weight: 9, fill: false, interactive: false }),
    L.circleMarker(at, { radius: 19, color: "#ffffff", weight: 6, fill: false, interactive: false }),
    L.circleMarker(at, { radius: 19, color: "#ff3b00", weight: 3, fill: false, interactive: false, className: "halo-pulse" }),
  ]).addTo(map);
  ring.bringToFront();   // FeatureGroup, not LayerGroup -- only this one has it
  if (label) {
    // Pinned above the ring and travelling with it: a label in a corner
    // describing a ring elsewhere is a lookup nobody should have to do.
    ring.getLayers()[2]!.bindTooltip(label, {
      permanent: true, direction: "top", offset: [0, -22],
      className: "selinfo-tip", opacity: 1,
    }).openTooltip();
  }
  return ring;
}

/**
 * A marker with three edges: a white casing to separate it from dark
 * linework, a dark hairline outside that so it still separates from pale
 * paper, and a shadow to lift it off both. One edge is never enough on a
 * chart this busy.
 */
export function dotIcon(fill: string, label?: string | number) {
  const sized = label === undefined
    ? "width:16px;height:16px"
    : "width:22px;height:22px;display:grid;place-items:center;font:700 12px system-ui;color:#fff";
  return L.divIcon({
    className: "",
    iconSize: label === undefined ? [20, 20] : [28, 28],
    iconAnchor: label === undefined ? [10, 10] : [14, 14],
    html: `<div style="${sized};background:${fill};border-radius:50%;
      border:2.5px solid #fff;outline:1px solid rgba(10,20,28,.55);
      box-shadow:0 1px 4px rgba(0,0,0,.45)">${label ?? ""}</div>`,
  });
}

/** The airport pill: sized to its ident, centred in a wider icon box. */
export function endLabelIcon(ident: string) {
  return L.divIcon({
    className: "end-label", iconSize: [90, 20], iconAnchor: [45, 10],
    html: `<span>${ident}</span>`,
  });
}
