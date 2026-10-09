import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Lightbulb, Loader2, MapPin, MapPinPlus, Phone, Radio, Star } from "lucide-react";
import DirectToIcon from "../../../components/DirectToIcon";
import { cn } from "cn";
import { useKeptAirport, usePreferences } from "../../../lib/preferences";
import { useOwnShip } from "../../../lib/map/ownShip";
import RoundButton from "../../../components/RoundButton";
import { FILLS_HALF, GLASS_BUTTON } from "../../../components/mapChrome";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { LINE_TAB } from "../../../components/lineTabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Button } from "../../../components/ui/button";
import { ApiError, api } from "../../../lib/api/client";
import type { AirportPin, AirportPlace, ClassBAirport } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { bearingDeg, distanceNm, type LatLon } from "../../../lib/geo";
import { chipColourOf } from "../../../lib/map/flightCategory";
import { inkOn } from "../../../lib/scoreScale";
import { feet, miles } from "../../../lib/units";
import { RunwayRow } from "./RunwayRow";
import { PublicationRows } from "./PublicationRows";
import { TEXT } from "../../../lib/text";

/** "18 nm NE", from wherever the card is measured from. */
function away(from: LatLon, to: LatLon): string {
  const nm = distanceNm(from, to);
  return nm < 0.5 ? "here" : `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm ${compassPoint(bearingDeg(from, to))}`;
}

/** The line under the name: the ident, the airspace, the tower or its
 *  CTAF, and how far it is -- "KDLH · Class C · 18 nm NE". */
function subtitleOf(place: AirportPlace, from: { point: LatLon; name: string | null } | null): ReactNode {
  const ctaf = place.frequencies.find(f => f.type === "CTAF" || f.type === "UNIC");
  const what = [
    place.ident,
    // A field the armed services own (the FAA's airport file): one most
    // pilots may not land at without the service's permission, or a civil
    // airport sharing it.
    place.military === "military" ? "Military, permission required" : place.military === "joint" ? "Joint use" : null,
    place.airspace_class ? `Class ${place.airspace_class}` : null,
    place.towered ? "Towered" : ctaf?.frequency_mhz ? `CTAF ${ctaf.frequency_mhz.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}` : "Non-towered",
  ].filter(Boolean).join(" · ");
  // Its elevation on a line of its own under that, at the pilot's ask,
  // where it was the Runways tab's first row; how far it is after it.
  const where = [
    place.elevation_ft != null ? `Elevation ${feet(place.elevation_ft)}` : null,
    from ? (from.name ? `${away(from.point, place)} of ${from.name}` : away(from.point, place)) : null,
  ].filter(Boolean).join(" · ");
  return where ? <>{what}<br />{where}</> : what;
}

/** An airport's name and weather from whatever the map has already
 *  asked for it in: the fields in view, the route's, the Class B ones. */
function knownOf(queryClient: QueryClient, ident: string): { name: string; category: string | null } | null {
  for (const key of ["airportsInView", "airportsReporting", "classB"]) {
    for (const [, pins] of queryClient.getQueriesData<(AirportPin | ClassBAirport)[]>({ queryKey: [key] })) {
      const hit = pins?.find(p => p.ident === ident);
      if (hit) return { name: hit.name, category: hit.flight_category ?? null };
    }
  }
  return null;
}

type CardTab = "diagram" | "weather" | "radio" | "runways";
/** The card's tabs, in the pilot's order. "Freq." as on its tile. */
const CARD_TABS: { value: CardTab; label: string }[] = [
  { value: "diagram", label: "Diagram" },
  { value: "weather", label: "Weather" },
  { value: "radio", label: "Freq." },
  { value: "runways", label: "Runways" },
];

/** The field in Maps -- Apple's, which a phone opens in its Maps app --
 *  by its street address where the FAA lists one, so Maps names the
 *  road a driver is taken to, and by where it is otherwise; its name the
 *  pin's either way. */
function mapsLink(place: AirportPlace): string {
  const where = place.address
    ? `address=${encodeURIComponent(place.address)}`
    : `ll=${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
  return `https://maps.apple.com/?q=${encodeURIComponent(place.name)}&${where}`;
}

/** A tile of the card's action row: its glyph over its word, as Maps
 *  draws its own -- Fly Here filled in the tint, the rest panes of glass
 *  in the text's colour, as the gear and the route's close are, at the
 *  pilot's ask (they were the tint on grey). Maps' size, a 24-point glyph
 *  in a tile 70 tall: the card fills more of the panel's one half height. */
function Action({ icon, label, spoken, filled, busy, disabled, onClick, href, testId }: {
  icon: ReactNode; label: string; filled?: boolean; onClick?: () => void; testId: string;
  /** Where it goes instead, outside the app: a phone number to call, the
   *  field in Maps. */
  href?: string;
  /** The whole word, where the tile shows it cut short. */
  spoken?: string;
  /** Until the card's answer is in: the tile in its place, not yet live. */
  disabled?: boolean;
  /** Tapped, and its work under way: a spinner in place of its symbol,
   *  which turns on the compositor while the page is busy drawing what
   *  the tap asked for. */
  busy?: boolean;
}) {
  const look = cn("h-auto flex-col gap-1 rounded-xl py-3 whitespace-normal [&_svg:not([class*='size-'])]:size-6", !filled && GLASS_BUTTON);
  const face = (
    <>
      {busy ? <Loader2 className="size-6 animate-spin" aria-hidden="true" /> : icon}
      {/* On two lines where it needs them, at the pilot's ask, rather
          than past the tile's edge. */}
      <span className={cn("text-center leading-tight font-semibold", TEXT.note)}>{label}</span>
    </>
  );
  // A link where it leaves the app, the stock button's look on it.
  if (href && !disabled) {
    return (
      <Button asChild variant={filled ? "default" : "secondary"} className={look}>
        <a href={href} target={href.startsWith("tel:") ? undefined : "_blank"} rel="noreferrer" data-testid={testId} aria-label={spoken}>{face}</a>
      </Button>
    );
  }
  return (
    <Button
      type="button" variant={filled ? "default" : "secondary"} onClick={onClick} disabled={disabled}
      data-testid={testId} aria-label={spoken} aria-busy={busy || undefined} className={look}
    >
      {face}
    </Button>
  );
}

/**
 * An airport's card in the panel, as a place's is in Maps: its name and
 * what kind of field it is, the weather there now as the colour pilots
 * read it in, and three things to do -- fly there, the weather, the
 * radio, and with a route open a fourth, land there on the way -- over
 * the details: the report itself, the frequencies, the
 * runways. Opened by a tap on the airport on the chart (AirportsLayer),
 * and held in the address (`?place=KDLH`), so a link lands on it.
 *
 * How far it is is from the pilot's own position when it is known, and
 * from the route's departure otherwise.
 */
export default function PlaceCard({ ident, from, onClose, onFlyHere, onAddStop, onExpand }: {
  ident: string;
  /** What the distance is measured from where own ship has no fix: the
   *  route's departure. */
  from: { point: LatLon; name: string | null } | null;
  onClose: () => void;
  onFlyHere: (place: AirportPlace) => void;
  /** Add Stop: the field the route's next stop, before its destination
   *  (or the end a half route lacks, or the first point of a new one);
   *  none where it is in the route already. */
  onAddStop?: (place: AirportPlace) => void;
  /** The panel all the way up, for a section scrolled to. */
  onExpand: () => void;
}) {
  const { data: place, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["airport", ident], queryFn: () => api.airport(ident), staleTime: 5 * 60_000,
  });
  // What the map knows of it already -- its name and its weather's
  // colour, from the chip that was tapped (AirportsLayer, ClassBLayer) --
  // at once: the card read "Looking the airport up…" until its own
  // answer came, a second or more on a phone while the chart's tiles
  // loaded.
  const known = knownOf(useQueryClient(), ident);
  // And what this browser keeps of it -- Home, a Favorite, one picked
  // lately -- its whole name: a card opened from a Favorite, or from the
  // address on a page just loaded, read its ident alone over an empty
  // card while its answer queued behind the page's first requests.
  const kept = useKeptAirport(ident);
  // How far, from own ship's fix as it is, where there is one: the card's
  // own, drawn again at each, where the page under it is not (its
  // useOwnShipNear) -- tenths of a mile from a fix a hundredth of a degree
  // old would be wrong.
  const ship = useOwnShip(o => (o.enabled ? o.fix : null));
  const measured = ship ? { point: { lat: ship.lat, lon: ship.lon }, name: null } : from;
  const tabsRef = useRef<HTMLDivElement>(null);
  // Fly Here tapped: the tile says so at once, a frame before the route
  // is drawn (PlanWorkspace's flyHere), which is a moment of a phone's --
  // the tap looked lost under it, at the pilot's ask for no lag. The card
  // goes with the route; it is a new card (keyed by its ident) after.
  const [flying, setFlying] = useState(false);
  // The card's four tabs under its tiles, at the pilot's ask, where its
  // sections ran on one under another: the diagram first where the field
  // has one, the weather first where it has none (most small fields).
  const [picked, setPicked] = useState<CardTab | null>(null);
  const tab: CardTab = picked ?? (place?.airport_diagram_url || place?.airport_diagram_cycle ? "diagram" : "weather");
  // A tab picked -- or Weather or Freq. on the tiles -- takes the panel all
  // the way up, as the route's tabs do; the bar back in sight if the card
  // was scrolled past it, once the panel is up and the name and tiles
  // have closed up to their own height.
  const open = (next: CardTab) => {
    setPicked(next);
    const up = tabsRef.current?.closest("[data-panel]")?.getAttribute("data-panel") === "full";
    onExpand();
    window.setTimeout(() => tabsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), up ? 50 : 520);
  };
  const metar = place?.metar ?? null;
  const weather = place
    ? { status: place.weather_unavailable ? "unavailable" : metar ? "reported" : "no-report", category: metar?.flight_category ?? null }
    : known && { status: known.category ? "reported" : "no-report", category: known.category };
  return (
    <PanelCard testId="place-card">
      <Tabs value={tab} onValueChange={next => setPicked(next as CardTab)} className="gap-0">
      {/* The name, the actions and the tabs' bar the panel's half, less the
          card's own top: a tab's content starts under it, out of sight
          there (FILLS_HALF). */}
      <div className={cn("min-h-[calc(var(--half-body,0px)_-_var(--corner-inset,0.75rem))]", FILLS_HALF)}>
        <CardHead
          name={place?.name ?? known?.name ?? kept?.name ?? ident} nameTestId="place-name"
          // Not found only where the planner said so: a planner out of
          // reach for a moment (restarted) read "not found" for KBUR.
          line={place ? subtitleOf(place, measured)
            : error ? `${ident} · ${error instanceof ApiError && error.status === 404 ? "not found" : "could not be looked up"}`
              : `${ident} · …`}
          onClose={onClose} closeTestId="place-close"
        >
          {weather && (
            <span
              // The words in whichever ink reads on the colour (inkOn), as
              // the map's chips are: white on a field's no-report grey was
              // 2.6:1.
              className={cn("mt-1 shrink-0 rounded-md px-2 py-0.5 font-bold tracking-wide", TEXT.note)}
              style={{ backgroundColor: chipColourOf(weather), color: inkOn(chipColourOf(weather)) }}
              data-testid="place-category"
            >
              {weather.category ?? (place?.weather_unavailable ? "Unavailable" : "No report")}
            </span>
          )}
          {place && <FavoriteButton place={place} />}
        </CardHead>
        {/* In their places from the first frame, live once the answer is
            in: the card stood empty below its name until then. */}
        {(place || !error) && (
          <div className={cn("mt-3 grid gap-2", onAddStop ? "grid-cols-4" : "grid-cols-3")}>
            {/* Fly Here is the Direct-To, and wears its symbol; Add Stop
                beside it, at the pilot's ask, makes the field the route's
                next stop. */}
            <Action
              icon={<DirectToIcon />} label="Fly Here" filled busy={flying} disabled={!place} testId="fly-here"
              onClick={() => { if (place) { setFlying(true); onFlyHere(place); } }}
            />
            {onAddStop && (
              <Action icon={<MapPinPlus />} label="Add Stop" disabled={!place} onClick={() => { if (place) onAddStop(place); }} testId="place-add-stop" />
            )}
            {/* Call and Address, at the pilot's ask, where Weather and Freq.
                were, which are tabs now: the field's own phone and where it
                is on the ground, from the FAA's airport file -- greyed for a
                field it lists no phone for. */}
            <Action
              icon={<Phone />} label="Call" disabled={!place?.phone}
              href={place?.phone ? `tel:${place.phone}` : undefined}
              spoken={place?.phone ? `Call ${place.phone}` : "Call: no phone listed"} testId="place-call"
            />
            <Action
              icon={<MapPin />} label="Address" disabled={!place}
              href={place ? mapsLink(place) : undefined}
              spoken={place?.address ? `${place.address}, in Maps` : "Where it is, in Maps"} testId="place-address"
            />
          </div>
        )}
        {place && (
          // The stock line tabs, the consoles' (ConsoleTabs): words over a
          // hairline, the chosen one in the tint, a 44-point bar to a
          // finger.
          <TabsList
            ref={tabsRef} variant="line"
            className="mt-3 w-full scroll-mt-3 gap-0 border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-9 pointer-coarse:group-data-[orientation=horizontal]/tabs:h-11"
          >
            {CARD_TABS.map(t => (
              // Tapped, the panel comes all the way up, the tab already
              // picked as well (onValueChange is not called for it).
              <TabsTrigger
                key={t.value} value={t.value} className={LINE_TAB} onClick={() => open(t.value)} data-testid={`place-tab-${t.value}`}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
      </div>

      {place && (
        <>
          <TabsContent value="diagram" className="pt-4">
            <ListGroup>
              {!place.airport_diagram_url && !place.airport_diagram_cycle && (
                // Drawn by the FAA for the fields with a tower or a busy
                // ramp; most small fields have none.
                <ListRow title={<span className="text-muted-foreground">The FAA publishes no airport diagram for this field</span>} />
              )}
              {(place.airport_diagram_url || place.airport_diagram_cycle || place.chart_supplement_url) && (
                <PublicationRows
                  ident={place.ident} diagram={place.airport_diagram_url}
                  diagramCycle={place.airport_diagram_cycle} supplement={place.chart_supplement_url}
                />
              )}
            </ListGroup>
          </TabsContent>

          <TabsContent value="weather" className="pt-4">
            <ListGroup>
              {metar ? (
                <>
                  <ListRow title="Ceiling" value={metar.ceiling_ft == null ? "none" : feet(metar.ceiling_ft)} />
                  <ListRow title="Visibility" value={miles(metar.visibility_sm)} />
                  {metar.wind_speed_kt != null && (
                    <ListRow
                      title="Wind"
                      value={metar.wind_speed_kt === 0 ? "calm" : `${metar.wind_dir_true_deg == null ? "variable" : `${String(Math.round(metar.wind_dir_true_deg)).padStart(3, "0")}°`} at ${Math.round(metar.wind_speed_kt)} kt`}
                    />
                  )}
                  <ListRow title={<span className="font-mono break-words">{metar.raw}</span>} />
                </>
              ) : (
                <ListRow title={place.weather_unavailable ? "The weather service could not be reached" : "No weather station reports from this field"} />
              )}
            </ListGroup>
          </TabsContent>

          <TabsContent value="radio" className="pt-4">
            <ListGroup>
              {place.frequencies.length ? place.frequencies.map((f, i) => (
                <ListRow
                  key={`${f.type}-${f.frequency_mhz}-${i}`}
                  title={f.type ?? "Frequency"} description={f.description ?? undefined}
                  value={f.frequency_mhz != null ? f.frequency_mhz.toFixed(3) : "—"}
                />
              )) : <ListRow title="None listed" />}
              {/* What some fields read out on so many clicks of the mic on
                  the CTAF: the weather, a radio check (vfr.remarks). */}
              {place.radio_notes.map(note => (
                <ListRow key={note} media={<Radio className="size-5 text-muted-foreground" />} title={note} />
              ))}
            </ListGroup>

          {place.lighting.length > 0 && (
            // The field's lights, from its Chart Supplement remarks: the
            // ones a pilot turns on from the cockpit by keying the mic,
            // and with no count of clicks of their own, the standard one --
            // with the radio, as it is the mic that turns them on.
            <div className="pt-5">
              <ListGroup
                title="Lights"
                footer={place.standard_keying
                  ? "Key the mic on the frequency 7 times within 5 seconds for high intensity, 5 for medium, 3 for low."
                  : undefined}
              >
                {place.lighting.map(note => (
                  <ListRow key={note} media={<Lightbulb className="size-5 text-muted-foreground" />} title={note} data-testid="place-lighting" />
                ))}
              </ListGroup>
            </div>
          )}
          </TabsContent>

          <TabsContent value="runways" className="pt-4">
            <ListGroup>
              {place.pattern?.altitude_ft != null && (
                <ListRow
                  title="Pattern altitude"
                  description={place.pattern.published ? "As the FAA publishes it" : "1,000 ft above the field: none published"}
                  value={feet(place.pattern.altitude_ft)} data-testid="place-pattern"
                />
              )}
              {place.runways.map((r, i) => <RunwayRow key={`${r.ends}-${i}`} runway={r} />)}
            </ListGroup>
          </TabsContent>
        </>
      )}
      </Tabs>
      {isLoading && !known && <p className={cn("pt-4 text-muted-foreground", TEXT.prose)}>Looking the airport up…</p>}
      {/* Where the planner could not be reached, the way to ask again, in
          the card that could not be had (lib/problems: errors where they
          happen); an airport not found has nothing to ask again. */}
      {error && !place && !(error instanceof ApiError && error.status === 404) && (
        <div className="pt-4">
          <ListGroup>
            <ListRow
              title={<span className="text-tint">{isFetching ? "Trying again…" : "Try again"}</span>}
              onClick={isFetching ? undefined : () => void refetch()} data-testid="place-retry"
            />
          </ListGroup>
        </div>
      )}
    </PanelCard>
  );
}

/** The star that adds an airport to Favorites (components/Favorites),
 *  filled while it is one, as Maps' are. */
function FavoriteButton({ place }: { place: AirportPlace }) {
  const kept = usePreferences(s => s.favoriteAirports.some(a => a.ident === place.ident));
  const toggle = usePreferences(s => s.toggleFavoriteAirport);
  return (
    // A round pane of glass, as the gear is; the star filled in the tint
    // while the airport is a favorite.
    <RoundButton
      label={kept ? "Remove from Favorites" : "Add to Favorites"} aria-pressed={kept}
      className={cn(kept && "text-tint hover:text-tint")}
      onClick={() => toggle({ ident: place.ident, name: place.name, municipality: place.municipality, lat: place.lat, lon: place.lon })}
      data-testid="place-favorite"
    >
      <Star className={cn("size-5", kept && "fill-current")} strokeWidth={2} />
    </RoundButton>
  );
}
