import L from "leaflet";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import type { Course } from "../api/types";

/**
 * Leaflet, kept imperative on purpose.
 *
 * Every React binding for a map library is a wrapper over these same
 * calls, and the map was never where the faults were -- they were in
 * derived state, which React now owns. So the map stays a plain object
 * the components talk to, and the only rule is that nothing here reads
 * React state.
 *
 * The one exception is content: Leaflet's tooltips, popups and divIcons
 * each accept an HTMLElement, so instead of building markup as strings
 * (which is what this used to do), a React root is mounted into a
 * throwaway div and that div is handed to Leaflet. `flushSync` forces
 * the render to finish before the div leaves this function, since
 * Leaflet reads it synchronously. The root is never explicitly
 * unmounted -- these are small and short-lived, and Leaflet detaches
 * the node from the document when the layer goes away.
 */
function mountReact(content: ReactNode): HTMLElement {
  const el = document.createElement("div");
  flushSync(() => createRoot(el).render(content));
  return el;
}

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
    color: "#000", weight: 18, opacity: 0,
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
export function createHalo(
  map: L.Map, at: L.LatLngExpression, content?: ReactNode, onClose?: () => void,
) {
  const ring = L.featureGroup([
    L.circleMarker(at, { radius: 19, color: "rgba(10,20,28,.55)", weight: 9, fill: false, interactive: false }),
    L.circleMarker(at, { radius: 19, color: "#ffffff", weight: 6, fill: false, interactive: false }),
    L.circleMarker(at, { radius: 19, color: "#ff3b00", weight: 3, fill: false, interactive: false }),
  ]).addTo(map);
  ring.bringToFront();   // FeatureGroup, not LayerGroup -- only this one has it
  const marker = ring.getLayers()[2]!;
  if (content) {
    // A popup, not a tooltip: it needs to hold real controls (a rating
    // button, a category select), and it comes with a close button and
    // an offset above its anchor for free. autoClose/closeOnClick are
    // off because React's selection state, not an incidental map click,
    // is what should decide whether this is open -- the close button
    // (wired to `onClose`) is the only other way out. maxWidth is wider
    // than Leaflet's 300px default: the rating row (six buttons) plus
    // Leaflet's own ~44px of popup margin needs the room.
    // autoPan is off deliberately: stepping between points calls
    // map.setView to centre the point being walked to, and Leaflet's
    // default autoPan would re-pan on top of that to keep a tall popup
    // fully visible, undoing the centring -- the point would drift off
    // centre exactly when a rated point's fuller popup opened above it.
    marker.bindPopup(mountReact(content), {
      offset: [0, -16], autoClose: false, closeOnClick: false, autoPan: false,
      maxWidth: 340, minWidth: 240,
    }).openPopup();
    // `popupclose` fires both for an actual close-button click and for
    // removeLayer() closing it as a side effect of teardown -- stepping
    // to the next point removes this ring to draw the next one, which
    // would otherwise deselect whatever it just selected. The caller
    // detaches this via `off("popupclose")` before removing the ring on
    // purpose, not on user close.
    if (onClose) marker.on("popupclose", onClose);
  }
  return { ring, marker };
}

/** Swaps a halo's popup content in place, for when the same point is
 *  still selected and only what it says has changed (a live count
 *  while detections are still streaming in) -- rebuilding the whole
 *  ring for that reads as the selection itself reloading. */
export function updateHaloContent(marker: L.Layer, content: ReactNode) {
  marker.setPopupContent(mountReact(content));
}

/**
 * A marker with three edges: a white casing to separate it from dark
 * linework, a dark hairline outside that so it still separates from pale
 * paper, and a shadow to lift it off both. One edge is never enough on a
 * chart this busy.
 */
export function dotIcon(fill: string, label?: string | number) {
  const withLabel = label !== undefined;
  return L.divIcon({
    className: "",
    iconSize: withLabel ? [28, 28] : [20, 20],
    iconAnchor: withLabel ? [14, 14] : [10, 10],
    html: mountReact(
      <div
        className={`rounded-full border-[2.5px] border-white shadow-[0_1px_4px_rgba(0,0,0,.45)] outline outline-1 outline-[rgba(10,20,28,.55)] ${
          withLabel
            ? "grid h-[22px] w-[22px] place-items-center text-xs font-bold text-white"
            : "h-4 w-4"
        }`}
        style={{ backgroundColor: fill }}
      >
        {label ?? ""}
      </div>,
    ),
  });
}

/** The airport pill: sized to its ident, centred in a wider icon box.
 *  `className: ""` suppresses Leaflet's default `.leaflet-div-icon` box
 *  (white fill, grey border) since this draws its own. */
export function endLabelIcon(ident: string) {
  return L.divIcon({
    className: "",
    iconSize: [90, 20], iconAnchor: [45, 10],
    html: mountReact(
      <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-semibold shadow-sm">
        {ident}
      </span>,
    ),
  });
}

export { mountReact };
