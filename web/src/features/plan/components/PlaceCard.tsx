import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePrefetchQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Cloud, CloudSun, Eye, Gauge, Lightbulb, MapPin, MapPinPlus, Phone, PlaneLanding, PlaneTakeoff, Radio, Repeat, Route, Star, Thermometer, Wind } from "lucide-react";
import DirectToIcon from "../../../components/DirectToIcon";
import { FAVORITE_STAR_ON } from "../../../components/mapChrome";
import { cn } from "cn";
import { useKeptAirport, usePreferences } from "../../../lib/preferences";
import { useOwnShip } from "../../../lib/map/ownShip";
import { shareOrCopy } from "../../../lib/share";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { PhotoHead } from "../../../components/PhotoHead";
import RoundButton from "../../../components/RoundButton";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import { PillSection } from "../../../components/Favorites";
import { FirstFew } from "../../../components/FirstFew";
import { CardTabBar, CardTabPanel } from "../../../components/CardTabs";
import { Tabs } from "../../../components/ui/tabs";
import { useCardTab } from "../../../lib/cardTab";
import { CardAction as Action } from "./CardAction";
import { ApiError } from "../../../lib/api/client";
import type { AirportPin, AirportPlace, ClassBAirport, TerminalChart } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { distanceNm, type LatLon } from "../../../lib/geo";
import { awayFrom } from "../../../lib/useAway";
import { chipColourOf } from "../../../lib/map/flightCategory";
import { inkOn } from "../../../lib/scoreScale";
import { feet, miles } from "../../../lib/units";
import { reportedWind, windLine } from "../format";
import { ChartBadge, RowBadge } from "../../../components/RowBadge";
import { BADGE } from "../../../lib/rowBadges";
import { FrequencyRow } from "./FrequencyRow";
import { RunwayRow } from "./RunwayRow";
import { PublicationRows } from "./PublicationRows";
import { ChartRow, FaaChart } from "./AirportDiagram";
import { RunwaySketch } from "./RunwaySketch";
import { runwaysLeftOut, stripsOf } from "../../../lib/runwaySketch";
import { TEXT } from "../../../lib/text";
import { diagramRunwaysPicture } from "../../../lib/diagram";
import { useHeardMetar, useHeardTaf } from "../../../lib/map/receiver";
import { ago, useMinuteClock, zuluTime } from "../../../lib/clock";
import { arrivalHour, hoursOf, sentenceOf, tafOf } from "../../../lib/hourly";
import { HourlyForecast } from "./HourlyForecast";
import { sameField } from "../../../lib/procedures";
import { ctafOf, frequencyOf, mhzText } from "../../../lib/frequencies";
import { fuelNames } from "../../../lib/stopServices";
import { airportQuery, photosQuery, servicesQuery } from "../../../lib/queryClient";
import { StopServices, StopStrip, type SuggestedStop } from "./StopServices";
import { PhotoSlide } from "../../../components/PictureSlides";

const SketchViewer = lazy(() => import("./SketchViewer"));
// The pictures behind the diagram, full screen to pinch in on, as a chart is.
const PictureViewer = lazy(() => import("./AirportDiagramViewer"));

/** "18 nm NE", from wherever the card is measured from. */
function away(from: LatLon, to: LatLon): string {
  return distanceNm(from, to) < 0.5 ? "here" : awayFrom(from, to);
}

/** The line under the name, how far the field is at the pilot's ask --
 *  "18 nm NE of C81" -- and whether it may be landed at without asking.
 *  Nothing where there is nothing to measure from. */
function subtitleOf(place: AirportPlace, from: { point: LatLon; name: string | null } | null): string {
  return [
    from ? (from.name ? `${away(from.point, place)} of ${from.name}` : away(from.point, place)) : null,
    // Its elevation beside the distance, at the owner's ask (2026-10-29):
    // the field's from the FAA's airport file (NASR APT_BASE ELEV, feet
    // MSL), what a pilot sets the pattern altitude from.
    place.elevation_ft != null ? `Elevation ${feet(place.elevation_ft)}` : null,
    // A field the armed services own (the FAA's airport file): one most
    // pilots may not land at without the service's permission, or a civil
    // airport sharing it -- not a description, a field to keep out of.
    place.military === "military" ? "Military, permission required" : place.military === "joint" ? "Joint use" : place.private ? "Private, permission required" : null,
  ].filter(Boolean).join(" · ");
}

/** How long the panel takes to come all the way up before the tabs' bar
 *  or the approaches are scrolled to: the sheet's settle and a frame
 *  (SETTLE_MOST is 0.35 s). */
const RISEN_MS = 520;

/** A time as reports give it: "1255Z". */
function zuluOf(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? "" : zuluTime(when);
}

/** When the report was made: "1255Z · 14m ago". */
function observedLine(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return `${zuluOf(at)} · ${ago(Date.now() - when.getTime())}`;
}

/** How old a report is, "14m ago", for the weather's line. */
function ageOf(at: string | null | undefined): string | null {
  const when = at ? new Date(at) : null;
  return when && !Number.isNaN(when.getTime()) ? ago(Date.now() - when.getTime()) : null;
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
/** The card's pages, in the pilot's order, right under its actions, brought
 *  back at the owner's ask (2026-10-29, "bring back the tabs after the
 *  buttons") after a day as one scroll (A2): the radio first, what is
 *  wanted first on the way in, named Info at the owner's ask ("Rename
 *  Freq. to Info"). Their values are the old ones, which the specs and a
 *  kept tab know them by. */
const CARD_TABS: { value: CardTab; label: string }[] = [
  { value: "radio", label: "Info" },
  { value: "weather", label: "Weather" },
  { value: "runways", label: "Runways" },
  { value: "diagrams", label: "Charts" },
];

/** The field's charts in the d-TPP under the Charts tab, by what they are for:
 *  the FAA's chart codes (vfr.publications). The airport's own -- its hot
 *  spots, land and hold short -- go with its diagram. */
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
  // A procedure's badge says which kind it is, as its group's title does:
  // an approach's a landing airplane, a departure's one taking off, an
  // arrival's a route; the rest a chart's.
  const badge = chart.kind === "IAP" ? <RowBadge colour={BADGE.approach}><PlaneLanding /></RowBadge>
    : chart.kind === "DP" || chart.kind === "ODP" ? <RowBadge colour={BADGE.approach}><PlaneTakeoff /></RowBadge>
      : chart.kind === "STR" ? <RowBadge colour={BADGE.approach}><Route /></RowBadge>
        : <ChartBadge />;
  return <ChartRow media={badge} title={chart.name} url={chart.url} airport={airport} testId="terminal-chart" />;
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

/** The radio a pilot calls the field on, beside its airspace: the tower's
 *  where it has one, else the CTAF -- a UNICOM that is also the CTAF, or
 *  MULTICOM's 122.9 where none is listed (AC 90-66C 9.6, ctafOf). */
function radioOf(place: AirportPlace): string {
  // Every tower frequency the FAA lists, where a field splits its runways
  // between two (KPHX: 118.7 for 08/26, 120.9 for 07L/25R and 07R/25L):
  // the first alone read as the field's one tower, against the other in
  // Frequencies just above it (the owner's screenshot, 2026-10-29).
  const towers = place.towered
    ? [...new Set(place.frequencies.filter(f => f.type === "TWR" && f.frequency_mhz != null).map(f => mhzText(f.frequency_mhz!)))]
    : [];
  if (towers.length) return `Tower ${towers.join(", ")}`;
  const tower = place.towered ? frequencyOf(place.frequencies, "TWR") : null;
  if (tower?.frequency_mhz != null) return `Tower ${mhzText(tower.frequency_mhz)}`;
  const ctaf = ctafOf(place.frequencies);
  return `${ctaf.type === "MULTICOM" ? "MULTICOM" : "CTAF"} ${mhzText(ctaf.frequency_mhz!)}`;
}

/** A section of the Info tab, which has several: its title over its rows
 *  (PillSection), the title the way to its list in full where it has more. */
function CardSection({ title, onMore, right, children, testId }: {
  title: string; onMore?: () => void; right?: ReactNode; children: ReactNode; testId?: string;
}) {
  return (
    <div className="pt-5 first:pt-0">
      <PillSection title={title} onMore={onMore} right={right} testId={testId}>{children}</PillSection>
    </div>
  );
}

/**
 * An airport's card in the panel, as a place's is in Maps, laid out at
 * the owner's pick of its redesign (A2, 2026-10-29): the field's pictures
 * across its top -- its runways, from the air, from the ground -- its ident
 * large over them with its name and town; four things to do under them --
 * fly there, land there on the way, call it, keep it as a Favorite -- and
 * right under them its four tabs, back at the owner's ask: Info (its
 * details, frequencies, lights and services), Weather (the weather there
 * hour by hour, G1, over the reports as sent), Runways and Charts. Opened
 * by a tap on the airport on the chart (AirportsLayer), and held in the
 * address (`?place=KDLH`), so a link lands on it.
 *
 * How far it is is from the pilot's own position when it is known, and
 * from the route's departure otherwise.
 */
export default function PlaceCard({ ident, from, onClose, onFlyHere, onAddStop, onExpand, onLower, startOn, onStarted, stop, arrival }: {
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
  /** The panel all the way up, as a tab is picked. */
  onExpand: () => void;
  /** Back down half way: the open tab tapped again with the panel all the
   *  way up, as the route's tabs do (PanelTabs). */
  onLower: () => void;
  /** Opened on a part of a tab: the route's Approaches opens the
   *  destination's on its approaches. `onStarted` once it has. */
  startOn?: "approaches";
  onStarted?: () => void;
  /** A stop the planner suggests here, opened from its pin on the map or
   *  the route's box: its figures under the actions (StopStrip), and Add
   *  Stop puts it in at its place. */
  stop?: SuggestedStop;
  /** Where the field is the planned flight's destination: when it leaves
   *  (ISO; null for now) and how long until it lands, minutes, for the
   *  hour its forecast marks. */
  arrival?: { depart: string | null; minutes: number };
}) {
  // Asked again every five minutes while the card is open, its weather a
  // report's freshness (airportQuery): an open card's METAR was the one
  // it opened with for as long as it stayed (the audit's finding).
  const { data: place, isLoading, error, refetch, isFetching } = useQuery({ ...airportQuery(ident), refetchInterval: 5 * 60_000 });
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
  // Every frequency, the title's All tapped; the first few until then.
  // The tab picked, kept for the airport while the page is open
  // (useCardTab); Charts where the card opens on its approaches.
  const [tab, setPicked] = useCardTab<CardTab>(`place:${ident}`, "radio", startOn ? "diagrams" : null);
  // A tab picked takes the panel all the way up, as the route's tabs do;
  // the bar back in sight if the card was scrolled past it, once the panel
  // is up, clear of the name's bar over the card (PhotoHead).
  const isUp = () => tabsRef.current?.closest("[data-panel]")?.getAttribute("data-panel") === "full";
  const raise = () => {
    const up = isUp();
    onExpand();
    window.setTimeout(() => tabsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), up ? 50 : RISEN_MS);
  };
  const open = (next: CardTab) => {
    setPicked(next);
    raise();
  };
  // Opened on its approaches (the route's Approaches): the panel all the
  // way up and, once the answer is in and the panel has risen, Charts open
  // on the approaches.
  // The callbacks the page's, made again at each of its draws: read
  // through a ref, so the panel rising draws nothing that restarts this.
  const placeIn = !!place;
  const calls = useRef({ onExpand, onStarted });
  useEffect(() => { calls.current = { onExpand, onStarted }; });
  useEffect(() => {
    if (startOn !== "approaches" || !placeIn) return;
    calls.current.onExpand();
    // The card may already be open on another tab (it does not remount),
    // and an inactive tab's groups are not drawn: switch, and look a frame
    // or so after it has drawn.
    let look = 0;
    const scroll = window.setTimeout(() => {
      setPicked("diagrams");
      look = window.setTimeout(() => {
        tabsRef.current?.closest('[data-testid="place-card"]')?.querySelector('[data-chart-group="Approaches"]')
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
        calls.current.onStarted?.();
      }, 50);
    }, RISEN_MS);
    return () => { window.clearTimeout(scroll); window.clearTimeout(look); };
  }, [startOn, placeIn, setPicked]);
  // The runways, sketched or the FAA's diagram cropped to them, a page of
  // the pictures: a tap shows it full screen -- the FAA's diagram, or for
  // a field the FAA draws none for the sketch (SketchViewer).
  const { sketchedRunways, leftOut } = useMemo(() => {
    const strips = place ? stripsOf(place.runways, place.lat, place.lon) : [];
    return { sketchedRunways: strips.map(r => r.ends.join("/")), leftOut: place ? runwaysLeftOut(place.runways, strips) : 0 };
  }, [place]);
  const sketched = sketchedRunways.length > 0;
  const [diagramOpen, setDiagramOpen] = useState<"faa" | "sketch" | null>(null);
  // The field from the air, the USGS's, and from the ground where
  // Wikipedia has a free photo (vfr.airport_photos), the first pages of
  // the pictures, at the owner's ask ("airport photos swipe behind the
  // airport diagram thumbnail", 2026-10-23). Which is open full screen.
  // Asked for with the field itself, not after it: they waited for the
  // card's first answer and went 0.6 s after the tap (the 23 Oct timings).
  const { data: photos } = useQuery(photosQuery(ident));
  // The services asked for with it too: the fuel is the details', the
  // rest the Services' at the Info tab's foot (StopServices).
  const { data: services } = useQuery(servicesQuery(ident));
  usePrefetchQuery(servicesQuery(ident));
  const [picture, setPicture] = useState<"aerial" | "photo" | null>(null);
  const [noRunwaysPicture, setNoRunwaysPicture] = useState(false);
  // The state as the FAA writes it ("MN"), not ISO's region ("US-MN").
  const where = place ? [place.municipality, place.region?.replace(/^US-/, "")].filter(Boolean).join(", ") : null;
  const name = place?.name ?? known?.name ?? kept?.name ?? null;
  const line = place ? subtitleOf(place, measured)
    : error ? (error instanceof ApiError && error.status === 404 ? "Not found" : "Could not be looked up")
      : "…";
  // None from a planner older than the list (a card kept by the worker,
  // a deploy under way), not a page that fails.
  const procedures = place?.procedures ?? [];
  // A cockpit receiver's report of the field over FIS-B (lib/fisb), where
  // it is newer than the planner's or the planner's could not be had: in
  // the air the internet is often out of reach, and the ground stations'
  // broadcast is what there is.
  const heard = useHeardMetar(ident);
  const ownMetar = place?.metar ?? null;
  const viaReceiver = !!heard?.observed_at && (!ownMetar?.observed_at || heard.observed_at > ownMetar.observed_at);
  const metar = viaReceiver ? heard : ownMetar;
  const weather = place
    ? { status: place.weather_unavailable && !viaReceiver ? "unavailable" : metar ? "reported" : "no-report", category: metar?.flight_category ?? null }
    : known && { status: known.category ? "reported" : "no-report", category: known.category };
  // A field with no report of its own: the nearest station's within 30
  // nm (vfr.weather.nearest_report), at the pilot's ask -- its category
  // the card's badge, "≈", only within the ten statute miles a report is
  // said of (`near`).
  const nearby = place && !metar ? place.nearby_metar ?? null : null;
  const nearbyCategory = nearby?.metar.flight_category ?? null;
  const nearCategory = nearby?.near ? nearbyCategory : null;
  // And the weather the National Weather Service's Gridded LAMP models at
  // the field itself for the hour (vfr.glmp), at the pilot's ask: the
  // badge's before a near station's, the model being of this field.
  const modelled = place && !metar ? place.modelled_weather ?? null : null;
  // A flight category only: its own, or with none the modelled one or the
  // nearest station's, marked "≈" -- and none at all where neither is
  // had, the weather's line saying why.
  const approximate = modelled
    ? { category: modelled.flight_category, said: "modelled for this field by the National Weather Service, not a report" }
    : nearCategory ? { category: nearCategory, said: `from the report of ${nearby?.ident}, another station, not this field's own` } : null;
  const category = weather?.category ?? approximate?.category ?? null;
  const chipColour = category ? chipColourOf({ status: "reported", category }) : null;
  const chip = category && chipColour && (
    <span
      // The words in whichever ink reads on the colour (inkOn), as the
      // map's chips are: white on a field's no-report grey was 2.6:1. The
      // FAA's colours for the categories (lib/map/flightCategory).
      className={cn("flex h-[1.625rem] shrink-0 items-center rounded-full px-2.5 font-bold whitespace-nowrap", TEXT.detail)}
      style={{ backgroundColor: chipColour, color: inkOn(chipColour) }}
      data-testid="place-category"
    >
      {weather?.category ? category : (
        <>
          {/* Words for VoiceOver, which may read a bare "≈" as a symbol;
              an aria-label on a role-less span may be ignored. */}
          <span aria-hidden>≈ {category}</span>
          <span className="sr-only">About {category}, {approximate?.said}</span>
        </>
      )}
    </span>
  );
  // The weather in a line at the top of its tab where there is no
  // forecast to say, as a pilot reads a report first: the wind, the
  // visibility and the ceiling (the lowest broken or overcast layer, 14
  // CFR 1.1), and how old it is; with none of its own, the model's or the
  // nearest station's, said as such.
  const weatherLine = metar
    ? [windLine(metar), metar.visibility_sm != null ? miles(metar.visibility_sm) : null, metar.ceiling_ft == null ? "No ceiling" : `Ceiling ${feet(metar.ceiling_ft)}`].filter(Boolean).join(" · ")
    : modelled ? `Modelled: ${modelled.visibility_sm >= 10 ? "10+ sm" : miles(modelled.visibility_sm)} · ${modelled.ceiling_ft == null ? "no ceiling" : `ceiling ${feet(modelled.ceiling_ft)}`}`
      : nearby ? `Nearest report ${nearby.ident}, ${nearby.distance_nm} nm ${compassPoint(nearby.bearing_deg)}`
        : place?.weather_unavailable ? "The weather service could not be reached" : "No weather station reports from this field";
  const weatherAge = metar ? ageOf(metar.observed_at) : nearby ? ageOf(nearby.metar.observed_at) : null;
  // And hour by hour, as Apple's Weather has it (the owner's pick, G1):
  // Now from the report, each hour after it from the field's own TAF --
  // the planner's, or own ship's receiver's where the planner has none --
  // and a sentence of what they say, written from them (lib/hourly). Read
  // again each minute, as the hours move on.
  const heardTaf = useHeardTaf(ident);
  const tafText = place?.taf ?? heardTaf;
  const now = useMinuteClock();
  const hourly = useMemo(() => {
    const hours = hoursOf({ metar, taf: tafOf(tafText, now), now });
    return { hours, sentence: sentenceOf(hours) };
  }, [metar, tafText, now]);
  // The hour the planned flight lands in, where this is its destination.
  const landsAt = arrival ? (arrival.depart ? Date.parse(arrival.depart) : now) + arrival.minutes * 60_000 : null;
  const landsIn = landsAt != null && !Number.isNaN(landsAt) ? arrivalHour(hourly.hours, landsAt) : null;
  // The longest runway open, for the details: what a pilot sizes a field by.
  const longest = place?.runways.filter(r => !r.closed && r.length_ft != null).sort((a, b) => b.length_ft! - a.length_ft!)[0] ?? null;
  const ident4 = place?.ident ?? ident;
  // The pictures, a swipe across (PictureSlides): the field from the air
  // first, then its runways, then the field from the ground, at the
  // owner's ask (2026-10-29: "make the aerial view as the first image and
  // then next one can be the airport diagram"); the runways first where
  // there is no aerial.
  const runwaysSlide = (
    <div key="diagram" className="relative size-full bg-background">
      {/* A tap where there is nothing to draw opens the Runways tab
          where it has rows (runways whose ends are unsurveyed, a pattern
          altitude); otherwise it is words, not a button. */}
      {place && !sketched && (place.runways.length > 0 || place.pattern?.altitude_ft != null ? (
        <button
          type="button" data-testid="place-runway-sketch" onClick={() => open("runways")}
          className={cn("absolute inset-0 flex items-center justify-center text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", TEXT.note)}
        >
          No runways to draw
        </button>
      ) : (
        <div data-testid="place-runway-sketch" className={cn("absolute inset-0 flex items-center justify-center text-muted-foreground", TEXT.note)}>
          No runways to draw
        </div>
      ))}
      {place && sketched && (<button
        type="button" data-testid="place-runway-sketch"
        aria-label={`${place.ident} runways ${sketchedRunways.join(", ")}, north up${leftOut ? `, ${leftOut} more not drawn, their ends unsurveyed` : ""}. ${place.airport_diagram_url ? "Airport diagram" : "Runways sketch"}, full screen`}
        onClick={() => setDiagramOpen(place.airport_diagram_url ? "faa" : "sketch")}
        // The whole head, as the photos fill it, the name on the shade over
        // its foot: kept clear of the name, the crop sat in a box with bands
        // either side and under it (the owner's screenshot, 2026-10-29: "Why
        // is airport diagram not filling the rest of the space"). All of it
        // is a tap away, full screen.
        className="absolute inset-0 block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {/* The FAA's own diagram, cropped to its runways, where the field
            has one, at the pilot's ask; the card's sketch of them
            where it has none, or the crop cannot be had. */}
        {place.airport_diagram_cycle && !noRunwaysPicture ? (
          <img
            src={diagramRunwaysPicture(place.ident, place.airport_diagram_cycle)} alt=""
            onError={() => setNoRunwaysPicture(true)} data-testid="place-diagram-runways"
            // The diagram's white paper round it, black at night: the
            // inversion turns the paper too.
            className="absolute inset-0 size-full bg-white object-cover dark:invert"
          />
        ) : (
          <RunwaySketch runways={place.runways} lat={place.lat} lon={place.lon} />
        )}
      </button>)}
    </div>
  );
  const slides = [
    photos && (
      <PhotoSlide
        key="aerial" flush src={photos.aerial_url} alt="" onOpen={() => setPicture("aerial")}
        label={`${ident4} from the air, full screen`} testId="place-aerial"
      />
    ),
    runwaysSlide,
    photos?.photo && (
      <PhotoSlide
        key="photo" flush src={photos.photo.url} alt="" onOpen={() => setPicture("photo")}
        label={`${ident4} from the ground, full screen`} testId="place-photo" creditTestId="place-photo-credit"
        // Its photographer and licence, as Commons' licences ask.
        credit={`${photos.photo.credit}${photos.photo.license ? ` · ${photos.photo.license}` : ""}`}
      />
    ),
  ];
  // The pill's line and picture, at the owner's pick (P5, 2026-10-29): the
  // category as the chip says it ("≈" where it is not the field's own),
  // the reported wind as FPL's list writes it, and the name; the head's
  // first picture -- the aerial, else the FAA diagram's runways where it
  // is drawn, none for the sketch, drawn in the page.
  const pillWind = metar ? reportedWind(metar.wind_dir_true_deg, metar.wind_speed_kt, metar.wind_gust_kt) : null;
  const pillLine = [
    category && (weather?.category ? category : `≈ ${category}`),
    pillWind && (pillWind === "calm" ? "Calm" : `${pillWind.dir} ${pillWind.speed}`),
    name && name !== ident4 ? name : null,
  ].filter(Boolean).join(" · ");
  const pillPicture = photos?.aerial_url ?? (place && sketched && place.airport_diagram_cycle && !noRunwaysPicture
    ? diagramRunwaysPicture(place.ident, place.airport_diagram_cycle) : undefined);
  const share = () => void shareOrCopy({ title: place?.name ?? ident, url: `${location.origin}/app/plan?place=${place?.ident ?? ident}` }).catch(() => {});
  return (
    <PanelCard testId="place-card" flush={!(error && !place)}>
      {place || !error ? (
        <>
          {/* The head and the actions from the first frame, live once the
              answer is in: the card one shape while its answer comes, at
              the pilot's ask. */}
          <PhotoHead
            title={ident4} testId="place-head" titleTestId="place-name" subtitleTestId="place-where"
            // The name, and the town on a line of its own under it, at the
            // owner's ask (2026-10-29: "keep the city on next line").
            subtitle={name && name !== ident4 ? name : where || " "}
            line={(
              <>
                {name && name !== ident4 && where && <p className={cn("truncate text-white/90", TEXT.prose)} data-testid="place-town">{where}</p>}
                {line && <p className={cn("line-clamp-2 text-white/80", TEXT.note)} data-testid="place-line">{line}</p>}
              </>
            )}
            label={`${ident4}: its runways${photos ? ", from the air" : ""}${photos?.photo ? ", from the ground" : ""}`}
            slides={slides} onClose={onClose} onShare={share} closeTestId="place-close" shareTestId="place-share"
            pill={{ line: pillLine || undefined, picture: pillPicture }}
            // The share at the left and the star beside the close, at the
            // owner's ask (2026-10-29), the star's place in the actions
            // the address's.
            shareAtLeft beside={look => <FavoriteButton ident={kept?.ident ?? ident} place={place ?? null} className={look} />}
          >
            {diagramOpen === "faa" && place?.airport_diagram_url && (
              <FaaChart
                title={`${place.ident} airport diagram`} url={place.airport_diagram_url} airport={place.ident}
                onClose={() => setDiagramOpen(null)}
              />
            )}
            {picture && photos && (
              <Suspense fallback={null}>
                <PictureViewer
                  title={`${ident4} ${picture === "aerial" ? "from the air" : "from the ground"}`}
                  pages={[picture === "aerial" || !photos.photo
                    ? { src: photos.aerial_url, width: 900, height: 600 }
                    : { src: photos.photo.url, width: photos.photo.width ?? 900, height: photos.photo.height ?? 600 }]}
                  onClose={() => setPicture(null)}
                />
              </Suspense>
            )}
            {diagramOpen === "sketch" && place && (
              <Suspense fallback={null}>
                <SketchViewer
                  ident={place.ident} runways={place.runways} lat={place.lat} lon={place.lon}
                  onClose={() => setDiagramOpen(null)}
                />
              </Suspense>
            )}
          </PhotoHead>
          {/* Four equal, as Maps' are under a place's photos: Fly Here
              filled, the Direct-To's symbol on it; Add Stop beside it, at
              the pilot's ask, the field the route's next stop; Call, the
              field's own phone from the FAA's airport file, greyed where it
              lists none; and the address in Maps, the star's place
              until the owner moved the star up by the close (2026-10-29). */}
          <div className={cn("grid gap-2 pt-3", onAddStop ? "grid-cols-4" : "grid-cols-3")} data-testid="place-actions">
            <Action
              icon={<DirectToIcon />} label="Fly Here" filled busy={flying} disabled={!place} testId="fly-here"
              onClick={() => { if (place) { setFlying(true); onFlyHere(place); } }}
            />
            {onAddStop && (
              <Action icon={<MapPinPlus />} label="Add Stop" disabled={!place} onClick={() => { if (place) onAddStop(place); }} testId="place-add-stop" />
            )}
            <Action
              icon={<Phone />} label="Call" disabled={!place?.phone}
              href={place?.phone ? `tel:${place.phone}` : undefined}
              spoken={place?.phone ? `Call ${place.phone}` : "Call: no phone listed"} testId="place-call"
            />
            <Action
              icon={<MapPin />} label="Address" disabled={!place} href={place ? mapsLink(place) : undefined}
              spoken={place?.address ? `Address in Maps: ${place.address}` : "Open in Maps"} testId="place-address-action"
            />
          </div>
          {place && stop && <StopStrip ident={place.ident} stop={stop} />}
        </>
      ) : (
        <div className="flex flex-col pt-[var(--corner-inset,0.75rem)]" data-to-edge="">
          <CardHead
            name={kept?.name ?? known?.name ?? ident} nameTestId="place-name"
            // Not found only where the planner said so: a planner out of
            // reach for a moment (restarted) read "not found" for KBUR.
            line={line} lineTestId="place-line"
            onClose={onClose} closeTestId="place-close"
          />
        </div>
      )}

      {/* The card's four tabs right under its actions, at the owner's ask
          ("bring back the tabs after the buttons", 2026-10-29), from the
          first frame, greyed until the answer comes as the actions are: a
          tap would raise the sheet over pages with nothing in them yet.
          Tapped, the panel all the way up, the open one tapped again up
          there back half way (CardTabBar). Not over a card that could not
          be had. */}
      {!(error && !place) && (
        <Tabs value={tab} className="gap-0">
          <CardTabBar
            tabs={CARD_TABS} value={tab} onPick={setPicked} testIdPrefix="place-tab" disabled={!place}
            raise={{ onExpand: raise, onLower }} barRef={tabsRef} className="mt-3 scroll-mt-16"
          />
          <CardTabPanel value="radio" className="space-y-0">
            {place && (
              <>
                {/* Before the Details, at the owner's ask (2026-10-29: "move
                    details after frequencies"). The first few, the title the
                    way to every one, as every
                    section's title is the way to its list in full (PillSection);
                    how many of how many at its right. */}
                <div className="pt-5 first:pt-0">
                  <FirstFew
                    key={place.ident} title="Frequencies" testId="place-frequencies"
                    rows={place.frequencies.length ? place.frequencies.map((f, i) => (
                      <FrequencyRow key={`${f.type}-${f.frequency_mhz}-${i}`} type={f.type} description={f.description} mhz={f.frequency_mhz} testId="place-frequency" />
                    )) : [<ListRow key="none" title="None listed" />]}
                    // What some fields read out on so many clicks of the mic on
                    // the CTAF: the weather, a radio check (vfr.remarks).
                    after={place.radio_notes.map(note => (
                      <ListRow key={note} media={<RowBadge colour={BADGE.traffic}><Radio /></RowBadge>} title={note} />
                    ))}
                  />
                </div>

                <CardSection title="Details" testId="place-details">
                  <ListGroup>
                    <ListRow
                      title="Elevation" data-testid="place-elevation"
                      value={<span className="font-semibold text-foreground">{feet(place.elevation_ft)}</span>}
                    />
                    {/* The class of the airspace it sits in (its airspace_class,
                        from the FAA's NASR) and the radio a pilot calls it on. */}
                    <ListRow
                      title="Airspace" data-testid="place-airspace"
                      value={<span className="font-semibold text-foreground">{[place.airspace_class && `Class ${place.airspace_class}`, radioOf(place)].filter(Boolean).join(" · ")}</span>}
                    />
                    {longest && (
                      <ListRow
                        title="Longest runway" data-testid="place-longest-runway"
                        value={<span className="font-semibold text-foreground">{`${longest.ends ?? "—"} · ${feet(longest.length_ft)}`}</span>}
                      />
                    )}
                    {/* Its fuel from its Chart Supplement entry, and the remarks
                        in plain English as the planner gives them, a row each
                        (vfr.remarks.service_notes): self-serve, its hours, the FBO's. */}
                    <ListRow
                      title="Fuel" data-testid="services-fuel"
                      value={<span className="font-semibold text-foreground">{services ? (services.fuel_types.length ? fuelNames(services.fuel_types) : "None listed") : "…"}</span>}
                    />
                    {/* Its remarks folded under their own row, so a field's
                        paragraph of them (Duluth's) does not stand between the
                        fuel and the address in A2's Details. shadcn's Collapsible. */}
                    {!!services?.fuel_notes.length && (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <ListRow title="Fuel remarks" chevron data-testid="services-fuel-remarks" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          {services.fuel_notes.map(note => <ListRow key={note} title={<span className={cn("text-muted-foreground", TEXT.detail)}>{note}</span>} />)}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    {/* Where it is on the ground, in Maps: an action of the
                        card's until the star took its place (A2). */}
                    {/* The address written out, the way to it in Maps, at the
                        owner's ask (2026-10-29: "write the address in
                        details"); the town where the FAA lists none. */}
                    <ListRow title="Address" description={place.address ?? where ?? undefined} href={mapsLink(place)} data-testid="place-address" />
                  </ListGroup>
                </CardSection>
                {place.lighting.length > 0 && (
                  // The field's lights, from its Chart Supplement remarks: the
                  // ones a pilot turns on from the cockpit by keying the mic, and
                  // with no count of clicks of their own, the standard one --
                  // after the radio, as it is the mic that turns them on.
                  <div className="pt-5">
                    <FirstFew
                      key={place.ident} title="Lights"
                      rows={place.lighting.map(note => (
                        <ListRow key={note} media={<RowBadge colour={BADGE.lights}><Lightbulb /></RowBadge>} title={note} data-testid="place-lighting" />
                      ))}
                      after={place.standard_keying && (
                        // The standard keying (AIM 2-1-9): the mic keyed 7 times
                        // within 5 seconds for high intensity, 5 for medium, 3 for
                        // low -- a row, where it was a footnote.
                        <ListRow title="Keying" value={<span className="text-foreground">7 high · 5 medium · 3 low</span>} data-testid="place-keying" />
                      )}
                    />
                  </div>
                )}
                {/* What the field offers on the ground (StopServices), after
                    the radio and the lights, at the owner's ask for food, fuel
                    and rest stops: its fuel is the details'. */}
                <StopServices ident={place.ident} withoutFuel />
              </>
            )}
          </CardTabPanel>

          <CardTabPanel value="weather" className="space-y-0">
            {/* The weather's card at the top of its tab, as Apple's Weather
                has its hourly one: its category in the FAA's colour, the
                forecast in a sentence and the report's age over a hairline,
                the hours under it; the reports as sent right under it, so
                the sentence is not a button. With no report or forecast of
                its own, what there is said in the sentence's place: the
                model's, the nearest station's. */}
            {(place || known) && (
              <ListGroup>
                <ListRow
                  media={chip || undefined}
                  title={<span className={TEXT.prose} data-testid="place-forecast-sentence">{place ? hourly.sentence ?? weatherLine : "…"}</span>}
                  value={weatherAge ?? undefined} data-testid="place-weather-summary"
                />
                {place && hourly.hours.length > 0 && (
                  <div className="min-w-0">
                    <HourlyForecast
                      hours={hourly.hours}
                      arrival={landsIn != null && landsAt != null ? { index: landsIn, at: landsAt } : null}
                    />
                  </div>
                )}
              </ListGroup>
            )}
            {place && (
              <div className="pt-5" data-testid="place-weather">
                <ListGroup>
                  {metar ? (
                    <>
                      {/* When it was observed, first: a report's age is what a
                          pilot weighs it by (and where it came from, where it is
                          own ship's receiver). Its wind is true, as reported. */}
                      {metar.observed_at && (
                        <ListRow
                          title="Observed" data-testid="place-observed"
                          value={<span className="text-foreground">{observedLine(metar.observed_at)}{viaReceiver ? " · FIS-B" : ""}</span>}
                        />
                      )}
                      {/* Each figure with its glyph, its value at the right in
                          the text's own colour; the report as it was sent
                          under them. */}
                      {metar.wind_speed_kt != null && (
                        <ListRow
                          media={<RowBadge colour={BADGE.weather}><Wind /></RowBadge>} title="Wind"
                          value={<span className="font-semibold text-foreground">{windLine(metar)}</span>} data-testid="place-wind"
                        />
                      )}
                      <ListRow
                        media={<RowBadge colour={BADGE.weather}><Eye /></RowBadge>} title="Visibility"
                        value={<span className="font-semibold text-foreground">{miles(metar.visibility_sm)}</span>}
                      />
                      <ListRow
                        media={<RowBadge colour={BADGE.weather}><Cloud /></RowBadge>} title="Ceiling"
                        value={<span className="font-semibold text-foreground">{metar.ceiling_ft == null ? "None" : feet(metar.ceiling_ft)}</span>}
                      />
                      {metar.temp_c != null && (
                        <ListRow
                          media={<RowBadge colour={BADGE.weather}><Thermometer /></RowBadge>} title="Temperature"
                          description={metar.dewpoint_c != null ? `Dew point ${Math.round(metar.dewpoint_c)} °C` : undefined}
                          value={<span className="font-semibold text-foreground">{Math.round(metar.temp_c)} °C</span>}
                        />
                      )}
                      {metar.altimeter_in_hg != null && (
                        <ListRow
                          media={<RowBadge colour={BADGE.weather}><Gauge /></RowBadge>} title="Altimeter"
                          value={<span className="font-semibold text-foreground">{metar.altimeter_in_hg.toFixed(2)} inHg</span>}
                        />
                      )}
                      <ListRow title={<span className="font-mono break-words">{metar.raw}</span>} />
                    </>
                  ) : (
                    <ListRow title={place.weather_unavailable ? "The weather service could not be reached" : "No weather station reports from this field"} />
                  )}
                </ListGroup>
                {/* For one with no report of its own, the weather modelled at
                    it for the hour (vfr.glmp): its category -- the card's "≈"
                    badge -- ceiling and visibility, and that it is a model's. */}
                {modelled && (
                  <div className="pt-5" data-testid="place-modelled-weather">
                    {/* The National Weather Service's Gridded LAMP: planning
                        guidance from a model, not an observation. */}
                    <ListGroup title={`Modelled for ${zuluOf(modelled.valid_at)}`}>
                      <ListRow
                        media={<RowBadge colour={BADGE.weather}><CloudSun /></RowBadge>} title="Flight category"
                        value={<span className="font-semibold text-foreground">{modelled.flight_category}</span>}
                      />
                      <ListRow
                        media={<RowBadge colour={BADGE.weather}><Eye /></RowBadge>} title="Visibility"
                        // GLMP's most is 10 sm, as a METAR's "10SM" is.
                        value={<span className="font-semibold text-foreground">{modelled.visibility_sm >= 10 ? "10+ sm" : miles(modelled.visibility_sm)}</span>}
                      />
                      <ListRow
                        media={<RowBadge colour={BADGE.weather}><Cloud /></RowBadge>} title="Ceiling"
                        value={<span className="font-semibold text-foreground">{modelled.ceiling_ft == null ? "None" : feet(modelled.ceiling_ft)}</span>}
                      />
                    </ListGroup>
                  </div>
                )}
                {/* Its nearest station's, for one with none of its own: where
                    it is from it, its category and the report as sent -- the
                    card's "≈" badge where nothing is modelled. */}
                {nearby && (
                  <div className="pt-5" data-testid="place-nearby-metar">
                    <ListGroup title={`Nearest report, ${nearby.distance_nm} nm ${compassPoint(nearby.bearing_deg)}`}>
                      <ListRow
                        title={<span className="font-semibold">{nearby.ident}</span>}
                        description={nearby.metar.observed_at ? observedLine(nearby.metar.observed_at) : undefined}
                        value={nearbyCategory ? <span className="font-semibold text-foreground">{nearbyCategory}</span> : undefined}
                      />
                      {nearby.metar.raw && <ListRow title={<span className="font-mono break-words">{nearby.metar.raw}</span>} />}
                    </ListGroup>
                  </div>
                )}
              </div>
            )}
          </CardTabPanel>

          <CardTabPanel value="runways" className="space-y-0">
            {place && (
              <div data-testid="place-runways">
                <ListGroup>
                  {place.pattern?.altitude_ft != null && (
                    <ListRow
                      media={<RowBadge colour={BADGE.runway}><Repeat /></RowBadge>}
                      title="Pattern altitude"
                      // 1,000 ft above the field where none is published (AIM 4-3-3).
                      description={place.pattern.published ? "As the FAA publishes it" : "1,000 ft above the field: none published"}
                      value={<span className="font-semibold text-foreground">{feet(place.pattern.altitude_ft)}</span>} data-testid="place-pattern"
                    />
                  )}
                  {place.runways.length ? place.runways.map((r, i) => <RunwayRow key={`${r.ends}-${i}`} runway={r} />) : <ListRow title="None listed" />}
                </ListGroup>
              </div>
            )}
          </CardTabPanel>

          <CardTabPanel value="diagrams" className="space-y-0">
            {place && (
              <div data-testid="place-charts">
                <PillSection title="Airport">
                  <ListGroup>
                    {!place.airport_diagram_url && !place.airport_diagram_cycle && !sketched && (
                      // Drawn by the FAA for the fields with a tower or a busy
                      // ramp; most small fields have none, and are sketched.
                      <ListRow muted title="The FAA publishes no airport diagram for this field" />
                    )}
                    <PublicationRows
                      ident={place.ident} diagram={place.airport_diagram_url} diagramCycle={place.airport_diagram_cycle}
                      supplement={place.chart_supplement_url}
                      sketch={sketched ? { runways: place.runways, lat: place.lat, lon: place.lon } : null}
                    />
                    {procedures.filter(c => AIRPORT_CHARTS.includes(c.kind)).map(c => <TerminalChartRow key={c.url} chart={c} airport={place.ident} />)}
                  </ListGroup>
                </PillSection>
                {/* The approaches, departures, arrivals and minimums in this
                    cycle's d-TPP, at the pilot's ask, as the FAA's PDFs. */}
                {[...CHART_GROUPS, { title: "Other", kinds: procedures.map(c => c.kind).filter(k => !GROUPED.has(k)) }].map(g => {
                  const charts = procedures.filter(c => g.kinds.includes(c.kind));
                  return charts.length > 0 && (
                    <div key={`${place.ident}-${g.title}`} data-chart-group={g.title} className="scroll-mt-16 pt-5">
                      {/* The first three, the title the rest (FirstFew); all
                          the approaches where the route's Approaches opened
                          the card on them. */}
                      <FirstFew
                        title={g.title} open={startOn === "approaches" && g.title === "Approaches"}
                        rows={charts.map(c => <TerminalChartRow key={c.url} chart={c} airport={place.ident} />)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </CardTabPanel>
        </Tabs>
      )}
      {isLoading && !known && <p className={cn("pt-4 text-muted-foreground", TEXT.prose)}>Fetching the airport…</p>}
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

/** The star that adds an airport to Favorites (components/Favorites), a
 *  round button beside the card's close, filled in iOS's yellow while it
 *  is one, as Maps' are. It is there from the card's first frame, as a Favorite or not by
 *  the ident asked for, and a tap is kept for when the card's answer has
 *  the field's name and place to keep. */
function FavoriteButton({ ident, place, className }: { ident: string; place: AirportPlace | null; className?: string }) {
  const mine = place?.ident ?? ident;
  const kept = usePreferences(s => s.favoriteAirports.some(a => sameField(a.ident, mine)));
  const toggle = usePreferences(s => s.toggleFavoriteAirport);
  return (
    // On or off by aria-pressed itself, not a stock Toggle's data-state:
    // the round button is a tooltip's trigger, whose own data-state
    // ("closed") would take the Toggle's place.
    <RoundButton
      label={kept ? "Remove from Favorites" : "Add to Favorites"} aria-pressed={kept} disabled={!place}
      onClick={() => { if (place) toggle({ ident: place.ident, name: place.name, municipality: place.municipality, lat: place.lat, lon: place.lon }); }}
      className={className} data-testid="place-favorite"
    >
      <Star className={cn("size-5", kept && FAVORITE_STAR_ON)} strokeWidth={2} />
    </RoundButton>
  );
}
