import { useQuery } from "@tanstack/react-query";
import { Marker, useMap } from "react-leaflet";
import { Pin, PinOff } from "lucide-react";
import IconButton from "../../components/IconButton";
import { api } from "../api/client";
import type { ReactNode } from "react";
import type { ClassBAirport, Course } from "../api/types";
import { usePreferences } from "../preferences";
import { AirportCard } from "./AirportCard";
import { colourOf } from "./flightCategory";
import { classBIcon } from "./icons";
import { MapPopup } from "./MapPopup";
import { MapTooltip } from "./MapTooltip";
import { useCardedMarker } from "./useCardedMarker";

/** The card, hovered or tapped: what the field is doing now, what it is
 *  forecast to do, and the raw text of both for a pilot who wants to
 *  read it themselves. Tapped, `actions` puts the pin and the zoom in
 *  its top corner. */
function Details({ airport, leading }: { airport: ClassBAirport; leading?: ReactNode }) {
  return (
    <AirportCard
      leading={leading}
      ident={airport.ident}
      // No sheet name beside the title: the pin at the head's left edge
      // is what the terminal chart is, and it names the sheet in its
      // own tooltip and accessible name.
      name={airport.name}
      // Every weather field is optional in the planner's schema: a
      // field with no report is absent, and absent is shown as absent.
      weather={{
        category: airport.flight_category ?? null,
        ceilingFt: airport.ceiling_ft ?? null,
        visibilitySm: airport.visibility_sm ?? null,
        raw: airport.metar ?? null,
        forecast: {
          ceilingFt: airport.taf_ceiling_ft ?? null,
          visibilitySm: airport.taf_visibility_sm ?? null,
          raw: airport.taf ?? null,
        },
      }}
    >
      {airport.tac && !leading && (
        <p className="pt-1 text-muted-foreground">Tap to go there, and to pin the {airport.tac}.</p>
      )}
    </AirportCard>
  );
}

/**
 * Every Class B airport, on the map.
 *
 * A marker each, coloured by what the field is reporting right now, so
 * a whole route's worth of "can I get in there today" reads at a
 * glance without opening anything. Hovering one shows the METAR and the
 * TAF. Tapping one goes to the field -- every marker on either map
 * answers a tap the same way -- and opens the same card with the
 * terminal area chart's pin in it: a Class B is the one place a sectional is not enough, and
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
  const { carded, cardEvents } = useCardedMarker<string>();
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
            // Not while this field's own card is open: the tap that
            // opened it brings the map to the field, which leaves the
            // marker under the pointer -- and a hover preview starting
            // up again there would draw the terminal chart under the
            // card the pilot is trying to read. The card is read
            // against the base chart; the pin is what keeps a sheet
            // drawn.
            mouseover: () => { if (airport.tac && carded !== airport.ident) onPreview(true); },
            mouseout: () => onPreview(false),
            // Tapping opens the card, which carries the pin. The pin
            // used to float at the map's top-right corner, away from
            // the airport it applied to; it belongs with the field's
            // own information.
            // A tap on any marker on either map goes to it, and opens
            // whatever it has to say. Leaflet opens the card itself;
            // this takes the hover preview down, so the card is read
            // against the base chart, and brings the map to the field
            // at the zoom its terminal chart starts at.
            click: () => {
              onPreview(false);
              map.flyTo([airport.lat, airport.lon], Math.max(map.getZoom(), tacFromZoom));
            },
            ...cardEvents(airport.ident),
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
              leading={airport.tac && (
                // An icon rather than a worded button: the card is
                // mostly raw METAR and TAF, and a labelled button under
                // it pushed the weather off a phone screen. It names
                // itself in a tooltip and in its accessible name. The
                // zoom that used to sit beside it is gone: the tap that
                // opened this card already went to the field.
                <div className="flex shrink-0 items-start">
                  <IconButton
                    label={pinned ? "Unpin the terminal area chart" : `Pin the ${airport.tac}`}
                    size="icon-sm"
                    aria-pressed={pinned}
                    variant={pinned ? "secondary" : "outline"}
                    className="rounded-full"
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
                </div>
              )}
            />
          </MapPopup>
        </Marker>
      ))}
    </>
  );
}
