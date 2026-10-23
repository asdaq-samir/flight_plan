import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Cloud, CloudSun, Eye, Gauge, Lightbulb, MapPin, MapPinPlus, Phone, PlaneLanding, PlaneTakeoff, Radio, Repeat, Route, Star, Thermometer, Wind } from "lucide-react";
import DirectToIcon from "../../../components/DirectToIcon";
import { cn } from "cn";
import { useKeptAirport, usePreferences } from "../../../lib/preferences";
import { useOwnShip } from "../../../lib/map/ownShip";
import RoundButton from "../../../components/RoundButton";
import { shareOrCopy } from "../../../lib/share";
import { GLASS_BUTTON } from "../../../components/mapChrome";
import { CardClose, CardHead, CardTop, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { CardTabBar, CardTabPanel } from "../../../components/CardTabs";
import { PillSection } from "../../../components/Favorites";
import { CardAction as Action } from "./CardAction";
import { useCardTab } from "../../../lib/cardTab";
import { Tabs } from "../../../components/ui/tabs";
import { ApiError } from "../../../lib/api/client";
import type { AirportPin, AirportPlace, ClassBAirport, TerminalChart } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { distanceNm, type LatLon } from "../../../lib/geo";
import { awayFrom } from "../../../lib/useAway";
import { chipColourOf } from "../../../lib/map/flightCategory";
import { inkOn } from "../../../lib/scoreScale";
import { feet, miles } from "../../../lib/units";
import { windLine } from "../format";
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
import { useHeardMetar } from "../../../lib/map/receiver";
import { zuluTime } from "../../../lib/clock";
import { airportQuery, photosQuery } from "../../../lib/queryClient";
import { StopServices, StopStrip, type SuggestedStop } from "./StopServices";

const SketchViewer = lazy(() => import("./SketchViewer"));
// The pictures behind the diagram, full screen to pinch in on, as a chart is.
const PictureViewer = lazy(() => import("./AirportDiagramViewer"));

/** "18 nm NE", from wherever the card is measured from. */
function away(from: LatLon, to: LatLon): string {
  return distanceNm(from, to) < 0.5 ? "here" : awayFrom(from, to);
}

/** A note's own leading, iOS's Footnote's 18 on its 13 (16 on a mouse's
 *  12), for a note set in lines of its own (the elevation's pane). */
const NOTE_LEADING = "leading-4 pointer-coarse:leading-[1.125rem]";

/** The line under the name, how far the field is alone at the pilot's
 *  ask -- "18 nm NE of C81" -- the name alone over it (NameAlone),
 *  and its class and frequencies left to the tabs.
 *  Nothing where there is nothing to measure from; the elevation is the
 *  runways' box's. */
function subtitleOf(place: AirportPlace, from: { point: LatLon; name: string | null } | null): string {
  return [
    from ? (from.name ? `${away(from.point, place)} of ${from.name}` : away(from.point, place)) : null,
    // A field the armed services own (the FAA's airport file): one most
    // pilots may not land at without the service's permission, or a civil
    // airport sharing it -- not a description, a field to keep out of.
    place.military === "military" ? "Military, permission required" : place.military === "joint" ? "Joint use" : place.private ? "Private, permission required" : null,
  ].filter(Boolean).join(" · ");
}

/** How many frequencies the card shows at the pill's size. */
const SUMMARY_FREQUENCIES = 2;

/** "Frequencies (Class C)": the frequencies' title with the class of the
 *  airspace the field sits in (its airspace_class, from the FAA's NASR). */
function frequenciesTitle(place: AirportPlace): string {
  return `Frequencies${place.airspace_class ? ` (Class ${place.airspace_class})` : ""}`;
}


/** A time as reports give it: "1255Z". */
function zuluOf(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? "" : zuluTime(when);
}

/** When the report was made: "Observed 1255Z, 14 minutes ago". */
function observedLine(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  const zulu = zuluOf(at);
  const minutes = Math.max(0, Math.round((Date.now() - when.getTime()) / 60_000));
  const ago = minutes < 1 ? "just now" : minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
  return `${zulu} · ${ago}`;
}

/** The field's name alone, at the pilot's ask, its ident taken off to
 *  give the name the room (it was a pill in its airspace's look at the
 *  name's end): the map's mark carries the ident, and a screen reader
 *  still hears it. The ident in its place while the name is not known. */
function NameAlone({ name, ident }: { name: string; ident: string }) {
  return name === ident ? <>{ident}</> : <>{name}<span className="sr-only"> {ident}</span></>;
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
/** The card's pages, in the pilot's order, under the actions all the way
 *  up, at the owner's pick ("These tabs look nicer"): the radio first,
 *  what is wanted first on the way in, named Info at the owner's ask
 *  ("Rename Freq. to Info"). */
const CARD_TABS: { value: CardTab; label: string }[] = [
  { value: "radio", label: "Info" },
  { value: "weather", label: "Weather" },
  { value: "runways", label: "Runways" },
  { value: "diagrams", label: "Charts" },
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
export default function PlaceCard({ ident, from, onClose, onFlyHere, onAddStop, onExpand, onLower, startOn, onStarted, summary = false, stop }: {
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
  /** Back down to the pill: the open tab tapped again with the panel all the
   *  way up, as the route's tabs do (PanelTabs). */
  onLower: () => void;
  /** Opened on a section of a tab: the route's Approaches opens the
   *  destination's on its approaches. `onStarted` once it has. */
  startOn?: "approaches";
  onStarted?: () => void;
  /** At the panel's minimal size, as every card opens: its head, its
   *  actions and its first frequencies, the rest a swipe up -- as Apple
   *  Maps opens a place, at the owner's pick of the redesign. */
  summary?: boolean;
  /** A stop the planner suggests here, opened from its row in FPL's route
   *  (FuelStopRow): its figures at the top (StopStrip), and Add Stop puts
   *  it in at its place. */
  stop?: SuggestedStop;
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
  // The card's four tabs under its tiles, at the pilot's ask, where its
  // sections ran on one under another: the diagram first where the field
  // has one, the weather first where it has none (most small fields).
  // Kept for the airport while the page is open, as an airplane's is
  // (useCardTab).
  const [tab, setPicked] = useCardTab<CardTab>(`place:${ident}`, "radio", startOn ? "diagrams" : null);
  // A tab picked -- or Weather or Freq. on the tiles -- takes the panel all
  // the way up, as the route's tabs do; the bar back in sight if the card
  // was scrolled past it, once the panel is up and the name and tiles
  // have closed up to their own height.
  const isUp = () => tabsRef.current?.closest("[data-panel]")?.getAttribute("data-panel") === "full";
  const raise = () => {
    const up = isUp();
    onExpand();
    window.setTimeout(() => tabsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), up ? 50 : 520);
  };
  const open = (next: CardTab) => {
    setPicked(next);
    raise();
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
  }, [startOn, placeIn, setPicked]);
  // A sketch of the runways beside the name, over the Call and Address tiles, at the
  // pilot's ask -- it was the FAA's diagram cropped to that size, a
  // scatter of its lettering -- the lines under the name beside it; for
  // any field with a runway to draw. A tap shows it full screen: the FAA's
  // diagram, or for a field the FAA draws none for the sketch, as the
  // Diagrams tab's row does (SketchViewer) -- at the pilot's ask, where it
  // opened the Runways tab.
  // Named on the button, whose label hides what is inside it from a screen reader.
  const { sketchedRunways, leftOut } = useMemo(() => {
    const strips = place ? stripsOf(place.runways, place.lat, place.lon) : [];
    return { sketchedRunways: strips.map(r => r.ends.join("/")), leftOut: place ? runwaysLeftOut(place.runways, strips) : 0 };
  }, [place]);
  const sketched = sketchedRunways.length > 0;
  const [diagramOpen, setDiagramOpen] = useState<"faa" | "sketch" | null>(null);
  // Behind the diagram, a swipe to the side, at the owner's ask ("airport
  // photos swipe behind the airport diagram thumbnail", 2026-10-23): the
  // field from the air, the USGS's, and from the ground where Wikipedia has
  // a free photo (vfr.airport_photos). Which is in sight, for its dots, and
  // which is open full screen.
  const { data: photos } = useQuery({ ...photosQuery(ident), enabled: !!place });
  const [slide, setSlide] = useState(0);
  const [picture, setPicture] = useState<"aerial" | "photo" | null>(null);
  const slides = photos ? (photos.photo ? 3 : 2) : 1;
  const [noRunwaysPicture, setNoRunwaysPicture] = useState(false);
  const [elevationPane, setElevationPane] = useState<HTMLElement | null>(null);
  // The ident is in the name's head (NameWithIdent), so not here again;
  // nor the elevation, which the runways' box shows.
  // Under the distance, the ident and the town, on a line of its own at
  // the owner's ask ("move the distance above id, city").
  // The state as the FAA writes it ("MN"), not ISO's region ("US-MN").
  // Where it is, the town and the state: its ident is the title over the
  // card (TabBar), at the owner's ask ("remove the id from the
  // description, but keep the location").
  // A field with no town on record keeps the line, empty, so the card is
  // the one shape for every field.
  const where = place ? [place.municipality, place.region?.replace(/^US-/, "")].filter(Boolean).join(", ") || "\u00a0" : null;
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
  // the card's chip, "≈", only within the ten statute miles a report is
  // said of (`near`).
  const nearby = place && !metar ? place.nearby_metar ?? null : null;
  const nearbyCategory = nearby?.metar.flight_category ?? null;
  const nearCategory = nearby?.near ? nearbyCategory : null;
  // And the weather the National Weather Service's Gridded LAMP models at
  // the field itself for the hour (vfr.glmp), at the pilot's ask: the
  // chip's before a near station's, the model being of this field.
  const modelled = place && !metar ? place.modelled_weather ?? null : null;
  // A flight category only, at the pilot's ask: its own, or with none the
  // modelled one or the nearest station's, marked "≈" -- and none at all
  // where neither is had, the Weather tab saying why. Under the star, in
  // the column of buttons.
  const approximate = modelled
    ? { category: modelled.flight_category, said: "modelled for this field by the National Weather Service, not a report" }
    : nearCategory ? { category: nearCategory, said: `from the report of ${nearby?.ident}, another station, not this field's own` } : null;
  const category = weather?.category ?? approximate?.category ?? null;
  const chipColour = category ? chipColourOf({ status: "reported", category }) : null;
  const chip = category && chipColour && (
    <span
      // The words in whichever ink reads on the colour (inkOn), as the
      // map's chips are: white on a field's no-report grey was 2.6:1.
      // The star's width, at the pilot's ask, so the diagram beside the
      // column reaches as far right as it can: iOS's Caption 2, 11 on 13,
      // "MVFR" whole in it; an approximate one's "≈" on a line over it.
      className={cn("mt-1 flex w-9 shrink-0 flex-col items-center rounded-md py-0.5 font-bold", TEXT.caption)}
      style={{ backgroundColor: chipColour, color: inkOn(chipColour) }}
      data-testid="place-category"
    >
      {weather?.category ? category : (
        <>
          {/* Words for VoiceOver, which may read a bare "≈" as a symbol;
              an aria-label on a role-less span may be ignored. */}
          <span aria-hidden className="flex flex-col items-center"><span>≈</span><span>{category}</span></span>
          <span className="sr-only">About {category}, {approximate?.said}</span>
        </>
      )}
    </span>
  );
  // The runways' picture, its own button (above), where the card puts it.
  const diagramBox = (className: string) => (
    <div className={cn("relative min-h-0 overflow-hidden rounded-xl text-foreground", GLASS_BUTTON, className)}>
      <div
        data-testid="place-pictures"
        onScroll={e => setSlide(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
      <div className="relative h-full w-full shrink-0 snap-center">
      {/* A button only where the Runways tab has something to show
          (rows for runways whose ends are unsurveyed, a pattern
          altitude); otherwise the tap would open an empty tab. */}
      {place && !sketched && (place.runways.length > 0 || place.pattern?.altitude_ft != null ? (
        <button
          type="button" data-testid="place-runway-sketch" onClick={() => open("runways")}
          className={cn("absolute inset-0 flex items-end justify-end rounded-xl p-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", TEXT.note)}
        >
          No runways to draw
        </button>
      ) : (
        <div
          data-testid="place-runway-sketch"
          className={cn("absolute inset-0 flex items-end justify-end p-2 text-muted-foreground", TEXT.note)}
        >
          No runways to draw
        </div>
      ))}
      {place && sketched && (<button
        type="button" data-testid="place-runway-sketch"
        aria-label={`${place.ident} runways ${sketchedRunways.join(", ")}, north up${leftOut ? `, ${leftOut} more not drawn, their ends unsurveyed` : ""}. ${place.airport_diagram_url ? "Airport diagram" : "Runways sketch"}, full screen`}
        onClick={() => setDiagramOpen(place.airport_diagram_url ? "faa" : "sketch")}
        className="absolute inset-0 block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {/* The FAA's own diagram, cropped to its runways, where the field
            has one, at the pilot's ask; the card's sketch of them
            where it has none, or the crop cannot be had. */}
        {place.airport_diagram_cycle && !noRunwaysPicture ? (
          <img
            src={diagramRunwaysPicture(place.ident, place.airport_diagram_cycle)} alt=""
            onError={() => setNoRunwaysPicture(true)} data-testid="place-diagram-runways"
            // The diagram's white paper round it, black at night: the
            // inversion turns the paper too (a black ground under it
            // came out white).
            className="absolute inset-0 size-full rounded-xl bg-white object-contain dark:invert"
          />
        ) : (
          <RunwaySketch runways={place.runways} lat={place.lat} lon={place.lon} avoid={elevationPane} />
        )}
      </button>)}
      {/* Over the sketch, read as it is (the button's name is the
          runways'), on a pane of the card's own ground where a
          runway runs under it: "Elev 788 ft" on one line, at the
          pilot's ask (it was tried with "Elev" over the figure);
          the word lighter than its figure (by weight, not a grey
          that loses contrast on the glass), and "Elevation" in
          full to a screen reader. */}
      {place?.elevation_ft != null && (
        <span
          ref={setElevationPane}
          className={cn("pointer-events-none absolute top-1 left-1.5 rounded-md bg-background/75 px-1 font-semibold text-foreground", TEXT.note, NOTE_LEADING)}
          data-testid="place-elevation"
        >
          <span aria-hidden="true" className="font-normal">Elev </span>
          <span className="sr-only">Elevation </span>{feet(place.elevation_ft)}
        </span>
      )}
      </div>
      {photos && (
        <div className="relative h-full w-full shrink-0 snap-center">
          <button
            type="button" onClick={() => setPicture("aerial")} data-testid="place-aerial"
            aria-label={`${place?.ident ?? ident} from the air, full screen`}
            className="absolute inset-0 block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <img src={photos.aerial_url} alt="" loading="lazy" className="size-full rounded-xl object-cover" />
          </button>
        </div>
      )}
      {photos?.photo && (
        <div className="relative h-full w-full shrink-0 snap-center">
          <button
            type="button" onClick={() => setPicture("photo")} data-testid="place-photo"
            aria-label={`${place?.ident ?? ident} from the ground, full screen`}
            className="absolute inset-0 block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <img src={photos.photo.url} alt="" loading="lazy" className="size-full rounded-xl object-cover" />
          </button>
          {/* Its photographer and licence, as Commons' licences ask. */}
          <span className={cn("pointer-events-none absolute right-1 bottom-1 max-w-[90%] truncate rounded bg-black/55 px-1 text-white", TEXT.caption)} data-testid="place-photo-credit">
            {photos.photo.credit}{photos.photo.license ? ` · ${photos.photo.license}` : ""}
          </span>
        </div>
      )}
      </div>
      {/* Which picture is in sight, as iOS's page dots say. */}
      {slides > 1 && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center gap-1">
          {Array.from({ length: slides }, (_, i) => (
            <span key={i} className={cn("size-1.5 rounded-full shadow-[0_0_2px_rgba(0,0,0,.6)]", i === slide ? "bg-white" : "bg-white/45")} />
          ))}
        </div>
      )}
    </div>
  );
  return (
    <PanelCard testId="place-card">
      <Tabs value={tab} className="gap-0">
      {/* The name, the sketch and the actions, the owner's pick of the
          redesign (1b, "the half layout as we discussed before"): the card
          at the pill's size, and the same, where it was, all the way up,
          the rest under it -- the owner's "the top half stay the same as
          half card", so a drag up only adds below. */}
      {place || !error ? (
        // Three columns, at the pilot's ask (CardTop): the name, the
        // runways' sketch, and at the right the close, the star and the
        // weather's chip one over another, the close where every panel's
        // is (MapPanel's --corner-line). The sketch between the name and
        // them, from the card's top down to the tiles, the field's
        // elevation in its top left ("Elev 788 ft"); under the name how far
        // it is, then the ident and the town. The same for every field, so
        // the card keeps its layout whatever the field.
        <CardTop
          name={<NameAlone name={place?.name ?? known?.name ?? kept?.name ?? ident} ident={place?.ident ?? ident} />}
          nameTestId="place-name" nameFitTestId="place-name-fit"
          lines={(
            <>
              {line && <p className={cn("line-clamp-2 text-muted-foreground", TEXT.note)} data-testid="place-line">{line}</p>}
              {where && <p className={cn("truncate text-muted-foreground", TEXT.note)} data-testid="place-where">{where}</p>}
            </>
          )}
          // The box there from the first frame, empty until the card's
          // answer is in, and for a field with no runway to draw, so the
          // card is the one shape for every field.
          picture={diagramBox("min-w-0 flex-1")}
          // From the first frame, as the actions are: the card one shape
          // while its answer comes, at the pilot's ask.
          side={(
            <>
              <CardClose
                onClose={onClose} testId="place-close"
                // The tab bar's Share on a phone, in Back's place, at the
                // owner's ask: the field's card on the planner.
                onShare={() => void shareOrCopy({ title: place?.name ?? ident, url: `${location.origin}/app/plan?place=${place?.ident ?? ident}` }).catch(() => {})}
              />
              <FavoriteButton ident={kept?.ident ?? ident} place={place ?? null} />
              {chip}
            </>
          )}
          columns={onAddStop ? 4 : 3}
          // In their places from the first frame, live once the answer is
          // in: the card stood empty below its name until then.
          actions={(
            <>
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
              {/* Call and Address, at the pilot's ask, where Weather and
                  Freq. were, which are tabs now: the field's own phone and
                  where it is on the ground, from the FAA's airport file --
                  greyed for a field it lists no phone for. */}
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
            </>
          )}
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
                title={`${place?.ident ?? ident} ${picture === "aerial" ? "from the air" : "from the ground"}`}
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
        </CardTop>
      ) : (
        <div className="flex h-[10.5rem] flex-col" data-to-edge="">
          <CardHead
            name={kept?.name ?? known?.name ?? ident} nameTestId="place-name"
            // Not found only where the planner said so: a planner out of
            // reach for a moment (restarted) read "not found" for KBUR.
            line={line} lineTestId="place-line"
            onClose={onClose} closeTestId="place-close"
          />
        </div>
      )}

      {place && stop && <StopStrip ident={place.ident} stop={stop} />}
      {/* At the pill's size its first frequencies under the actions, the
          airspace the field is in beside their title (the owner's "class C
          in parenthesis next to Frequency heading"), the title the way up
          to the rest (Info, all the way up). */}
      {summary && place && (
        <div className="pt-3">
          <PillSection title={frequenciesTitle(place)} onMore={() => { setPicked("radio"); onExpand(); }} testId="place-summary-frequencies">
            <ListGroup>
              {place.frequencies.length ? place.frequencies.slice(0, SUMMARY_FREQUENCIES).map((f, i) => (
                <FrequencyRow key={`${f.type}-${f.frequency_mhz}-${i}`} type={f.type} description={f.description} mhz={f.frequency_mhz} testId="place-frequency" />
              )) : <ListRow title="None listed" />}
            </ListGroup>
          </PillSection>
        </div>
      )}
      {/* From the first frame too, its tabs' contents coming with the
          card's answer, at the pilot's ask: the card was a shorter shape
          until then, no tabs and no star, and grew into its own as the
          answer came. Not over a card that could not be had. */}
      {!summary && !(error && !place) && (
        // The cards' tabs (CardTabBar): tapped, the panel all the way up,
        // the open one tapped again up there back to the pill. Greyed until
        // the answer comes, as the star and the actions are: a tap would
        // raise the sheet over panels with nothing in them yet.
        <CardTabBar
          tabs={CARD_TABS} value={tab} onPick={setPicked} testIdPrefix="place-tab" disabled={!place}
          raise={{ onExpand: raise, onLower }} barRef={tabsRef} className="mt-3 scroll-mt-3"
        />
      )}
      {place && !summary && (
        <>
          <CardTabPanel value="radio" className="space-y-0">
            {/* Titled as the half card's frequencies are (PillSection). */}
            <PillSection title={frequenciesTitle(place)}>
            <ListGroup>
              {place.frequencies.length ? place.frequencies.map((f, i) => (
                <FrequencyRow key={`${f.type}-${f.frequency_mhz}-${i}`} type={f.type} description={f.description} mhz={f.frequency_mhz} testId="place-frequency" />
              )) : <ListRow title="None listed" />}
              {/* What some fields read out on so many clicks of the mic on
                  the CTAF: the weather, a radio check (vfr.remarks). */}
              {place.radio_notes.map(note => (
                <ListRow key={note} media={<RowBadge colour={BADGE.traffic}><Radio /></RowBadge>} title={note} />
              ))}
            </ListGroup>
            </PillSection>
            {place.lighting.length > 0 && (
              // The field's lights, from its Chart Supplement remarks: the
              // ones a pilot turns on from the cockpit by keying the mic,
              // and with no count of clicks of their own, the standard one
              // -- with the radio, as it is the mic that turns them on.
              <div className="pt-5">
                <PillSection title="Lights">
                <ListGroup>
                  {place.lighting.map(note => (
                    <ListRow key={note} media={<RowBadge colour={BADGE.lights}><Lightbulb /></RowBadge>} title={note} data-testid="place-lighting" />
                  ))}
                  {/* The standard keying (AIM 2-1-9): the mic keyed 7 times
                      within 5 seconds for high intensity, 5 for medium, 3 for
                      low -- a row, where it was a footnote. */}
                  {place.standard_keying && (
                    <ListRow title="Keying" value={<span className="text-foreground">7 high · 5 medium · 3 low</span>} data-testid="place-keying" />
                  )}
                </ListGroup>
                </PillSection>
              </div>
            )}
            {/* What the field offers on the ground (StopServices), after
                the radio and the lights, at the owner's ask for food, fuel
                and rest stops: its own request, so the tab is not held. */}
            <StopServices ident={place.ident} />
          </CardTabPanel>

          <CardTabPanel value="diagrams">
            <ListGroup title="Airport">
              {!place.airport_diagram_url && !place.airport_diagram_cycle && !sketched && (
                // Drawn by the FAA for the fields with a tower or a busy
                // ramp; most small fields have none, and are sketched.
                <ListRow title={<span className="text-muted-foreground">The FAA publishes no airport diagram for this field</span>} />
              )}
              <PublicationRows
                ident={place.ident} diagram={place.airport_diagram_url} diagramCycle={place.airport_diagram_cycle}
                supplement={place.chart_supplement_url}
                sketch={sketched ? { runways: place.runways, lat: place.lat, lon: place.lon } : null}
              />
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
          </CardTabPanel>

          <CardTabPanel value="weather" className="space-y-0">
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
                chip -- ceiling and visibility, and that it is a model's. */}
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
                card's "≈" chip where nothing is modelled. */}
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
          </CardTabPanel>

          <CardTabPanel value="runways" className="space-y-0">
            <ListGroup>
              {place.pattern?.altitude_ft != null && (
                <ListRow
                  media={<RowBadge colour={BADGE.runway}><Repeat /></RowBadge>}
                  title="Pattern altitude"
                  description={place.pattern.published ? "As the FAA publishes it" : "1,000 ft above the field: none published"}
                  value={<span className="font-semibold text-foreground">{feet(place.pattern.altitude_ft)}</span>} data-testid="place-pattern"
                />
              )}
              {place.runways.map((r, i) => <RunwayRow key={`${r.ends}-${i}`} runway={r} />)}
            </ListGroup>
          </CardTabPanel>
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
 *  filled while it is one, as Maps' are. It is there from the card's first
 *  frame, as a Favorite or not by the ident asked for, and a tap is kept
 *  for when the card's answer has the field's name and place to keep. */
function FavoriteButton({ ident, place }: { ident: string; place: AirportPlace | null }) {
  const mine = (place?.ident ?? ident).toUpperCase();
  const kept = usePreferences(s => s.favoriteAirports.some(a => a.ident.toUpperCase() === mine));
  const toggle = usePreferences(s => s.toggleFavoriteAirport);
  return (
    // A round pane of glass, as the gear is.
    <RoundButton
      label={kept ? "Remove from Favorites" : "Add to Favorites"} aria-pressed={kept} disabled={!place}
      // Filled in iOS's yellow while it is a favorite, as a starred thing
      // is everywhere on iOS, at the pilot's ask (it was the tint).
      className={cn(kept && "text-[#ffcc00] hover:text-[#ffcc00] dark:text-[#ffd60a] dark:hover:text-[#ffd60a]")}
      onClick={() => { if (place) toggle({ ident: place.ident, name: place.name, municipality: place.municipality, lat: place.lat, lon: place.lon }); }}
      data-testid="place-favorite"
    >
      <Star className={cn("size-5", kept && "fill-current")} strokeWidth={2} />
    </RoundButton>
  );
}
