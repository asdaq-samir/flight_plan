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

// A little slack over the six rating buttons' own bare width: that
// row has no padding or border of its own, but the popup box wrapped
// around it does.
const POPUP_WIDTH_PADDING = 16;
// If measurement ever comes back implausibly small (a future markup
// change losing the selector, say), this is the last known-good width
// rather than trusting a broken reading and clipping anyway.
const POPUP_WIDTH_FALLBACK = 216;

/**
 * However wide the six rating buttons actually render in this browser,
 * measured directly rather than guessed -- a fixed pixel constant
 * tuned on one browser clipped the last button in another (mobile Safari
 * and desktop Chrome don't lay out the same unwrapped row of buttons at
 * exactly the same width), and Leaflet's own auto-sizing has its own
 * failure mode (see the comment at the call site below). Measuring
 * needs the node attached to the real document -- an element with no
 * parent has no layout box, so `getBoundingClientRect` on anything
 * inside it reads all zero -- so this attaches `el` off-screen just
 * long enough to read it, then detaches it again before Leaflet ever
 * sees it.
 */
function measureRatingRowWidth(el: HTMLElement): number | null {
  const row = el.querySelector<HTMLElement>("[data-rating-row]");
  if (!row) return null;
  el.style.position = "absolute";
  el.style.visibility = "hidden";
  el.style.left = "-9999px";
  el.style.top = "0";
  document.body.appendChild(el);
  const width = Math.ceil(row.getBoundingClientRect().width);
  document.body.removeChild(el);
  el.removeAttribute("style");
  return width > 100 ? width : null;
}

/**
 * Leaflet measures its container once at init and never again on its
 * own, so a resize the map didn't cause itself -- the sidebar
 * collapsing, a window resize -- leaves it drawing into its old
 * dimensions until something calls `invalidateSize()`. A
 * ResizeObserver on the container catches all of those in one place.
 */
export function observeResize(map: L.Map, el: HTMLElement): () => void {
  const observer = new ResizeObserver(() => map.invalidateSize());
  observer.observe(el);
  return () => observer.disconnect();
}

/** The always-present OpenStreetMap backdrop -- added the moment the
 *  map itself is created, independent of any route. Without this, the
 *  map sat completely blank (no tiles at all, not even a world map)
 *  for as long as the course/checkpoints/nav-log fetch took, because
 *  `createBasemaps` below -- the only thing that ever added a tile
 *  layer -- couldn't run until `course` existed. A pilot should see a
 *  map immediately, with the route layering in on top of it as it
 *  arrives, not a grey rectangle until it does. */
export function createBaseLayer(map: L.Map) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors", maxZoom: 19, opacity: 0.85,
  }).addTo(map);
}

/** Sectional tiles stop at zoom 12 and 404 below 8, so the chart alone can
 *  never frame a long leg. `createBaseLayer`'s own OpenStreetMap layer
 *  sits underneath for that; this only adds the toggleable FAA/OSM
 *  pair on top of it, which needs the course's own tile_url and zoom
 *  limits and so can't exist before a course does. */
export function createBasemaps(map: L.Map, cfg: Course) {
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
  openInitially = true,
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
    // (wired to `onClose`) is the only other way out.
    // autoPan is off deliberately: stepping between points calls
    // map.setView to centre the point being walked to, and Leaflet's
    // default autoPan would re-pan on top of that to keep a tall popup
    // fully visible, undoing the centring -- the point would drift off
    // centre exactly when a rated point's fuller popup opened above it.
    // minWidth == maxWidth, a fixed width rather than Leaflet's own
    // auto-sizing: Leaflet measures a popup's natural width by
    // temporarily forcing it onto one line and reading offsetWidth, and
    // that measurement is unreliable at some viewport widths -- it was
    // observed collapsing all the way to Leaflet's own 50px floor,
    // with the six rating buttons then overflowing past the (much too
    // narrow) white popup box. The width itself is measured fresh here
    // rather than a constant, though -- see measureRatingRowWidth --
    // since a constant tuned on one browser is exactly what clipped the
    // rating row on another one.
    const el = mountReact(content);
    const ratingWidth = measureRatingRowWidth(el);
    const width = ratingWidth !== null ? ratingWidth + POPUP_WIDTH_PADDING : POPUP_WIDTH_FALLBACK;
    const popup = marker.bindPopup(el, {
      offset: [0, -16], autoClose: false, closeOnClick: false, autoPan: false,
      minWidth: width, maxWidth: width,
    });
    // Fit-line wants the ring to stay put but the rating menu gone --
    // this is what makes that possible without tearing the halo down:
    // the popup starts closed instead of always open.
    if (openInitially) popup.openPopup();
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

/** Opens or closes the halo's menu without touching the ring itself --
 *  the fit-line view wants exactly that: the selection stays visible,
 *  only the popup goes away. `off`/`on` around the programmatic close
 *  keeps it from firing `onClose` the same way a real close-button
 *  click (or the ring itself being torn down) does. */
export function setHaloMenuOpen(marker: L.Layer, open: boolean, onClose?: () => void) {
  if (open) {
    marker.openPopup();
    return;
  }
  if (onClose) marker.off("popupclose", onClose);
  marker.closePopup();
  if (onClose) marker.on("popupclose", onClose);
}

/**
 * A marker with three edges: a white casing to separate it from dark
 * linework, a dark hairline outside that so it still separates from pale
 * paper, and a shadow to lift it off both. One edge is never enough on a
 * chart this busy.
 */
export function dotIcon(fill: string, label?: string | number) {
  const withLabel = label !== undefined;
  // The tap target (iconSize) is bigger than the visual dot on purpose --
  // a 20px dot is well under a comfortable touch target, but making the
  // dot itself that big would make dense stretches of route hard to read.
  // Centering it in a larger invisible box needs `position: absolute` +
  // a transform, not a flex wrapper: Leaflet's own stylesheet sets
  // `.leaflet-marker-icon { display: block }`, which wins the cascade
  // over a `flex` utility class of the same specificity and silently
  // leaves the dot top-aligned instead. Absolute positioning relative
  // to the icon container (which Leaflet does set `position: absolute`
  // on) isn't subject to that fight.
  const tapSize = withLabel ? 36 : 32;
  return L.divIcon({
    className: "",
    iconSize: [tapSize, tapSize],
    iconAnchor: [tapSize / 2, tapSize / 2],
    html: mountReact(
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-background shadow-[0_1px_4px_rgba(0,0,0,.45)] outline outline-1 outline-[rgba(10,20,28,.55)] ${
          withLabel
            // leading-none: a browser's own default line-height for
            // text-xs isn't exactly 1, and that slack renders above or
            // below the glyph asymmetrically depending on the browser's
            // own font metrics -- place-items-center alone centers the
            // *line box*, not the glyph within it, so that slack still
            // reads as the number sitting off-center within the circle.
            ? "grid h-[22px] w-[22px] place-items-center text-xs font-bold leading-none text-white"
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
      <span className="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-semibold shadow-sm">
        {ident}
      </span>,
    ),
  });
}

export { mountReact };
