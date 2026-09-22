import { useQuery } from "@tanstack/react-query";
import { Marker, Tooltip, useMap } from "react-leaflet";
import { api } from "../api/client";
import type { ClassBAirport, Course } from "../api/types";
import { usePreferences } from "../preferences";
import { classBIcon } from "./icons";

/** The FAA's own categories, in the colours a pilot already reads them
 *  in: green good, blue marginal, red instrument, magenta worse than
 *  that. Grey where the field filed no report -- which is not "fine",
 *  it is "unknown", and it must not look like the green one. */
const CATEGORY_COLOURS: Record<string, string> = {
  VFR: "#1a7f37",
  MVFR: "#1f6feb",
  IFR: "#b3261e",
  LIFR: "#a371f7",
};
const UNKNOWN_COLOUR = "#8fa3b0";

function colourOf(category: string | null): string {
  return (category && CATEGORY_COLOURS[category]) || UNKNOWN_COLOUR;
}

function feet(value: number | null): string {
  return value === null ? "—" : `${Math.round(value).toLocaleString()} ft`;
}

function miles(value: number | null): string {
  return value === null ? "—" : `${value} sm`;
}

/** The hover card: what it is doing now, what it is forecast to do, and
 *  the raw text of both for a pilot who wants to read it themselves. */
function Details({ airport }: { airport: ClassBAirport }) {
  const category = airport.flight_category;
  return (
    // whitespace-normal: Leaflet's own stylesheet sets
    // `white-space: nowrap` on every tooltip, which is right for the
    // course line's one-line label and wrong here -- a raw METAR ran
    // straight off the card's right edge. white-space inherits, so
    // setting it on this root is enough.
    // A width, not just a maximum: a Leaflet tooltip shrink-wraps its
    // content, so once the raw METAR was allowed to wrap the card
    // collapsed to a narrow column and wrapped it every four words.
    // Capped against the viewport so a phone still fits it.
    <div className="w-[min(22rem,72vw)] space-y-1.5 text-xs whitespace-normal">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{airport.ident}</span>
        <span
          className="rounded px-1.5 py-0.5 font-semibold text-white"
          style={{ backgroundColor: colourOf(category) }}
        >
          {category ?? "no report"}
        </span>
        {airport.tac && <span className="ml-auto text-muted-foreground">{airport.tac}</span>}
      </div>
      <div className="text-muted-foreground">{airport.name}</div>

      <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-0.5 pt-1">
        <span className="text-muted-foreground" />
        <span className="font-semibold">Now</span>
        <span className="font-semibold">Forecast</span>
        <span className="text-muted-foreground">Ceiling</span>
        <span className="tabular-nums">{feet(airport.ceiling_ft)}</span>
        <span className="tabular-nums">{feet(airport.taf_ceiling_ft)}</span>
        <span className="text-muted-foreground">Visibility</span>
        <span className="tabular-nums">{miles(airport.visibility_sm)}</span>
        <span className="tabular-nums">{miles(airport.taf_visibility_sm)}</span>
      </div>

      {airport.metar && <p className="pt-1 font-mono break-words">{airport.metar}</p>}
      {airport.taf && <p className="font-mono break-words text-muted-foreground">{airport.taf}</p>}
      {airport.tac && (
        <p className="pt-1 text-muted-foreground">Tap to open the {airport.tac} over this airport.</p>
      )}
    </div>
  );
}

/**
 * Every Class B airport, on the map.
 *
 * A marker each, coloured by what the field is reporting right now, so
 * a whole route's worth of "can I get in there today" reads at a
 * glance without opening anything. Hovering one shows the METAR and the
 * TAF. Tapping one goes there and puts its terminal area chart up: a
 * Class B is the one place a sectional is not enough, and the layer
 * picker is two taps too many when the answer is "look at it".
 *
 * Tapping rather than hovering, because the FAA only publishes terminal
 * charts from zoom 10 and a whole route fits the screen at about 6 --
 * there are simply no TAC tiles to draw from a route view, so a hover
 * that promised one would do nothing. From close in, where the tiles do
 * exist, hovering previews it and moving off puts the chart back.
 *
 * One request for all thirty rather than one per marker: the planner
 * has the airspace shapefile and both national weather caches in memory
 * already, so the whole set costs about what one would.
 *
 * Off by default, and behind the layers popover. The markers are useful
 * on a cross-country that passes near one and clutter on a route that
 * does not.
 */
export function ClassBLayer({ course, onPreview }: { course: Course; onPreview: (on: boolean) => void }) {
  const map = useMap();
  const show = usePreferences(s => s.classB);
  const pinTac = usePreferences(s => s.setTac);
  // The zoom the FAA's terminal charts actually start at, from the
  // planner's own layer list rather than a number written here.
  const tacFromZoom = course.chart_layers.find(l => !l.base && l.over.includes("sec"))?.min_zoom ?? 10;
  const { data } = useQuery({
    queryKey: ["classB"],
    queryFn: api.classB,
    enabled: show,
    // The airspace never moves and the weather is held for minutes on
    // the planner's own side; refetching per pan would be asking the
    // same question of the same cache.
    staleTime: 5 * 60_000,
    meta: { silent: true },
  });

  if (!show || !data) return null;
  return (
    <>
      {data.map(airport => (
        <Marker
          key={airport.ident}
          position={[airport.lat, airport.lon]}
          icon={classBIcon(colourOf(airport.flight_category), airport.ident)}
          eventHandlers={{
            // Close in, where the tiles exist, hovering previews the
            // sheet. mouseout rather than a timer: a marker that
            // scrolls out from under the pointer still fires it, where
            // a timer would leave the chart drawn with nothing on
            // screen to say why.
            mouseover: () => { if (airport.tac) onPreview(true); },
            mouseout: () => onPreview(false),
            // Tapping is the one that always works: go there, at a zoom
            // the sheet is published at, and pin it.
            click: () => {
              if (!airport.tac) return;
              onPreview(false);
              pinTac(true);
              map.flyTo([airport.lat, airport.lon], Math.max(map.getZoom(), tacFromZoom));
            },
          }}
        >
          {/* A tooltip rather than a popup: it follows the pointer and
              needs no dismissing, which is what "hover to look" means.
              Sticky so it stays while the pointer is anywhere on the
              marker. */}
          <Tooltip direction="top" offset={[0, -10]} opacity={1} sticky>
            <Details airport={airport} />
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
