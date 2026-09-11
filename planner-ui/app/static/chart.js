/**
 * The chart itself: basemaps, the course line, and the selection ring.
 *
 * Both pages draw the same route on the same sectional and had grown
 * their own copies of all of it, which drifted -- one ended up calling
 * the setup initBase and the other initBasemaps, with a toggle each, so
 * a fix to one never reached the other. Everything here takes the map as
 * an argument and keeps no state of its own, so there is one
 * implementation and the pages own their own state.
 *
 * Loaded as a plain script rather than a module: it has to run before
 * the inline page script that calls it, and a module would not.
 */
window.Chart = (function () {
  "use strict";

  // Sectional tiles stop at zoom 12 and 404 below 8, so the chart alone
  // can never frame a long leg -- OpenStreetMap sits underneath for
  // that, and shows through wherever the chart has nothing.
  function basemaps(map, cfg) {
    const underlay = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19, opacity: 0.85,
    }).addTo(map);

    const layers = {
      // maxNativeZoom upscales chart tiles past their real limit rather
      // than showing blanks when the map is zoomed in.
      faa: L.tileLayer(cfg.tile_url, {
        attribution: "FAA Aeronautical Information Services",
        maxNativeZoom: cfg.max_zoom, maxZoom: 18, minZoom: cfg.min_zoom,
      }),
      osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
      }),
    };

    const state = { active: "faa", min: cfg.min_zoom || 8 };
    layers[state.active].addTo(map);

    function notice() {
      const tag = document.getElementById("basemap");
      if (!tag) return;
      const below = map.getZoom() < state.min;
      tag.textContent = state.active === "faa"
        ? (below ? "below chart zoom — OSM" : "FAA sectional")
        : "OpenStreetMap";
      // A blank chart and a chart with nothing on it look identical, and
      // only one of them is a problem.
      tag.style.color = (below && state.active === "faa") ? "var(--warn)" : "";
    }

    function toggle() {
      map.removeLayer(layers[state.active]);
      state.active = state.active === "faa" ? "osm" : "faa";
      layers[state.active].addTo(map);
      notice();
    }

    map.on("zoomend", notice);
    notice();
    return { layers, underlay, toggle, notice, state };
  }

  /**
   * The course, as three strokes: a white casing, an orange-red core,
   * and a wide invisible line to hover.
   *
   * A sectional already uses blue, magenta, black, brown, yellow and
   * green, so no single stroke wins on colour -- the casing is what
   * makes it read, the same way the chart draws its own linework. The
   * hit line exists because an SVG stroke is only hoverable where it is
   * painted, and a 3.5 px dashed line is mostly not painted.
   */
  function courseLine(map, { line, tooltip, onClick }) {
    const hit = L.polyline(line, {
      color: "#000", weight: 18, opacity: 0, className: "course-hit",
      interactive: true, bubblingMouseEvents: !onClick, lineCap: "butt",
    });
    if (tooltip) hit.bindTooltip(tooltip, { sticky: true });
    if (onClick) hit.on("click", onClick);

    return L.layerGroup([
      L.polyline(line, { color: "#ffffff", weight: 8, opacity: 0.85, interactive: false }),
      L.polyline(line, {
        color: "#ff3b00", weight: 3.5, opacity: 1, dashArray: "11,7", interactive: false,
      }),
      hit,
    ]).addTo(map);
  }

  /**
   * The ring around the selected point: cased on both sides so it holds
   * over black roads and blank paper alike, and pulsing, because on a
   * chart full of circles the one that moves is the one the eye finds.
   */
  function halo(map, point, html) {
    const ring = L.featureGroup([
      L.circleMarker([point.lat, point.lon], {
        radius: 19, color: "rgba(10,20,28,.55)", weight: 9, fill: false, interactive: false,
      }),
      L.circleMarker([point.lat, point.lon], {
        radius: 19, color: "#ffffff", weight: 6, fill: false, interactive: false,
      }),
      L.circleMarker([point.lat, point.lon], {
        radius: 19, color: "#ff3b00", weight: 3, fill: false, interactive: false,
        className: "halo-pulse",
      }),
    ]).addTo(map);
    ring.bringToFront();

    if (html) {
      // Pinned above the ring and travelling with it: a label in a corner
      // describing a ring elsewhere on the chart is a lookup nobody
      // should have to do.
      ring.getLayers()[2].bindTooltip(html, {
        permanent: true, direction: "top", offset: [0, -22],
        className: "selinfo-tip", opacity: 1, interactive: false,
      }).openTooltip();
    }
    return ring;
  }

  /**
   * A marker with three edges: a white casing to separate it from dark
   * linework, a dark hairline outside that so it still separates from
   * pale paper, and a shadow to lift it off both. One edge is never
   * enough on a chart this busy.
   */
  function dot(fill, label) {
    const inner = label === undefined
      ? `width:16px;height:16px`
      : `width:22px;height:22px;display:grid;place-items:center;font:700 12px system-ui;color:#fff`;
    return L.divIcon({
      className: "",
      iconSize: label === undefined ? [20, 20] : [28, 28],
      iconAnchor: label === undefined ? [10, 10] : [14, 14],
      html: `<div style="${inner};background:${fill};border-radius:50%;
        border:2.5px solid #fff;outline:1px solid rgba(10,20,28,.55);
        box-shadow:0 1px 4px rgba(0,0,0,.45)">${label === undefined ? "" : label}</div>`,
    });
  }

  /** The airport pill: sized to its ident, centred in a wider icon box. */
  function endLabel(ident) {
    return L.divIcon({
      className: "end-label", iconSize: [90, 20], iconAnchor: [45, 10],
      html: `<span>${ident}</span>`,
    });
  }

  return { basemaps, courseLine, halo, dot, endLabel };
})();
