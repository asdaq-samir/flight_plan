import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { FileText, Lightbulb, Loader2, MapPin, MapPinPlus, Phone, Radio, Star } from "lucide-react";
import DirectToIcon from "../../../components/DirectToIcon";
import { cn } from "cn";
import { useKeptAirport, usePreferences } from "../../../lib/preferences";
import { useOwnShip } from "../../../lib/map/ownShip";
import RoundButton from "../../../components/RoundButton";
import { FILLS_HALF, GLASS_BUTTON } from "../../../components/mapChrome";
import CloseButton from "../../../components/CloseButton";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { LINE_TAB } from "../../../components/lineTabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Button } from "../../../components/ui/button";
import { ApiError, api } from "../../../lib/api/client";
import type { AirportPin, AirportPlace, ClassBAirport, TerminalChart } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { bearingDeg, distanceNm, type LatLon } from "../../../lib/geo";
import { chipColourOf } from "../../../lib/map/flightCategory";
import { inkOn } from "../../../lib/scoreScale";
import { feet, miles } from "../../../lib/units";
import { RunwayRow } from "./RunwayRow";
import { PublicationRows } from "./PublicationRows";
import { ChartRow, FaaChart } from "./AirportDiagram";
import { RunwaySketch } from "./RunwaySketch";
import { runwaysLeftOut, stripsOf } from "../../../lib/runwaySketch";
import { TEXT } from "../../../lib/text";

/** "18 nm NE", from wherever the card is measured from. */
function away(from: LatLon, to: LatLon): string {
  const nm = distanceNm(from, to);
  return nm < 0.5 ? "here" : `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm ${compassPoint(bearingDeg(from, to))}`;
}

/** The line under the name: the ident, the airspace, the tower or its
 *  CTAF, and how far it is -- "KDLH · Class C · 18 nm NE". */
function subtitleOf(place: AirportPlace, from: { point: LatLon; name: string | null } | null, elevation = true): ReactNode {
  const mhz = (f?: { frequency_mhz?: number | null }) =>
    f?.frequency_mhz ? f.frequency_mhz.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : null;
  // The civil tower: the airport file also lists military UHF (225-400 MHz)
  // towers, which a civil VHF radio cannot call; civil VHF comm is
  // 118.000-136.975 MHz (AIM 4-1-9 and the FAA's frequency allocations).
  const civil = (f: { frequency_mhz?: number | null }) =>
    f.frequency_mhz != null && f.frequency_mhz >= 118 && f.frequency_mhz <= 136.975;
  const tower = mhz(place.frequencies.find(f => f.type === "TWR" && civil(f)));
  const ctaf = mhz(place.frequencies.find(f => f.type === "CTAF" || f.type === "UNIC"));
  // Short lines, at the pilot's ask, to save room: the ident and the
  // class of the airspace over it, the frequency it is called on -- the
  // tower's at a towered field, else its CTAF -- and its elevation:
  // "C81 (G)", "CTAF: 122.7", "Elev: 788 ft"; how far it is after the
  // first, the shortest. Not the elevation where the runways' sketch
  // shows it (`elevation` false).
  const what = [
    place.airspace_class ? `${place.ident} (${place.airspace_class})` : place.ident,
    // A field the armed services own (the FAA's airport file): one most
    // pilots may not land at without the service's permission, or a civil
    // airport sharing it.
    place.military === "military" ? "Military, permission required" : place.military === "joint" ? "Joint use" : null,
    from ? (from.name ? `${away(from.point, place)} of ${from.name}` : away(from.point, place)) : null,
  ].filter(Boolean).join(" · ");
  // Many towers are part-time, and when one is closed the field is a CTAF
  // field (AIM 4-1-9), so a towered field with a CTAF in the file (the
  // frequency_mhz of its CTAF entry) shows both.
  const radio = place.towered
    ? tower ? `Tower: ${tower}${ctaf && ctaf !== tower ? ` · CTAF: ${ctaf}` : ""}` : "Towered"
    : ctaf ? `CTAF: ${ctaf}` : "Non-towered";
  return (
    <>
      {what}<br />{radio}
      {elevation && place.elevation_ft != null && <><br />Elev: {feet(place.elevation_ft)}</>}
    </>
  );
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

type CardTab = "radio" | "weather" | "runways" | "diagrams";
/** The card's tabs, in the pilot's order: the radio first, what is
 *  wanted first on the way in. "Freq." as on its tile was. */
const CARD_TABS: { value: CardTab; label: string }[] = [
  { value: "radio", label: "Freq." },
  { value: "weather", label: "Weather" },
  { value: "runways", label: "Runways" },
  { value: "diagrams", label: "Diagrams" },
];

/** The field's charts in the d-TPP under the Diagrams tab, by what they
 *  are for: the FAA's chart codes (vfr.publications). The airport's own
 *  -- its hot spots, land and hold short -- go with its diagram. */
const CHART_GROUPS: { title: string; kinds: string[] }[] = [
  { title: "Approaches", kinds: ["IAP"] },
  { title: "Departures", kinds: ["DP", "ODP"] },
  { title: "Arrivals", kinds: ["STR"] },
  { title: "Minimums", kinds: ["MIN"] },
];
const AIRPORT_CHARTS = ["HOT", "LAH"];
const GROUPED = new Set(["APD", ...AIRPORT_CHARTS, ...CHART_GROUPS.flatMap(g => g.kinds)]);

/** A chart's row: its title as the FAA prints it -- "LEGOZ FOUR (RNAV)",
 *  "ILS OR LOC RWY 24" -- not in sentence case as the FAA's other words
 *  are here (lib/advisories faaWords): a procedure is named by its fixes
 *  and its navaids, as a code is, and pilots know it by the title on the
 *  plate. Shown in the app, full screen (ChartRow), not on the FAA's site. */
function TerminalChartRow({ chart, airport }: { chart: TerminalChart; airport: string }) {
  return <ChartRow media={<FileText className="size-5" />} title={chart.name} url={chart.url} airport={airport} testId="terminal-chart" />;
}

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
  // Its sides four points in, not the stock button's ten: the room a
  // word needs to stay on its one line (below) at the text sizes a reader
  // sets larger.
  const look = cn("h-auto min-w-0 flex-col gap-1 rounded-xl px-1 py-3 [&_svg:not([class*='size-'])]:size-6", !filled && GLASS_BUTTON);
  const face = (
    <>
      {busy ? <Loader2 className="size-6 animate-spin" aria-hidden="true" /> : icon}
      {/* On one line, at the pilot's ask: "Fly Here" and "Add Stop" on
          two at a larger text size made every tile a line taller, and
          the card's tiles ran off the half sheet. Wrapped, not cut
          short, only where even that is too narrow, a 320-point Slide Over:
          HIG says not to truncate a button's title. */}
      <span className={cn("max-w-full text-center leading-tight font-semibold", TEXT.note)}>{label}</span>
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
export default function PlaceCard({ ident, from, onClose, onFlyHere, onAddStop, onExpand, startOn, onStarted }: {
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
  /** Opened on a section of a tab: the route's Approaches opens the
   *  destination's on its approaches. `onStarted` once it has. */
  startOn?: "approaches";
  onStarted?: () => void;
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
  const [picked, setPicked] = useState<CardTab | null>(startOn ? "diagrams" : null);
  const tab: CardTab = picked ?? "radio";
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
  // Opened on its approaches (the route's Approaches): the panel all the
  // way up and, once the answer is in and the panel has risen, the
  // approaches at the top of the card.
  // The callbacks the page's, made again at each of its draws: read
  // through a ref, so the panel rising draws nothing that restarts this.
  const placeIn = !!place;
  const calls = useRef({ onExpand, onStarted });
  useEffect(() => { calls.current = { onExpand, onStarted }; });
  useEffect(() => {
    if (startOn !== "approaches" || !placeIn) return;
    calls.current.onExpand();
    // The card may already be open on another tab (it does not remount),
    // and the inactive tab's group is not drawn: switch, and look a frame
    // or so after it has drawn.
    let look = 0;
    const scroll = window.setTimeout(() => {
      setPicked("diagrams");
      look = window.setTimeout(() => {
        tabsRef.current?.closest('[data-testid="place-card"]')?.querySelector('[data-chart-group="Approaches"]')
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
        calls.current.onStarted?.();
      }, 50);
    }, 520);
    return () => { window.clearTimeout(scroll); window.clearTimeout(look); };
  }, [startOn, placeIn]);
  // A sketch of the runways beside the name, over the Call and Address tiles, at the
  // pilot's ask -- it was the FAA's diagram cropped to that size, a
  // scatter of its lettering -- the lines under the name beside it; for
  // any field with a runway to draw. A tap shows the diagram full screen,
  // or the Runways tab where the field has none.
  // Named on the button, whose label hides what is inside it from a screen reader.
  const { sketchedRunways, leftOut } = useMemo(() => {
    const strips = place ? stripsOf(place.runways, place.lat, place.lon) : [];
    return { sketchedRunways: strips.map(r => r.ends.join("/")), leftOut: place ? runwaysLeftOut(place.runways, strips) : 0 };
  }, [place]);
  const sketched = sketchedRunways.length > 0;
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [elevationPane, setElevationPane] = useState<HTMLElement | null>(null);
  const line = place ? subtitleOf(place, measured)
    : error ? `${ident} · ${error instanceof ApiError && error.status === 404 ? "not found" : "could not be looked up"}`
      : `${ident} · …`;
  // None from a planner older than the list (a card kept by the worker,
  // a deploy under way), not a page that fails.
  const procedures = place?.procedures ?? [];
  const metar = place?.metar ?? null;
  const weather = place
    ? { status: place.weather_unavailable ? "unavailable" : metar ? "reported" : "no-report", category: metar?.flight_category ?? null }
    : known && { status: known.category ? "reported" : "no-report", category: known.category };
  const chip = weather && (
    <span
      // The words in whichever ink reads on the colour (inkOn), as the
      // map's chips are: white on a field's no-report grey was 2.6:1.
      className={cn("mt-1 shrink-0 rounded-md px-2 py-0.5 font-bold tracking-wide", TEXT.note)}
      style={{ backgroundColor: chipColourOf(weather), color: inkOn(chipColourOf(weather)) }}
      data-testid="place-category"
    >
      {weather.category ?? (place?.weather_unavailable ? "Unavailable" : "No report")}
    </span>
  );
  return (
    <PanelCard testId="place-card">
      <Tabs value={tab} onValueChange={next => setPicked(next as CardTab)} className="gap-0">
      {/* The name, the actions and the tabs' bar the panel's half, less the
          card's own top: a tab's content starts under it, out of sight
          there (FILLS_HALF). */}
      <div className={cn("min-h-[calc(var(--half-body,0px)_-_var(--corner-inset,0.75rem))]", FILLS_HALF)}>
        {place && sketched ? (
          // The runways' sketch to the right of the name, at the pilot's
          // ask, under the weather's chip, the star and the close and down
          // to the tiles, the width of Call and Address, the field's
          // elevation alone in its top left ("788 ft"); the ident and
          // class and the tower or CTAF under the name, where they were.
          // Four columns as the tiles' are, where the tiles are three too:
          // the name its half of the card.
          <div className="grid grid-cols-4 gap-x-2">
            <div className="col-span-2 row-span-2 min-w-0">
              <h2
                tabIndex={-1} data-testid="place-name"
                className={cn("font-bold tracking-tight break-words text-foreground outline-none", TEXT.card)}
              >
                {place.name}
              </h2>
              <p className={cn("text-muted-foreground", TEXT.note)} data-testid="place-line">{subtitleOf(place, measured, false)}</p>
            </div>
            <div className="col-span-2 flex items-start justify-end gap-2">
              {chip}
              <FavoriteButton place={place} />
              <CloseButton onClick={onClose} className="-mr-1" data-testid="place-close" />
            </div>
            <div className={cn("relative col-span-2 mt-2 min-h-16 overflow-hidden rounded-xl text-foreground", GLASS_BUTTON)}>
              <button
                type="button" data-testid="place-runway-sketch"
                aria-label={`${place.ident} runways ${sketchedRunways.join(", ")}, north up${leftOut ? `, ${leftOut} more not drawn, their ends unsurveyed` : ""}. ${place.airport_diagram_url ? "Airport diagram, full screen" : "Show runways"}`}
                onClick={() => (place.airport_diagram_url ? setDiagramOpen(true) : open("runways"))}
                className="absolute inset-0 block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <RunwaySketch runways={place.runways} lat={place.lat} lon={place.lon} avoid={elevationPane} />
              </button>
              {/* Over the sketch, read as it is (the button's name is the
                  runways'), on a pane of the card's own ground where a
                  runway runs under it. */}
              {place.elevation_ft != null && (
                <span
                  ref={setElevationPane}
                  className={cn("pointer-events-none absolute top-1 left-1.5 rounded-md bg-background/75 px-1 font-semibold text-foreground", TEXT.note)}
                  data-testid="place-elevation"
                >
                  <span className="sr-only">Elevation </span>{feet(place.elevation_ft)}
                </span>
              )}
            </div>
            {diagramOpen && place.airport_diagram_url && (
              <FaaChart
                title={`${place.ident} airport diagram`} url={place.airport_diagram_url} airport={place.ident}
                onClose={() => setDiagramOpen(false)}
              />
            )}
          </div>
        ) : (
          <CardHead
            name={place?.name ?? known?.name ?? kept?.name ?? ident} nameTestId="place-name"
            // Not found only where the planner said so: a planner out of
            // reach for a moment (restarted) read "not found" for KBUR.
            line={line}
            onClose={onClose} closeTestId="place-close"
          >
            {chip}
            {place && <FavoriteButton place={place} />}
          </CardHead>
        )}
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
          <TabsContent value="diagrams" className="space-y-5 pt-4">
            <ListGroup title="Airport">
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
              {procedures.filter(c => AIRPORT_CHARTS.includes(c.kind)).map(c => <TerminalChartRow key={c.url} chart={c} airport={place.ident} />)}
            </ListGroup>
            {/* The approaches, departures, arrivals and minimums in this
                cycle's d-TPP, at the pilot's ask, as the FAA's PDFs. */}
            {[...CHART_GROUPS, { title: "Other", kinds: procedures.map(c => c.kind).filter(k => !GROUPED.has(k)) }].map(g => {
              const charts = procedures.filter(c => g.kinds.includes(c.kind));
              return charts.length > 0 && (
                <div key={g.title} data-chart-group={g.title} className="scroll-mt-3">
                  <ListGroup title={g.title}>
                    {charts.map(c => <TerminalChartRow key={c.url} chart={c} airport={place.ident} />)}
                  </ListGroup>
                </div>
              );
            })}
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
    // A round pane of glass, as the gear is.
    <RoundButton
      label={kept ? "Remove from Favorites" : "Add to Favorites"} aria-pressed={kept}
      // Filled in iOS's yellow while it is a favorite, as a starred thing
      // is everywhere on iOS, at the pilot's ask (it was the tint).
      className={cn(kept && "text-[#ffcc00] hover:text-[#ffcc00] dark:text-[#ffd60a] dark:hover:text-[#ffd60a]")}
      onClick={() => toggle({ ident: place.ident, name: place.name, municipality: place.municipality, lat: place.lat, lon: place.lon })}
      data-testid="place-favorite"
    >
      <Star className={cn("size-5", kept && "fill-current")} strokeWidth={2} />
    </RoundButton>
  );
}
