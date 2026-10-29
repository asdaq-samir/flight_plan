import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePrefetchQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Cloud, CloudSun, Eye, Gauge, Lightbulb, MapPinPlus, Phone, PlaneLanding, PlaneTakeoff, Radio, Repeat, Route, Star, Thermometer, Wind } from "lucide-react";
import DirectToIcon from "../../../components/DirectToIcon";
import { FAVORITE_STAR } from "../../../components/mapChrome";
import { cn } from "cn";
import { useKeptAirport, usePreferences } from "../../../lib/preferences";
import { useOwnShip } from "../../../lib/map/ownShip";
import { Toggle as TogglePrimitive } from "radix-ui";
import { shareOrCopy } from "../../../lib/share";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { PhotoHead } from "../../../components/PhotoHead";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import { PillSection } from "../../../components/Favorites";
import { CardAction as Action } from "./CardAction";
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
import { ago, zuluTime } from "../../../lib/clock";
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
    // A field the armed services own (the FAA's airport file): one most
    // pilots may not land at without the service's permission, or a civil
    // airport sharing it -- not a description, a field to keep out of.
    place.military === "military" ? "Military, permission required" : place.military === "joint" ? "Joint use" : place.private ? "Private, permission required" : null,
  ].filter(Boolean).join(" · ");
}

/** How many frequencies the card lists before the title's All. */
const FIRST_FREQUENCIES = 3;

/** How long the panel takes to come all the way up before a section is
 *  scrolled to: the sheet's settle and a frame (SETTLE_MOST is 0.35 s). */
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

/** The card's sections, one scroll all the way up, where they were four
 *  tabs (Info, Weather, Runways, Charts): each a place to scroll to. */
type Section = "details" | "frequencies" | "runways" | "weather" | "charts";

/** The field's charts in the d-TPP under Charts, by what they are for:
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
  const tower = place.towered ? frequencyOf(place.frequencies, "TWR") : null;
  if (tower?.frequency_mhz != null) return `Tower ${mhzText(tower.frequency_mhz)}`;
  const ctaf = ctafOf(place.frequencies);
  return `${ctaf.type === "MULTICOM" ? "MULTICOM" : "CTAF"} ${mhzText(ctaf.frequency_mhz!)}`;
}

/** A section of the card's one scroll, a place the weather's line and
 *  the route's Approaches scroll to: its title over its rows (PillSection),
 *  clear of the bar that takes the picture's place over it (PhotoHead). */
function CardSection({ id, title, onMore, right, children, testId }: {
  id: Section; title: string; onMore?: () => void; right?: ReactNode; children: ReactNode; testId?: string;
}) {
  return (
    <div className="scroll-mt-16 pt-5" data-section={id}>
      <PillSection title={title} onMore={onMore} right={right} testId={testId}>{children}</PillSection>
    </div>
  );
}

/**
 * An airport's card in the panel, as a place's is in Maps, laid out at
 * the owner's pick of its redesign (A2, 2026-10-29): the field's pictures
 * across its top -- from the air, from the ground, its runways -- its ident
 * large over them with its name and town; four things to do under them --
 * fly there, land there on the way, call it, keep it as a Favorite -- and
 * the weather there in a line; and all the way up, one scroll of its
 * details, frequencies, runways, weather and charts, where they were four
 * tabs. Opened by a tap on the airport on the chart (AirportsLayer), and
 * held in the address (`?place=KDLH`), so a link lands on it.
 *
 * How far it is is from the pilot's own position when it is known, and
 * from the route's departure otherwise.
 */
export default function PlaceCard({ ident, from, onClose, onFlyHere, onAddStop, onExpand, startOn, onStarted, stop }: {
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
  /** Opened on a section: the route's Approaches opens the destination's
   *  on its approaches. `onStarted` once it has. */
  startOn?: "approaches";
  onStarted?: () => void;
  /** A stop the planner suggests here, opened from its pin on the map or
   *  the route's box: its figures under the actions (StopStrip), and Add
   *  Stop puts it in at its place. */
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
  const cardRef = useRef<HTMLDivElement>(null);
  // Fly Here tapped: the tile says so at once, a frame before the route
  // is drawn (PlanWorkspace's flyHere), which is a moment of a phone's --
  // the tap looked lost under it, at the pilot's ask for no lag. The card
  // goes with the route; it is a new card (keyed by its ident) after.
  const [flying, setFlying] = useState(false);
  // Every frequency, the title's All tapped; the first few until then.
  const [allFrequencies, setAllFrequencies] = useState(false);
  // A section scrolled to -- the weather's, from its line -- with the
  // panel all the way up first where it is not, once it has risen.
  const scrollTo = (section: Section, selector = `[data-section="${section}"]`) => {
    const card = cardRef.current?.closest<HTMLElement>('[data-testid="place-card"]');
    const up = card?.closest("[data-panel]")?.getAttribute("data-panel") === "full";
    if (!up) onExpand();
    window.setTimeout(() => card?.querySelector(selector)?.scrollIntoView({ block: "start", behavior: "smooth" }), up ? 0 : RISEN_MS);
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
    const scroll = window.setTimeout(() => {
      cardRef.current?.closest('[data-testid="place-card"]')?.querySelector('[data-chart-group="Approaches"]')
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
      calls.current.onStarted?.();
    }, RISEN_MS);
    return () => window.clearTimeout(scroll);
  }, [startOn, placeIn]);
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
  // rest the Services' at the card's foot (StopServices).
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
  // The weather in a line under the actions, as a pilot reads a report
  // first: the wind, the visibility and the ceiling (the lowest broken or
  // overcast layer, 14 CFR 1.1), and how old it is; with none of its own,
  // the model's or the nearest station's, said as such.
  const weatherLine = metar
    ? [windLine(metar), metar.visibility_sm != null ? miles(metar.visibility_sm) : null, metar.ceiling_ft == null ? "No ceiling" : `Ceiling ${feet(metar.ceiling_ft)}`].filter(Boolean).join(" · ")
    : modelled ? `Modelled: ${modelled.visibility_sm >= 10 ? "10+ sm" : miles(modelled.visibility_sm)} · ${modelled.ceiling_ft == null ? "no ceiling" : `ceiling ${feet(modelled.ceiling_ft)}`}`
      : nearby ? `Nearest report ${nearby.ident}, ${nearby.distance_nm} nm ${compassPoint(nearby.bearing_deg)}`
        : place?.weather_unavailable ? "The weather service could not be reached" : "No weather station reports from this field";
  const weatherAge = metar ? ageOf(metar.observed_at) : nearby ? ageOf(nearby.metar.observed_at) : null;
  // The longest runway open, for the details: what a pilot sizes a field by.
  const longest = place?.runways.filter(r => !r.closed && r.length_ft != null).sort((a, b) => b.length_ft! - a.length_ft!)[0] ?? null;
  const ident4 = place?.ident ?? ident;
  // The pictures, a swipe across (PictureSlides): from the air, from the
  // ground, then the runways.
  const runwaysSlide = (
    <div key="diagram" className="relative size-full bg-background">
      {/* A tap where there is nothing to draw goes to the runways'
          section where it has rows (runways whose ends are unsurveyed, a
          pattern altitude); otherwise it is words, not a button. */}
      {place && !sketched && (place.runways.length > 0 || place.pattern?.altitude_ft != null ? (
        <button
          type="button" data-testid="place-runway-sketch" onClick={() => scrollTo("runways")}
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
        // Clear of the name over its foot: the runways drawn in the top of
        // the box, where the shade is light.
        className="absolute inset-x-0 top-0 bottom-16 block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
            className="absolute inset-0 size-full bg-white object-contain dark:invert"
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
    photos?.photo && (
      <PhotoSlide
        key="photo" flush src={photos.photo.url} alt="" onOpen={() => setPicture("photo")}
        label={`${ident4} from the ground, full screen`} testId="place-photo" creditTestId="place-photo-credit"
        // Its photographer and licence, as Commons' licences ask.
        credit={`${photos.photo.credit}${photos.photo.license ? ` · ${photos.photo.license}` : ""}`}
      />
    ),
    runwaysSlide,
  ];
  const share = () => void shareOrCopy({ title: place?.name ?? ident, url: `${location.origin}/app/plan?place=${place?.ident ?? ident}` }).catch(() => {});
  const frequencies = place ? (allFrequencies ? place.frequencies : place.frequencies.slice(0, FIRST_FREQUENCIES)) : [];
  const moreFrequencies = !!place && !allFrequencies && place.frequencies.length > FIRST_FREQUENCIES;
  return (
    <PanelCard testId="place-card" flush={!(error && !place)}>
      {place || !error ? (
        <>
          {/* The head and the actions from the first frame, live once the
              answer is in: the card one shape while its answer comes, at
              the pilot's ask. */}
          <PhotoHead
            title={ident4} testId="place-head" titleTestId="place-name" subtitleTestId="place-where"
            subtitle={name && name !== ident4 ? [name, where].filter(Boolean).join(" · ") : where || " "}
            line={line ? <p className={cn("line-clamp-2 text-white/80", TEXT.note)} data-testid="place-line">{line}</p> : null}
            label={`${ident4}: ${photos ? "from the air, " : ""}${photos?.photo ? "from the ground, " : ""}its runways`}
            slides={slides} onClose={onClose} onShare={share} closeTestId="place-close" shareTestId="place-share"
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
              lists none; and the star. */}
          <div ref={cardRef} className={cn("grid gap-2 pt-3", onAddStop ? "grid-cols-4" : "grid-cols-3")} data-testid="place-actions">
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
            <FavoriteButton ident={kept?.ident ?? ident} place={place ?? null} />
          </div>
          {place && stop && <StopStrip ident={place.ident} stop={stop} />}
          {/* The weather in a line, its category in the FAA's colour; a
              tap takes the card up to the report itself. */}
          {(place || known) && (
            <div className="pt-3">
              <ListGroup>
                <ListRow
                  media={chip || undefined} title={place ? weatherLine : "…"}
                  value={weatherAge ?? undefined} chevron onClick={place ? () => scrollTo("weather") : undefined}
                  data-testid="place-weather-summary"
                />
              </ListGroup>
            </div>
          )}
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

      {place && (
        <>
          <CardSection id="details" title="Details" testId="place-details">
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
              <ListRow title="Address in Maps" description={place.address ?? undefined} href={mapsLink(place)} data-testid="place-address" />
            </ListGroup>
          </CardSection>

          {/* The first few, the title the way to every one, as every
              section's title is the way to its list in full (PillSection);
              how many of how many at its right. */}
          <CardSection
            id="frequencies" title="Frequencies" testId="place-frequencies"
            onMore={moreFrequencies ? () => setAllFrequencies(true) : undefined}
            right={moreFrequencies ? <span className={cn("text-muted-foreground", TEXT.note)}>{`${FIRST_FREQUENCIES} of ${place.frequencies.length}`}</span> : undefined}
          >
            <ListGroup>
              {frequencies.length ? frequencies.map((f, i) => (
                <FrequencyRow key={`${f.type}-${f.frequency_mhz}-${i}`} type={f.type} description={f.description} mhz={f.frequency_mhz} testId="place-frequency" />
              )) : <ListRow title="None listed" />}
              {/* What some fields read out on so many clicks of the mic on
                  the CTAF: the weather, a radio check (vfr.remarks). */}
              {place.radio_notes.map(note => (
                <ListRow key={note} media={<RowBadge colour={BADGE.traffic}><Radio /></RowBadge>} title={note} />
              ))}
            </ListGroup>
          </CardSection>
          {place.lighting.length > 0 && (
            // The field's lights, from its Chart Supplement remarks: the
            // ones a pilot turns on from the cockpit by keying the mic, and
            // with no count of clicks of their own, the standard one --
            // after the radio, as it is the mic that turns them on.
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

          <CardSection id="runways" title="Runways" testId="place-runways">
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
          </CardSection>

          <CardSection id="weather" title="Weather" testId="place-weather">
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
          </CardSection>

          <CardSection id="charts" title="Charts" testId="place-charts">
            <ListGroup title="Airport">
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
            {/* The approaches, departures, arrivals and minimums in this
                cycle's d-TPP, at the pilot's ask, as the FAA's PDFs. */}
            {[...CHART_GROUPS, { title: "Other", kinds: procedures.map(c => c.kind).filter(k => !GROUPED.has(k)) }].map(g => {
              const charts = procedures.filter(c => g.kinds.includes(c.kind));
              return charts.length > 0 && (
                <div key={g.title} data-chart-group={g.title} className="scroll-mt-16 pt-5">
                  <ListGroup title={g.title}>
                    {charts.map(c => <TerminalChartRow key={c.url} chart={c} airport={place.ident} />)}
                  </ListGroup>
                </div>
              );
            })}
          </CardSection>

          {/* What the field offers on the ground (StopServices), at the
              owner's ask for food, fuel and rest stops: its fuel is the
              details'. */}
          <StopServices ident={place.ident} withoutFuel />
        </>
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

/** The star that adds an airport to Favorites (components/Favorites), one
 *  of the card's actions, filled in iOS's yellow while it is one, as Maps'
 *  are. It is there from the card's first frame, as a Favorite or not by
 *  the ident asked for, and a tap is kept for when the card's answer has
 *  the field's name and place to keep. */
function FavoriteButton({ ident, place }: { ident: string; place: AirportPlace | null }) {
  const mine = place?.ident ?? ident;
  const kept = usePreferences(s => s.favoriteAirports.some(a => sameField(a.ident, mine)));
  const toggle = usePreferences(s => s.toggleFavoriteAirport);
  return (
    // The stock Toggle round the action, so it is on or off as Radix's is
    // (aria-pressed, data-state), the star's look of on from data-state.
    <TogglePrimitive.Root
      asChild pressed={kept} disabled={!place}
      onPressedChange={() => { if (place) toggle({ ident: place.ident, name: place.name, municipality: place.municipality, lat: place.lat, lon: place.lon }); }}
    >
      <Action
        icon={<Star className={FAVORITE_STAR} strokeWidth={2} />} label="Favorite" pressed={kept}
        spoken={kept ? "Remove from Favorites" : "Add to Favorites"} testId="place-favorite"
      />
    </TogglePrimitive.Root>
  );
}
