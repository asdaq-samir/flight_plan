import L from "leaflet";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import type { Course } from "../api/types";
import { chartLayers } from "./chartLayers";

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

/** The chart layers: one FAA chart as the map's base (the sectional,
 *  or an IFR enroute chart, per the `chartLayers` setting), and the
 *  terminal area chart over the sectional. All need the course's own
 *  zoom limits (`chart_layers`), so this runs once the course exists --
 *  which costs nothing visible, since `useLeafletMap` gives the map no
 *  view until the course's own fit sets one, and Leaflet fetches no
 *  tile before it has a view.
 *
 *  There is no street map under the chart any more. OpenStreetMap
 *  used to sit underneath for the zooms the sectional had no tiles at
 *  and as a `t`-key alternative; now the sectional is drawn all the
 *  way out to zoom 3, every sheet of the country is rendered ahead of
 *  time (`python -m vfr.charts pyramid`), and a pilot looks at the
 *  chart and nothing else, the way vfrmap.com and SkyVector do it. */
export function createBasemaps(map: L.Map, cfg: Course) {
  const zoomsOf = (kind: string) => cfg.chart_layers.find(l => l.kind === kind);

  // Plain tile layers whose tiles come from this app's own
  // planning-service (/api/chart-tile/<kind>): a {z}/{x}/{y} pyramid
  // rendered from the FAA's own GeoTIFF of each sheet
  // (src/vfr/charts.py). Tiles fetch only the new edge on a pan, scale
  // the previous zoom's tiles under the zoom animation, and prefetch a
  // ring (keepBuffer) beyond the viewport, all of it Leaflet's own
  // tested behaviour -- which is why the chart is served as tiles at
  // all, rather than drawn as the one-image-per-view dynamic layer it
  // once was ("tiles snap on", every pan).
  //
  // maxNativeZoom, not maxZoom: past the chart's own max_zoom (its
  // print resolution) Leaflet upscales the last real tiles rather than
  // asking for ones that would only be the same pixels bigger. maxZoom
  // stops that three levels later: an 8x upscale is still a legible
  // (if soft) chart, and with no other layer to fall back to there is
  // nothing to show past it -- so it is also as far as the map zooms.
  // `?c=<cycle>` on every tile URL: the tiles are cacheable for
  // weeks, and a browser that cached this {z}/{x}/{y} under an earlier
  // edition -- or under the hosted map service this app drew before,
  // whose no-coverage checkerboard a phone kept showing for a day --
  // must ask again when the edition changes.
  // Published to a CDN (the AWS deployment), the tiles come straight
  // from there and the cycle is a path segment; served by the planner
  // itself, the cycle is the cache-busting query.
  const template = (kind: string) => cfg.chart_tiles_base
    ? `${cfg.chart_tiles_base}/${cfg.chart_cycle}/${kind}/{z}/{x}/{y}.png`
    : `/api/planner/chart-tile/${kind}/{z}/{x}/{y}.png?c={cycle}`;
  // updateWhenIdle false: Leaflet's own default on a phone is to ask
  // for no tile until the finger lifts, which a pilot panning across a
  // route felt as the chart arriving late every time; loading during
  // the pan costs a few tiles that scroll straight off again and
  // shows the chart as it comes.
  const tileLayer = (kind: string, minZoom: number, maxZoom: number, extra: Partial<L.TileLayerOptions> = {}) =>
    L.tileLayer(template(kind), {
      attribution: kind.startsWith("ifr") ? "FAA IFR enroute charts" : "FAA VFR charts",
      cycle: cfg.chart_cycle, minZoom, maxNativeZoom: maxZoom, maxZoom: maxZoom + 3, keepBuffer: 4,
      updateWhenIdle: false, ...extra,
    } as L.TileLayerOptions);

  // A ring of tiles one deep around the view, fetched once the map
  // comes to rest, so the next pan in any direction finds its tiles
  // already in the browser's cache (they are cacheable for weeks --
  // and, with the app installed, in the service worker's). Leaflet
  // itself loads only what is on screen; on a phone over Wi-Fi to
  // this planner, each fresh tile is a round trip the eye can see.
  // Low priority where the browser understands it, one ring at a
  // time, and never beyond the layer's own zooms.
  let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  const prefetchRing = () => {
    const layer = base?.layer;
    if (!layer) return;
    const zoom = Math.round(map.getZoom());
    const zooms = zoomsOf(base!.kind);
    if (!zooms || zoom < zooms.min_zoom || zoom > zooms.max_zoom) return;
    const size = 256;
    const pixelBounds = map.getPixelBounds();
    const range = {
      minX: Math.floor(pixelBounds.min!.x / size) - 1, maxX: Math.floor(pixelBounds.max!.x / size) + 1,
      minY: Math.floor(pixelBounds.min!.y / size) - 1, maxY: Math.floor(pixelBounds.max!.y / size) + 1,
    };
    const n = 2 ** zoom;
    const urls: string[] = [];
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        if (y < 0 || y >= n) continue;
        const edge = x === range.minX || x === range.maxX || y === range.minY || y === range.maxY;
        if (!edge) continue;
        urls.push(layer.getTileUrl(Object.assign(L.point(((x % n) + n) % n, y), { z: zoom }) as L.Coords));
      }
    }
    for (const url of urls) {
      void fetch(url, { priority: "low" }).catch(() => { /* a miss now is a miss later, nothing to do */ });
    }
  };
  const schedulePrefetch = () => {
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchRing, 250);
  };
  map.on("moveend", schedulePrefetch);

  let base: { kind: string; layer: L.TileLayer } | null = null;
  const applyBase = () => {
    const kind = chartLayers.get().base;
    if (base?.kind === kind) return;
    const zooms = zoomsOf(kind) ?? zoomsOf("sec");
    if (!zooms) return;
    if (base) map.removeLayer(base.layer);
    base = { kind, layer: tileLayer(kind, zooms.min_zoom, zooms.max_zoom).addTo(map) };
  };

  // The terminal-area chart over the base: the TAC over the sectional,
  // the IFR area charts over the IFR enroute charts (each overlay kind
  // names the bases it belongs over) -- rendered the same way from the
  // FAA's own sheets, one zoom finer, and transparent (a 404 the layer
  // leaves blank) wherever none exists, so the base shows through
  // everywhere else. Drawn only while pinned (the `tac` setting: the
  // pin the map offers over a terminal area, or the info popover's
  // checkbox) or while that pin is being hovered (`preview`). Nothing
  // replaces the base on its own: past the sectional's own detail the
  // map upscales the sectional rather than swapping in a busier sheet
  // the pilot did not ask for (it used to, the way SkyVector does; a
  // pilot who knows the sectional found the TAC appearing under a
  // zoom to be the chart changing on its own). Leaflet reads a
  // layer's minZoom once, so a change of kind means a fresh layer.
  let overlay: { kind: string; layer: L.TileLayer } | null = null;
  let previewing = false;
  const overlayKind = () => cfg.chart_layers.find(l => !l.base && l.over.includes(chartLayers.get().base)) ?? null;
  const applyOverlay = () => {
    const kind = overlayKind();
    if (!kind || !(chartLayers.get().tac || previewing)) {
      if (overlay) { map.removeLayer(overlay.layer); overlay = null; }
      return;
    }
    if (overlay?.kind === kind.kind) return;
    if (overlay) map.removeLayer(overlay.layer);
    overlay = {
      kind: kind.kind,
      layer: tileLayer(kind.kind, kind.min_zoom, kind.max_zoom, { keepBuffer: 2, zIndex: 5 }).addTo(map),
    };
  };

  const apply = () => { applyBase(); applyOverlay(); };
  apply();
  const unsubscribe = chartLayers.subscribe(apply);

  return {
    get base() { return base?.kind ?? "sec"; },
    /**
     * What there is to pin where the map is: the overlay sheet under
     * the map's centre, once the map is within the overlay's own zooms
     * ("Chicago TAC", `offered`), or -- with nothing under the centre
     * -- the overlay kind's own name, for a pin that is already pinned
     * and may want unpinning from anywhere. null when the base has no
     * overlay kind at all.
     */
    overlayAt(): { label: string; offered: boolean } | null {
      const kind = overlayKind();
      if (!kind) return null;
      const { lat, lng } = map.getCenter();
      const sheet = map.getZoom() >= kind.min_zoom
        ? (kind.sheets ?? []).find(s => lng >= s.west && lng <= s.east && lat >= s.south && lat <= s.north)
        : undefined;
      return sheet ? { label: sheet.label, offered: true } : { label: kind.label, offered: false };
    },
    /** Draws the overlay while `on`, pinned or not: the pin's hover. */
    preview(on: boolean) {
      previewing = on;
      applyOverlay();
    },
    dispose() {
      unsubscribe();
      map.off("moveend", schedulePrefetch);
      if (prefetchTimer) clearTimeout(prefetchTimer);
    },
  };
}

export type Basemaps = ReturnType<typeof createBasemaps>;

/**
 * Keeps `layer` on the map only from `minZoom` in, and returns the
 * function that stops doing so (and takes the layer off). Zoomed out to
 * a whole region, a route's twenty checkpoint markers -- each a fixed
 * 24 px on screen -- pile into one blob over the departure, and a
 * labeling corridor's few hundred detections hide the chart entirely;
 * at those zooms the course line and the two endpoints are the route.
 */
export function fromZoom(map: L.Map, layer: L.Layer, minZoom: number): () => void {
  const apply = () => {
    const show = map.getZoom() >= minZoom;
    if (show && !map.hasLayer(layer)) layer.addTo(map);
    else if (!show && map.hasLayer(layer)) map.removeLayer(layer);
  };
  apply();
  map.on("zoomend", apply);
  return () => { map.off("zoomend", apply); map.removeLayer(layer); };
}

/** Where the checkpoint markers appear (RouteMap's selected
 *  checkpoints, and one level further in the scored candidates and
 *  the labeling page's detections, which are many more). Low on
 *  purpose: a phone fits a 300 nm route at zoom 6, and a pilot who
 *  opens a route expects to see its checkpoints, so only the
 *  whole-country zooms go without. */
export const MARKERS_FROM_ZOOM = 5;
export const CROWD_FROM_ZOOM = 6;

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
            // this text isn't exactly 1, and that slack renders above
            // or below the glyph asymmetrically depending on the
            // browser's own font metrics -- place-items-center alone
            // centers the *line box*, not the glyph within it, so that
            // slack still reads as the number sitting off-center
            // within the circle.
            // text-[8px], not text-xs (12px) or text-[10px] (still too
            // wide once a route's checkpoint count runs to three digits,
            // not just two) -- a circle has less usable width near its
            // edges than a square of the same size, so bold digits need
            // real headroom past their own nominal width to actually
            // stay inside the curve.
            ? "grid h-[22px] w-[22px] place-items-center text-[8px] font-bold leading-none text-white"
            : "h-4 w-4"
        }`}
        style={{ backgroundColor: fill }}
      >
        {label ?? ""}
      </div>,
    ),
  });
}

/**
 * Own ship on the chart: an arrow the size of a checkpoint dot, blue
 * with a white casing so it holds over any chart colour, turned to the
 * GPS heading (a plain dot while stationary, when there is none), and
 * the GPS's own accuracy as a faint circle under it. `update` moves it
 * and, while `follow`, keeps the map centred on it; `remove` takes it
 * off. Nothing about it is interactive: a pilot's finger over their
 * own position is panning the map, not asking for a popup.
 */
export function createOwnShip(map: L.Map) {
  const circle = L.circle([0, 0], {
    radius: 0, color: "#1d4ed8", weight: 1, opacity: 0.5, fillColor: "#3b82f6", fillOpacity: 0.08, interactive: false,
  });
  const marker = L.marker([0, 0], { icon: ownShipIcon(null), interactive: false, zIndexOffset: 1000, keyboard: false });
  let shown = false;
  let lastHeading: number | null | undefined;
  return {
    update(fix: { lat: number; lon: number; accuracyM: number; headingDeg: number | null }, follow: boolean) {
      const at: L.LatLngExpression = [fix.lat, fix.lon];
      circle.setLatLng(at).setRadius(fix.accuracyM);
      marker.setLatLng(at);
      if (fix.headingDeg !== lastHeading) {
        marker.setIcon(ownShipIcon(fix.headingDeg));
        lastHeading = fix.headingDeg;
      }
      if (!shown) {
        circle.addTo(map);
        marker.addTo(map);
        shown = true;
      }
      // A fix can arrive before the map has any view at all (own ship
      // remembered on, the page just opened, the course not yet fitted):
      // panTo on a map with no zoom left the zoom NaN and every tile
      // layer added after it asking for an infinite number of tiles.
      // Then the ship is the first view; the course's own fit follows
      // when it arrives, and following brings the ship back.
      if (follow) {
        if (hasView(map)) map.panTo(at, { animate: true, duration: 0.5 });
        else map.setView(at, OWN_SHIP_FIRST_ZOOM);
      }
    },
    remove() {
      if (!shown) return;
      map.removeLayer(marker);
      map.removeLayer(circle);
      shown = false;
    },
  };
}

/** A zoom that shows the aeroplane's surroundings, for a map whose
 *  first view is the ship rather than a route. */
const OWN_SHIP_FIRST_ZOOM = 10;

/** Whether the map has a centre and zoom yet: Leaflet has no flag for
 *  it, only a getCenter that throws until it does. */
function hasView(map: L.Map): boolean {
  try {
    map.getCenter();
    return true;
  } catch {
    return false;
  }
}

function ownShipIcon(headingDeg: number | null) {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: mountReact(
      headingDeg === null ? (
        <div className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-white bg-blue-600 shadow-[0_1px_4px_rgba(0,0,0,.45)]" />
      ) : (
        <svg
          viewBox="0 0 28 28" width={28} height={28}
          className="absolute left-0 top-0 drop-shadow-[0_1px_3px_rgba(0,0,0,.5)]"
          style={{ transform: `rotate(${headingDeg}deg)` }}
          aria-hidden
        >
          <path d="M14 3 L23 24 L14 19 L5 24 Z" fill="#2563eb" stroke="#ffffff" strokeWidth={2.5} strokeLinejoin="round" />
        </svg>
      ),
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
