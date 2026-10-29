import { TileLayer } from "react-leaflet";

/** The USGS's National Map hydrography basemap: the land white and the
 *  water blue, the countries' borders and names, Canada and Mexico and the
 *  oceans round the charts included -- a public-domain work, from the
 *  server the imagery overlay already uses (OverlayTiles), no
 *  OpenStreetMap (the charts' own rule). Its tiles are z/y/x. */
const URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}";
/** As far in as it is drawn: past it the map is a region of the charts,
 *  their edge at most a border or a coast, and a pan in close asked for
 *  tiles no one sees under the chart. */
const LAST_ZOOM = 9;

/**
 * A plain land-and-water map under the FAA's charts, where they have no
 * tile: the sea, Canada and Mexico round the lower 48 as the map opens on
 * the whole country (ownShip's COUNTRY_ZOOM), which showed the page's grey
 * in bands over and under the sectionals on a phone, as Maps never shows
 * an empty tile (the design review, 2026-10-28, the owner's "I want all").
 * Fitting the opening to the charts instead took a phone in to a region
 * (zoom 6) where it opens on the country. Under the chart's own layers
 * (ChartTiles' underlay at 0), dimmed with them at night (chart-tiles).
 * No credit on the map: a public-domain work, and the owner's rule is the
 * credits a licence requires alone.
 */
export function LandWaterTiles() {
  return <TileLayer url={URL} maxNativeZoom={LAST_ZOOM} maxZoom={LAST_ZOOM} zIndex={-1} className="chart-tiles" keepBuffer={1} />;
}
