import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChartLine, Crosshair, Fan, IdCard, Plane, Route, Share, Star, TowerControl, UserRound } from "lucide-react";
import { cn } from "cn";
import { CardClose, CardTop, PanelCard } from "../../../components/PanelCard";
import { useCardTitle } from "../../../components/mapChrome";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { RowBadge } from "../../../components/RowBadge";
import RoundButton from "../../../components/RoundButton";
import { usePreferences, type KeptAircraft } from "../../../lib/preferences";
import { bearingDeg } from "../../../lib/geo";
import { useOwnFix } from "../../../lib/map/ownShip";
import { carriedOn, closestApproach } from "../../../lib/map/traffic";
import { useTracking } from "../../../lib/map/tracking";
import { alertsLine } from "../../../lib/aircraftAlerts";
import type { AircraftRegistration } from "../../../lib/api/types";
import { planePhotoQuery } from "../../../lib/planePhoto";
import { airportQuery, flightQuery, routeQuery } from "../../../lib/queryClient";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { altFt, grouped } from "../../../lib/units";
import AircraftAlertMenu from "./AircraftAlertMenu";
import AirplaneSketch, { type SketchBadge } from "./AirplaneSketch";
import NowFlight from "./NowFlight";
import { SQUAWKS } from "../../../lib/squawks";
import PastFlights from "./PastFlights";
import { shortWhen, when } from "./pastFlightFormat";
import { pastFlightQuery, pastFlightsQuery } from "./pastFlightsQuery";
import { CardAction } from "./CardAction";
import { AirplaneFigures } from "./AirplaneFigures";
import { CardTabBar, CardTabPanel } from "../../../components/CardTabs";
import { useCardTab } from "../../../lib/cardTab";
import { useOpenCards } from "../../../lib/openCards";
import { shareOrCopy } from "../../../lib/share";
import { Tabs } from "../../../components/ui/tabs";

/** The card's tabs: its flights, the one it is on now at their head, and
 *  what it is -- at the owner's ask ("Now tab can be removed and instead
 *  flights can have the now entry on top as the latest"), where they were
 *  Now, Flights and Info. */
const FLIGHT_TABS = [
  { value: "activity", label: "Flights" },
  { value: "info", label: "Info" },
] as const;
type FlightTab = (typeof FLIGHT_TABS)[number]["value"];

/** A link to the airplane on the planner, shared where the phone can,
 *  copied where it cannot. */
async function shareFlight(name: string, hex: string) {
  try {
    await shareOrCopy({ title: name, url: `${location.origin}/app/plan?flight=${hex}` });
  } catch {
    // Put away, or not allowed: nothing to say.
  }
}

/** A name in the FAA's or a registry's capitals as a name is written:
 *  "AIRBUS A-321neo" as "Airbus A-321neo", "UNITED AIRLINES INC" as
 *  "United Airlines Inc"; its codes (a single letter, a figure) kept. */
const nameCase = (text: string) => text.replace(/\b[A-Z]{2,}\b/g, word => word[0] + word.slice(1).toLowerCase());

/** An ISO date as a day, in the phone's own way: "Jan 31, 2033". */
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

/** A field's place, for the trace's sketch, as an airport card asks for it
 *  (the same query, so a card opened on it after has it already): where it
 *  is, and its name and town for the Now entry's end. */
const sketchField = (ident: string | null) => ({
  ...airportQuery(ident ?? ""), enabled: !!ident,
  select: (field: { ident: string; lat: number; lon: number; name?: string | null; municipality?: string | null; region?: string | null }) => ({
    ident: field.ident, lat: field.lat, lon: field.lon, name: field.name ?? null, city: field.municipality ?? null, region: field.region ?? null,
  }),
});

/**
 * An airplane being tracked, as FlightAware's flight page and ForeFlight's
 * traffic card show one, laid out at the owner's pick of the redesign:
 * what it is and who flies it; beside them where it has flown, sketched,
 * its state and height on the sketch -- its flight now, or where it is
 * not heard its last -- and its photo a swipe across; the star, Follow
 * (the map keeps it in the middle, TrafficLayer) and Share in a column
 * under the close ("I want the follow and share icons just below the fav
 * icon button"); then Alert, Debrief and its airport; and its Flights,
 * the one it is on first, and what it is (Info). Seconds-old internet data
 * from adsb.lol's receivers: for knowing what is about, not for avoiding it.
 */
export default function FlightCard({ hex, onClose, onOpenPast, onOpenAirport, onExpand, onLower }: {
  hex: string;
  onClose: () => void;
  /** The panel all the way up, for a tab picked, and back to the pill, the
   *  open one tapped again, as an airport's card's tabs do (CardTabBar). */
  onExpand?: () => void;
  onLower?: () => void;
  /** Opens one of its past flights' own card over this one: a flight from
   *  its list, or the one Debrief is for. */
  onOpenPast: (id: number) => void;
  /** Opens a field's card over this one: its airport's tile. */
  onOpenAirport?: (ident: string) => void;
}) {
  const latest = useTracking(s => (s.latest?.plane.hex === hex ? s.latest : null));
  const follow = useTracking(s => s.follow);
  const fix = useOwnFix();
  const { data: detail } = useQuery(flightQuery(hex));
  // Its flight number's route, asked once a callsign is heard, with where
  // it is then, to say whether it is flying that route today.
  const callsign = latest?.plane.callsign ?? null;
  const firstAt = latest ? { lat: latest.plane.lat, lon: latest.plane.lon } : null;
  const { data: route } = useQuery(routeQuery(callsign, firstAt));
  const flying = route && route.plausible !== false ? route : null;
  // The report's age, counted on.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const plane = latest?.plane ?? null;
  const following = follow && !!plane;
  // On its Flights, the flight it is on first; the pilot's pick kept for
  // the airplane while the page is open (back from a past flight's card,
  // the tab it was opened from).
  const tabsRef = useRef<HTMLDivElement>(null);
  const raise = onExpand && onLower ? { onExpand, onLower } : undefined;
  const [tab, setPicked] = useCardTab<FlightTab>(`flight:${hex}`, "activity");
  // What is kept of it, for the Aircraft card's Recents and Favorites,
  // once it can be named: its registration, else its callsign.
  // An airplane not heard today has no trace to name it: the FAA's record
  // does, and what this browser kept of it (My Plane, a Favorite, a recent)
  // -- N654FL opened from its tile read "A89C1E", its address, at the
  // owner's report (2026-10-13), and was kept so.
  const keptBefore = usePreferences(p => [p.myAircraft, ...p.favoriteAircraft, ...p.recentAircraft].find(a => a?.hex === hex) ?? null);
  const keptName = detail?.registration ?? plane?.registration ?? detail?.faa?.n_number ?? plane?.callsign ?? keptBefore?.name ?? null;
  const keptType = detail?.type ?? plane?.type ?? keptBefore?.type ?? null;
  const kept = useMemo(() => (keptName ? { hex, name: keptName, type: keptType } : null), [hex, keptName, keptType]);
  useEffect(() => {
    if (kept) usePreferences.getState().addRecentAircraft(kept);
  }, [kept]);
  const name = plane?.callsign ?? detail?.registration ?? plane?.registration ?? detail?.faa?.n_number ?? keptBefore?.name ?? hex.toUpperCase();
  // Where it is now, carried on from its report, as the map draws it.
  const here = latest ? carriedOn(latest.plane, (now - latest.at) / 1000) : null;
  const cpa = fix && plane && here ? closestApproach(fix, { ...plane, ...here }) : null;
  const squawk = plane?.squawk ?? null;
  const rate = plane?.vertical_fpm ?? 0;
  // Its name the title over the card (TabBar), as an airport's ident is, at
  // the owner's ask ("aircraft can be similar layout"): the card's own
  // head what it is, as the FAA's and the database's names have it, and
  // who flies it.
  useEffect(() => {
    useCardTitle.setState({ title: name });
    return () => useCardTitle.setState({ title: null });
  }, [name]);
  const model = detail?.description ? nameCase(detail.description) : detail?.type ?? plane?.type ?? null;
  const operator = detail?.operator ? nameCase(detail.operator) : null;
  // Its flights found (the Flights tab's list, the same question): the
  // newest is the one it is on, or, not heard now, its last -- sketched,
  // and what Debrief opens.
  const { data: past } = useInfiniteQuery(pastFlightsQuery(hex, null));
  const newest = past?.pages[0]?.flights?.[0] ?? null;
  const current = plane && newest?.in_air ? newest : null;
  const last = plane ? null : newest;
  // Where it has flown: today's trace while it is heard, or where it
  // landed today; else its last flight's reports ("if it's not flying
  // now, sketch the last flight"), asked once it is known.
  const today = detail?.trail;
  const lastId = !plane && (today?.length ?? 0) < 2 && last ? last.id : null;
  const { data: lastFlight } = useQuery({ ...pastFlightQuery(hex, lastId ?? 0), enabled: lastId !== null });
  const flown = lastId !== null ? lastFlight?.points : today;
  const trail = useMemo(() => (flown ?? []).map(p => ({ lat: p.lat, lon: p.lon, altFt: p.alt_ft ?? null })), [flown]);
  // The fields on the sketch: where its trace says it took off, else its
  // flight number's route's first, and the route's last where it is
  // flying the route; not heard, its last flight's ends.
  const fromIdent = plane ? detail?.departed?.ident ?? route?.airports[0]?.ident ?? null : last?.origin?.ident ?? detail?.departed?.ident ?? null;
  const toIdent = plane
    ? flying && flying.airports.length > 1 ? flying.airports[flying.airports.length - 1]!.ident : null
    : last?.destination?.ident ?? null;
  const { data: fromField } = useQuery(sketchField(fromIdent));
  const { data: toField } = useQuery(sketchField(toIdent));
  // Its state on the sketch's corner, at the owner's ask: an emergency's
  // code first (AIM 6-2-2, 6-3-4, 6-4-2), else climbing or descending
  // past 300 feet a minute, else level; not heard, on the ground where its
  // last flight landed.
  // Today's trace ending on the ground says so before its flights' list
  // has the flight (the list is minutes behind the trace).
  const endOfToday = !plane ? today?.at(-1) ?? null : null;
  const badge: SketchBadge | null = plane
    ? squawk && SQUAWKS[squawk] ? { word: squawk, tone: "alarm" } : { word: rate >= 300 ? "CLB" : rate <= -300 ? "DES" : "LVL", tone: "air" }
    : last?.landed || (!last && endOfToday && endOfToday.alt_ft == null) ? { word: "GND", tone: "ground" } : null;
  const chip = plane
    ? `${plane.altitude_ft == null ? "—" : `${altFt(Math.round(plane.altitude_ft / 100) * 100)} ft`} · ${plane.speed_kt == null ? "—" : `${Math.round(plane.speed_kt)} kt`}`
    : last
      ? last.landed && last.destination ? `Landed ${last.destination.ident} ${shortWhen(when(last.on))}` : `Last heard ${shortWhen(when(last.on))}`
      : endOfToday ? `Last heard ${shortWhen(when(endOfToday.t))}` : null;
  const { data: photo } = useQuery(planePhotoQuery(hex));
  // Its airport: the field it left while it is flying, the one it landed
  // at or was last at while it is not.
  const airport = plane ? fromIdent : last?.destination?.ident ?? last?.origin?.ident ?? null;
  // Debrief: the flight it is on, once its track is in its list, else its last.
  const debriefed = current ?? last;
  const alerts = usePreferences(s => s.aircraftAlerts);
  const waiting = alertsLine(useMemo(() => alerts.filter(a => a.hex === hex), [alerts, hex]));
  // On a phone the minimized tab bar's Share is its share, in Back's place
  // (TabBar); wider, the column's third button, under Follow.
  const barShares = useOpenCards(s => s.barMinimized);
  return (
    <PanelCard testId="flight-card">
      <CardTop
        tall={!barShares}
        name={model ?? name} nameTestId="flight-name" nameFitTestId="flight-name-fit"
        lines={(
          <>
            {operator && <p className={cn("line-clamp-2 text-muted-foreground", TEXT.note)} data-testid="flight-what">{operator}</p>}
            {/* What the pilot asked to be told of it, while it waits. */}
            {waiting && <p className={cn("line-clamp-2 text-tint", TEXT.note)} data-testid="flight-alerts-set">{waiting}</p>}
          </>
        )}
        picture={(
          <AirplaneSketch
            name={name} points={trail} now={here && plane ? { ...here, altFt: plane.altitude_ft ?? null } : null}
            // Its track now, or, not heard, its last flight's last way.
            trackDeg={plane?.track_deg ?? (trail.length > 1 ? bearingDeg(trail[trail.length - 2]!, trail[trail.length - 1]!) : null)}
            from={fromField ?? null} to={toField ?? null} badge={badge} chip={chip} photo={photo ?? null}
          />
        )}
        side={(
          <>
            <CardClose onClose={onClose} onShare={() => void shareFlight(name, hex)} testId="flight-close" />
            <FavoriteButton kept={kept} />
            {/* Nothing to follow where it is not heard now: greyed, not pressed. */}
            <RoundButton
              label={following ? `Stop following ${name}` : `Follow ${name} on the map`} aria-pressed={following} disabled={!plane}
              className={cn(following && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground dark:bg-primary dark:hover:bg-primary")}
              onClick={() => useTracking.setState({ follow: !follow })} data-testid="flight-follow"
            >
              <Crosshair className="size-5" strokeWidth={2.2} />
            </RoundButton>
            {!barShares && (
              <RoundButton label={`Share ${name}`} onClick={() => void shareFlight(name, hex)} data-testid="flight-share">
                <Share className="size-5" strokeWidth={2} />
              </RoundButton>
            )}
          </>
        )}
        columns={3}
        // What to be told of it, its flight debriefed, and its airport.
        actions={(
          <>
            <AircraftAlertMenu hex={hex} name={name} airborne={!!plane} from={fromField ?? null} to={toField ?? null} />
            <CardAction
              icon={<ChartLine />} label="Debrief" testId="flight-debrief" disabled={!debriefed}
              onClick={() => { if (debriefed) onOpenPast(debriefed.id); }}
            />
            <CardAction
              icon={<TowerControl />} label={airport ?? "Airport"} spoken={airport ? `${airport}'s card` : undefined}
              testId="flight-airport" disabled={!airport || !onOpenAirport}
              onClick={() => { if (airport) onOpenAirport?.(airport); }}
            />
          </>
        )}
      />
      <Tabs value={tab} className="gap-0">
        {/* The cards' tabs (CardTabBar), the airport card's: tapped, the
            panel all the way up, as its are. */}
        <CardTabBar tabs={FLIGHT_TABS} value={tab} onPick={setPicked} testIdPrefix="flight-tab" raise={raise} barRef={tabsRef} className="mt-3" />
        {/* The flight it is on now, then the ones before it, each replayed. */}
        <CardTabPanel value="activity">
          {plane && latest && (
            <NowFlight
              plane={plane} now={now} type={detail?.type ?? plane.type ?? null}
              departed={detail?.departed ?? null} departedPlace={fromField ?? null} route={flying}
              startedAt={detail?.departed?.at ?? today?.[0]?.t ?? null} fix={fix} here={here} cpa={cpa}
            />
          )}
          <PastFlights hex={hex} onOpen={onOpenPast} nowShown={!!plane} type={detail?.type ?? plane?.type ?? past?.pages[0]?.type ?? null} />
        </CardTabPanel>
        {/* What it is -- its make and model and who flies it, its
            registration and address, its callsign and route -- and the
            FAA's record. */}
        <CardTabPanel value="info">
          <ListGroup title="Airplane">
            {detail?.description && (
              <ListRow title="Model" value={<span className="font-semibold text-foreground" data-testid="flight-model">{nameCase(detail.description)}</span>} />
            )}
            {detail?.operator && (
              <ListRow title="Operator" value={<span className="font-semibold text-foreground" data-testid="flight-operator">{nameCase(detail.operator)}</span>} />
            )}
            <ListRow title="Registration" value={<span className="font-semibold text-foreground">{detail?.registration ?? plane?.registration ?? "—"}</span>} />
            <ListRow
              title="Type"
              value={<span className="font-semibold text-foreground">{[detail?.type ?? plane?.type, detail?.year].filter(Boolean).join(" · ") || "—"}</span>}
            />
            <ListRow title="ICAO address" value={<span className={cn("font-semibold text-foreground uppercase tabular-nums", TEXT.row)}>{hex}</span>} />
            <ListRow title="Callsign" value={<span className="font-semibold text-foreground">{plane?.callsign ?? "—"}</span>} />
          </ListGroup>
          {/* The figures the planner flies it on, the pilot's to set, where
              it is the airplane flown now (AirplaneFigures). */}
          {(detail?.registration ?? plane?.registration) && <AirplaneFigures tail={(detail?.registration ?? plane?.registration)!} />}
          {route && (
            // Its flight number's scheduled route (Virtual Radar Server's
            // route database), not the flight plan filed, which the FAA does
            // not publish openly: said in the row, not in a footnote.
            <ListGroup title="Scheduled route">
              <ListRow
                media={<RowBadge colour={BADGE.approach}><Route /></RowBadge>} data-testid="flight-route"
                title={<span className="font-semibold">{route.airports.map(a => a.ident).join(" → ")}</span>}
                description={[
                  route.airports.map(a => a.location ?? a.name).filter(Boolean).join(" to "),
                  route.plausible === false ? "not where it is flying now" : null,
                ].filter(Boolean).join(" · ")}
              />
            </ListGroup>
          )}
          {detail?.faa && <FaaRegistration faa={detail.faa} />}
        </CardTabPanel>
      </Tabs>
    </PanelCard>
  );
}

/**
 * A US airplane's FAA registration, at the pilot's ask: who it is
 * registered to and where, whether the registration is in effect and
 * till when, what it is and its engine, and its airworthiness
 * certificate -- the registry's own record (vfr.registry), as the FAA's
 * N-number inquiry shows it, the owner's town and never the street.
 */
function FaaRegistration({ faa }: { faa: AircraftRegistration }) {
  const place = [faa.city, faa.state ?? (faa.country !== "US" ? faa.country : null)].filter(Boolean).join(", ");
  const power = faa.horsepower ? `${grouped(faa.horsepower)} hp`
    : faa.thrust_lb ? `${grouped(faa.thrust_lb)} lb thrust` : null;
  return (
    // The registry's own record; an owner who asked the FAA to withhold
    // their name (49 U.S.C. 44114) is not in it, and the row is left out.
    <ListGroup title="FAA registration">
      {faa.owner && (
        <ListRow
          media={<RowBadge colour={BADGE.ground}><UserRound /></RowBadge>} title="Registered to" data-testid="faa-owner"
          description={[faa.owner, faa.owner_type, place, faa.co_owners ? `and ${faa.co_owners} more` : null, faa.fractional ? "fractional" : null]
            .filter(Boolean).join(" · ")}
        />
      )}
      <ListRow
        media={<RowBadge colour={faa.standing === "lapsed" ? BADGE.hazard : BADGE.ground}><BadgeCheck /></RowBadge>}
        title={faa.n_number} data-testid="faa-status"
        description={[faa.certificate_issued && `Issued ${day(faa.certificate_issued)}`, faa.expires && `expires ${day(faa.expires)}`]
          .filter(Boolean).join(", ") || undefined}
        value={<span className={cn("font-semibold", faa.standing === "lapsed" ? "text-destructive-ink" : "text-foreground")}>{faa.status ?? "—"}</span>}
      />
      {(faa.manufacturer || faa.model) && (
        <ListRow
          media={<RowBadge colour={BADGE.tower}><Plane /></RowBadge>} title={[faa.manufacturer, faa.model].filter(Boolean).join(" ")}
          data-testid="faa-aircraft"
          description={[faa.year, faa.aircraft_type, faa.seats ? `${faa.seats} seats` : null, faa.kit ? `kit ${faa.kit}` : null,
            faa.serial ? `serial ${faa.serial}` : null].filter(Boolean).join(" · ")}
        />
      )}
      {faa.engine && (
        <ListRow
          media={<RowBadge colour={BADGE.runway}><Fan /></RowBadge>} title={faa.engine} data-testid="faa-engine"
          description={[faa.engines && faa.engines > 1 ? `${faa.engines} engines` : null, faa.engine_type, power].filter(Boolean).join(" · ")}
        />
      )}
      {faa.airworthiness && (
        <ListRow
          media={<RowBadge colour={BADGE.rule}><IdCard /></RowBadge>} title="Airworthiness" data-testid="faa-airworthiness"
          description={[faa.airworthiness, faa.airworthiness_date && `since ${day(faa.airworthiness_date)}`].filter(Boolean).join(" · ")}
        />
      )}
    </ListGroup>
  );
}

/** The star that adds the airplane to the Aircraft card's Favorites,
 *  filled in iOS's yellow while it is one, as the airport card's is. */
function FavoriteButton({ kept }: { kept: KeptAircraft | null }) {
  const starred = usePreferences(s => !!kept && s.favoriteAircraft.some(a => a.hex === kept.hex));
  const toggle = usePreferences(s => s.toggleFavoriteAircraft);
  return (
    <RoundButton
      label={starred ? "Remove from Favorites" : "Add to Favorites"} aria-pressed={starred} disabled={!kept}
      className={cn(starred && "text-[#ffcc00] hover:text-[#ffcc00] dark:text-[#ffd60a] dark:hover:text-[#ffd60a]")}
      onClick={() => { if (kept) toggle(kept); }}
      data-testid="flight-favorite"
    >
      <Star className={cn("size-5", starred && "fill-current")} strokeWidth={2} />
    </RoundButton>
  );
}
