import { useQuery } from "@tanstack/react-query";
import { Marker, useMap } from "react-leaflet";
import { classBQuery } from "../queryClient";
import type { ChartInfo } from "../api/types";
import { usePreferences } from "../preferences";
import { colourOf } from "./flightCategory";
import { airportIcon } from "./icons";
import { MapTooltip } from "./MapTooltip";
import { chartPair, sheetAt } from "./tiles";
import { centreClear } from "./clear";
import type L from "leaflet";

/** A pointer that hovers: a name shows under it. */
const hovers = typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

/**
 * Every Class B airport, on the map, at every zoom: a pill each, its
 * ident in the colour of what the field is reporting right now, so a
 * whole route's worth of "can I get in there today" reads at a glance.
 * A tap opens the field's card in the panel on the planner (PlaceCard,
 * `onSelectPlace`), the one every airport opens, with its weather,
 * radio and runways and Fly Here; on the training map, which has no
 * card, it goes to the field at the zoom its terminal chart starts at.
 * Close in, where the tiles exist, hovering one previews its terminal
 * sheet. It had a card of its own, the METAR and the TAF raw, and a pin
 * for its terminal chart, which the settings' TAC is now.
 *
 * One request for all thirty rather than one per marker: the planner
 * has the airspace shapefile and both national weather caches in memory
 * already, so the whole set costs about what one would. Off by default
 * (the settings' Class B, Weather): useful on a cross-country that
 * passes near one, clutter on a route that does not.
 */
export function ClassBLayer({ chart, endpoints, onPreview, onSelectPlace }: {
  chart: ChartInfo;
  /** The route's two airports, which draw their own chips. */
  endpoints: string[];
  onPreview: (on: boolean) => void;
  onSelectPlace?: (ident: string) => void;
}) {
  const map = useMap();
  const show = usePreferences(s => s.classB);
  const base = usePreferences(s => s.base);
  // The overlay over the chart being drawn, and the zoom its sheets start
  // at, from the planner's own layer list -- the same pair the map draws.
  const { overlay } = chartPair(chart.chart_layers, base);
  const overlayFromZoom = overlay?.min_zoom ?? 10;
  const { data } = useQuery({ ...classBQuery, enabled: show });

  if (!show || !data) return null;
  // The route's own departure and destination draw themselves (RouteMap),
  // with this airport's forecast when it is one of these; drawing it here
  // too stacked two chips on one field, each answering a tap differently.
  return (
    <>
      {data.filter(airport => !endpoints.includes(airport.ident)).map(airport => {
        const sheet = sheetAt(overlay, airport.lat, airport.lon);
        return (
          <Marker
            key={airport.ident}
            position={[airport.lat, airport.lon]}
            icon={airportIcon(colourOf(airport.flight_category), airport.ident, { classB: true })}
            // Over the route's own airports' chips (RouteMap's 500), as over
            // the checkpoints: drawn only while the pilot has asked for the
            // Class B fields, and the one in the way is the one to see --
            // KORD's lay under C81's, out at the region's zoom.
            zIndexOffset={700}
            eventHandlers={{
              // Close in, where the tiles exist, hovering previews the
              // sheet. mouseout rather than a timer: a marker that
              // scrolls out from under the pointer still fires it, where
              // a timer would leave the chart drawn with nothing on
              // screen to say why.
              mouseover: () => { if (sheet) onPreview(true); },
              mouseout: () => onPreview(false),
              click: () => {
                onPreview(false);
                if (onSelectPlace) onSelectPlace(airport.ident);
                else flyClear(map, [airport.lat, airport.lon], Math.max(map.getZoom(), overlayFromZoom));
              },
            }}
          >
            {hovers && <MapTooltip>{airport.ident} · {airport.name} · {airport.flight_category ?? "no report"}</MapTooltip>}
          </Marker>
        );
      })}
    </>
  );
}

/** The map flown to a field, clear of the panel over it. */
function flyClear(map: L.Map, point: [number, number], zoom: number) {
  map.flyTo(centreClear(map, point, zoom), zoom);
}
