import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Marker, useMap } from "react-leaflet";
import { Pin, PinOff, ZoomIn } from "lucide-react";
import IconButton from "../../components/IconButton";
import { api } from "../api/client";
import type { ReactNode } from "react";
import type { ClassBAirport, Course } from "../api/types";
import { usePreferences } from "../preferences";
import { classBIcon } from "./icons";
import { MapPopup } from "./MapPopup";
import { MapTooltip } from "./MapTooltip";

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

/** The card, hovered or tapped: what the field is doing now, what it is
 *  forecast to do, and the raw text of both for a pilot who wants to
 *  read it themselves. Tapped, `actions` puts the pin and the zoom in
 *  its top corner. */
function Details({ airport, actions }: { airport: ClassBAirport; actions?: ReactNode }) {
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
      {/* pr-7 clears Leaflet's own close button, which sits at the
          card's very corner -- the icons go beside it, not under it. */}
      <div className="flex items-start gap-2 pr-7">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{airport.ident}</span>
            <span
              className="rounded px-1.5 py-0.5 font-semibold text-white"
              style={{ backgroundColor: colourOf(category) }}
            >
              {category ?? "no report"}
            </span>
            {airport.tac && <span className="text-muted-foreground">{airport.tac}</span>}
          </div>
          <div className="text-muted-foreground">{airport.name}</div>
        </div>
        {actions}
      </div>

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
      {airport.tac && !actions && (
        <p className="pt-1 text-muted-foreground">Tap to pin the {airport.tac}.</p>
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
 * TAF. Tapping one opens the same card with the terminal area chart's
 * pin in it: a Class B is the one place a sectional is not enough, and
 * the layer picker is two taps too many when the answer is "look at
 * it".
 *
 * The pin lives here rather than at the map's corner, where it used to
 * float with nothing around it to say which airport it meant. From
 * close in, where the tiles exist, hovering a marker previews that
 * sheet and moving off puts the base chart back; the pin is what keeps
 * it drawn.
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
  const pinned = usePreferences(s => s.tac);
  // The zoom the FAA's terminal charts actually start at, from the
  // planner's own layer list rather than a number written here.
  const tacFromZoom = course.chart_layers.find(l => !l.base && l.over.includes("sec"))?.min_zoom ?? 10;
  // Which field's card is open, mirrored from Leaflet's own popupopen
  // and popupclose rather than decided here -- it is only ever read to
  // take that marker's tooltip away. A tap fires mouseover before
  // click, so without this the hover card sat behind the tapped one,
  // two cards deep; on a pointer, hovering a marker whose card is
  // already open did the same.
  const [carded, setCarded] = useState<string | null>(null);
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
            // Tapping opens the card, which carries the pin. The pin
            // used to float at the map's top-right corner, away from
            // the airport it applied to; it belongs with the field's
            // own information.
            // Leaflet opens the card itself; this only takes the hover
            // preview down so the card is read against the base chart.
            click: () => onPreview(false),
            popupopen: () => setCarded(airport.ident),
            popupclose: () => setCarded(c => (c === airport.ident ? null : c)),
          }}
        >
          {/* A tooltip rather than a popup: it follows the pointer and
              needs no dismissing, which is what "hover to look" means.
              Sticky so it stays while the pointer is anywhere on the
              marker. */}
          {carded !== airport.ident && (
            <MapTooltip>
              <Details airport={airport} />
            </MapTooltip>
          )}
          {/* A child of the marker, so Leaflet opens it on a click and
              closes it on its own X -- there is no open-state of ours
              to keep in step with it. Dismissal is `MapPopup`'s, which
              is Leaflet's: a tap on the chart closes it. The pin inside
              it is unaffected, because a click in a popup never reaches
              the map -- see MapPopup's own note. */}
          <MapPopup>
            <Details
              airport={airport}
              actions={airport.tac && (
                // Icons rather than worded buttons: the card is mostly
                // raw METAR and TAF, and two labelled buttons under it
                // pushed the weather off a phone screen. Each names
                // itself in a tooltip and in its accessible name.
                <div className="flex shrink-0 items-center">
                  <IconButton
                    label={pinned ? "Unpin the terminal area chart" : `Pin the ${airport.tac}`}
                    aria-pressed={pinned}
                    variant={pinned ? "secondary" : "ghost"}
                    data-testid="class-b-pin"
                    // Pinning from a route view would draw nothing --
                    // the FAA publishes terminal sheets from zoom 10
                    // and a whole route fits the screen at about 6 --
                    // so a pin that has nothing to show goes there
                    // first. Unpinning leaves the map where it is.
                    onClick={() => {
                      if (!pinned) map.flyTo([airport.lat, airport.lon], Math.max(map.getZoom(), tacFromZoom));
                      pinTac(!pinned);
                    }}
                  >
                    {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  </IconButton>
                  <IconButton
                    label={`Zoom to ${airport.ident}`}
                    data-testid="class-b-zoom"
                    onClick={() => map.flyTo([airport.lat, airport.lon], Math.max(map.getZoom(), tacFromZoom))}
                  >
                    <ZoomIn className="size-4" />
                  </IconButton>
                </div>
              )}
            />
          </MapPopup>
        </Marker>
      ))}
    </>
  );
}
