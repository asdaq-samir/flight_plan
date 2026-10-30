import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChartLine, Crosshair, Fan, IdCard, Plane, Route, Star, UserRound } from "lucide-react";
import { cn } from "cn";
import { PanelCard } from "../../../components/PanelCard";
import { PhotoHead } from "../../../components/PhotoHead";
import { PhotoSlide } from "../../../components/PictureSlides";
import { FAVORITE_STAR_ON, useCardTitle } from "../../../components/mapChrome";
import RoundButton from "../../../components/RoundButton";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { PillSection } from "../../../components/Favorites";
import { RowBadge } from "../../../components/RowBadge";
import { Toggle as TogglePrimitive } from "radix-ui";
import { usePreferences, type KeptAircraft } from "../../../lib/preferences";
import { bearingDeg, distanceNm } from "../../../lib/geo";
import { useOwnFix, type Fix } from "../../../lib/map/ownShip";
import { carriedOn, closestApproach, nearInHeight } from "../../../lib/map/traffic";
import { useTracking } from "../../../lib/map/tracking";
import { alertsLine } from "../../../lib/aircraftAlerts";
import type { AircraftRegistration, TrafficAircraft } from "../../../lib/api/types";
import { planePhotoQuery } from "../../../lib/planePhoto";
import { airportQuery, flightQuery, routeQuery } from "../../../lib/queryClient";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { altFt, bearing, grouped } from "../../../lib/units";
import { awayFrom, nmAway } from "../../../lib/useAway";
import { clockTime } from "../../../lib/clock";
import AircraftAlertMenu from "./AircraftAlertMenu";
import AirplaneSketch from "./AirplaneSketch";
import { SQUAWKS } from "../../../lib/squawks";
import PastFlights from "./PastFlights";
import { lasted, shortWhen, when } from "./pastFlightFormat";
import { pastFlightQuery, pastFlightsQuery } from "./pastFlightsQuery";
import { CardAction } from "./CardAction";
import { AirplaneFigures } from "./AirplaneFigures";
import { shareOrCopy } from "../../../lib/share";

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
// A model's designator kept as written -- "PA-28", "DA-40", "A-321" -- where
// the word before its number read "Pa-28" in the card's subtitle.
const nameCase = (text: string) => text.replace(/\b[A-Z]{2,}\b(?!-\d)/g, word => word[0] + word.slice(1).toLowerCase());

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

/** The state on the summary's corner: climbing, level or descending in
 *  the air; on the ground; or an emergency's code (AIM 6-2-2, 6-3-4,
 *  6-4-2). */
interface StateBadge {
  word: string;
  tone: "air" | "ground" | "alarm";
}

const TONE = {
  air: "bg-teal-700",
  // iOS's dark grey: white on it reads at 7.7:1.
  ground: "bg-zinc-600",
  alarm: "bg-destructive",
} as const;

/** Feet against own ship's: "500 ft above", "1,200 ft below", "level". */
function against(feet: number): string {
  const rounded = Math.round(feet / 100) * 100;
  if (rounded === 0) return "level";
  return `${altFt(Math.abs(rounded))} ft ${rounded > 0 ? "above" : "below"}`;
}

/** One end of the flight in its summary: the field's ident, a tap that
 *  opens its card where there is one to open, and its town under it. */
function End({ ident, place, at, right = false, onOpen, testId, openTestId }: {
  ident: string; place?: string | null; at?: string | null; right?: boolean; onOpen?: () => void; testId?: string; openTestId?: string;
}) {
  const name = <span className={cn("max-w-full truncate font-bold", TEXT.title)}>{ident}</span>;
  return (
    <span className={cn("flex min-w-0 flex-col", right && "items-end text-right")} data-testid={testId}>
      {onOpen ? (
        <button
          type="button" onClick={onOpen} aria-label={`${ident}'s card`} data-testid={openTestId}
          // The tint, as everything tappable; its 44 points round it.
          className="relative max-w-full text-tint outline-none after:absolute after:-inset-x-2 after:-inset-y-3 focus-visible:ring-2 focus-visible:ring-ring"
        >{name}</button>
      ) : <span className="text-foreground">{name}</span>}
      {place && <span className={cn("max-w-full truncate text-muted-foreground", TEXT.note)}>{place}</span>}
      {at && <span className={cn("max-w-full truncate text-muted-foreground tabular-nums", TEXT.note)}>{at}</span>}
    </span>
  );
}

/**
 * The flight in a card under the actions, at the owner's pick of the
 * redesign (A2): where it left and where it is bound, a bar between them
 * as far along as it has flown, and how it is flying -- its height and
 * climb, its ground speed, its true track and how long it has been up --
 * or, not heard now, where its last flight landed and when. Under them an
 * emergency's code, and with own ship on, how far and which way it is and
 * when and how near it comes. Seconds-old internet data from adsb.lol's
 * receivers: for knowing what is about, not for avoiding it.
 */
function FlightSummary({ plane, badge, chip, from, to, progress, startedAt, departedAt, now, fix, here, cpa, onOpenAirport, airport }: {
  plane: TrafficAircraft | null;
  badge: StateBadge | null;
  /** Not heard now: "Landed KPSM 16:02", "Last heard 3 Oct". */
  chip: string | null;
  from: { ident: string; place: string | null } | null;
  to: { ident: string; place: string | null } | null;
  /** How far along, 0 to 1, where both ends and where it is are known. */
  progress: number | null;
  startedAt: number | null;
  departedAt: number | null;
  now: number;
  fix: Fix | null;
  here: { lat: number; lon: number } | null;
  cpa: { inMin: number; nm: number; aboveFt: number | null } | null;
  onOpenAirport?: (ident: string) => void;
  /** The field the airport tap was for: the card's Airport tile's. */
  airport: string | null;
}) {
  const rate = plane?.vertical_fpm ?? 0;
  const squawk = plane?.squawk ?? null;
  const climb = Math.abs(rate) >= 100 ? `${rate > 0 ? "↑" : "↓"} ${altFt(Math.abs(Math.round(rate / 100) * 100))} fpm` : "level";
  const flown = plane && startedAt ? lasted(now / 1000 - startedAt) : null;
  const open = (ident: string) => (onOpenAirport ? () => onOpenAirport(ident) : undefined);
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-card px-3.5 py-3 ring-1 ring-border/60" data-testid={plane ? "flight-now" : "flight-last"}>
      <div className={cn("flex items-center gap-2 font-semibold", TEXT.note)}>
        {badge && (
          <span className={cn("rounded-md px-1 font-bold text-white", TEXT.caption, TONE[badge.tone])} data-testid="flight-state">{badge.word}</span>
        )}
        <span className={plane ? "text-go-ink" : "text-muted-foreground"}>{plane ? (flown ? `In the air · ${flown}` : "In the air") : "Not heard now"}</span>
      </div>
      {from && (
        <div className="grid grid-cols-[minmax(0,auto)_minmax(2rem,1fr)_minmax(0,auto)] items-center gap-3">
          <End
            ident={from.ident} place={from.place} at={departedAt ? clockTime(new Date(departedAt * 1000)) : null}
            onOpen={from.ident !== "?" ? open(from.ident) : undefined}
            testId={departedAt ? "flight-departed" : undefined} openTestId={from.ident === airport ? "flight-airport" : undefined}
          />
          {/* As far along as it has flown, in the tint; a plain line where
              that cannot be said (no field it is bound for). */}
          <div
            className="relative h-1 rounded-full bg-foreground/15" role={progress != null ? "progressbar" : undefined}
            aria-label={progress != null ? "Of the way flown" : undefined}
            aria-valuenow={progress != null ? Math.round(progress * 100) : undefined} aria-valuemin={progress != null ? 0 : undefined} aria-valuemax={progress != null ? 100 : undefined}
          >
            {progress != null && <div className="absolute inset-y-0 left-0 rounded-full bg-tint" style={{ width: `${Math.round(progress * 100)}%` }} />}
          </div>
          <End
            right ident={to?.ident ?? "Now"} place={to?.place ?? null} onOpen={to ? open(to.ident) : undefined}
            testId={plane ? "flight-bound" : undefined} openTestId={to && to.ident === airport && to.ident !== from.ident ? "flight-airport" : undefined}
          />
        </div>
      )}
      {plane ? (
        <span className={cn("font-semibold text-foreground tabular-nums", TEXT.detail)} data-testid="flight-altitude">
          {plane.altitude_ft == null ? "—" : `${altFt(Math.round(plane.altitude_ft / 25) * 25)} ft`} {climb}
          {" · "}{plane.speed_kt == null ? "—" : `${Math.round(plane.speed_kt)} kt`}
          {/* ADS-B's track is over the ground and true, not magnetic. */}
          {plane.track_deg != null && ` · ${bearing(plane.track_deg)} true`}
        </span>
      ) : chip && (
        <span className={cn("font-semibold text-foreground", TEXT.detail)} data-testid="flight-chip">{chip}</span>
      )}
      {squawk && SQUAWKS[squawk] && (
        // An emergency's code where it is seen first (AIM 6-2-2, 6-3-4, 6-4-2).
        <span className={cn("font-semibold text-destructive-ink tabular-nums", TEXT.detail)} data-testid="flight-squawk-alarm">
          Squawk {squawk} · {SQUAWKS[squawk]}
        </span>
      )}
      {plane && fix && here && (
        <span className={cn("text-muted-foreground", TEXT.detail)} data-testid="flight-from-you">
          {`${awayFrom({ lat: fix.lat, lon: fix.lon }, here)} of you`}
          {fix.altitudeFt != null && plane.altitude_ft != null ? `, ${against(plane.altitude_ft - fix.altitudeFt)}` : ""}
          {cpa && (
            <span
              data-testid="flight-closest"
              className={cn(cpa.nm < 1 && (cpa.aboveFt == null || nearInHeight(cpa.aboveFt)) && "font-semibold text-destructive-ink")}
            >
              {" · closest "}{cpa.inMin < 0.5 ? "now, drawing apart" : `in ${Math.round(cpa.inMin)} min`}
              {`: ${nmAway(cpa.nm)}${cpa.aboveFt != null ? `, ${against(cpa.aboveFt)}` : ""}`}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** A field's town, "Chicago, IL", from the sketch's field. */
const townOf = (field: { city?: string | null; region?: string | null; name?: string | null } | null | undefined) =>
  field ? [field.city, field.region?.replace(/^US-/, "")].filter(Boolean).join(", ") || field.name || null : null;

/**
 * An airplane being tracked, as FlightAware's flight page and ForeFlight's
 * traffic card show one, laid out at the owner's pick of the cards'
 * redesign (A2, 2026-10-29), as an airport's is: its photo across the top
 * (Planespotters', its photographer named), where it has flown a swipe
 * across, its callsign large over them with what it is and who flies it;
 * Follow (the map keeps it in the middle, TrafficLayer), Alert, Debrief
 * and the star under them; its flight in a card; and one scroll of what it
 * is and its earlier flights, where they were two tabs. Seconds-old
 * internet data from adsb.lol's receivers: for knowing what is about, not
 * for avoiding it.
 */
export default function FlightCard({ hex, onClose, onOpenPast, onOpenAirport }: {
  hex: string;
  onClose: () => void;
  /** Opens one of its past flights' own card over this one: a flight from
   *  its list, or the one Debrief is for. */
  onOpenPast: (id: number) => void;
  /** Opens a field's card over this one: an end of its flight tapped. */
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
  // Its name the title over the card in the pill's bar (TabBar), as an
  // airport's ident is.
  useEffect(() => {
    useCardTitle.setState({ title: name });
    return () => useCardTitle.setState({ title: null });
  }, [name]);
  const model = detail?.description ? nameCase(detail.description) : detail?.type ?? plane?.type ?? null;
  const operator = detail?.operator ? nameCase(detail.operator) : null;
  // Its flights found (Earlier flights' list, the same question): the
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
  // Its ends: where its trace says it took off, else its flight number's
  // route's first, and the route's last where it is flying the route; not
  // heard, its last flight's ends.
  const fromIdent = plane ? detail?.departed?.ident ?? route?.airports[0]?.ident ?? null : last?.origin?.ident ?? detail?.departed?.ident ?? null;
  const toIdent = plane
    ? flying && flying.airports.length > 1 ? flying.airports[flying.airports.length - 1]!.ident : null
    : last?.destination?.ident ?? null;
  const { data: fromField } = useQuery(sketchField(fromIdent));
  const { data: toField } = useQuery(sketchField(toIdent));
  // Its state on the summary's corner, at the owner's ask: an emergency's
  // code first (AIM 6-2-2, 6-3-4, 6-4-2), else climbing or descending
  // past 300 feet a minute, else level; not heard, on the ground where its
  // last flight landed.
  // Today's trace ending on the ground says so before its flights' list
  // has the flight (the list is minutes behind the trace).
  const endOfToday = !plane ? today?.at(-1) ?? null : null;
  const badge: StateBadge | null = plane
    ? squawk && SQUAWKS[squawk] ? { word: squawk, tone: "alarm" } : { word: rate >= 300 ? "CLB" : rate <= -300 ? "DES" : "LVL", tone: "air" }
    : last?.landed || (!last && endOfToday && endOfToday.alt_ft == null) ? { word: "GND", tone: "ground" } : null;
  const chip = plane ? null
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
  // The summary's ends: flying, the field it left (or its route's first)
  // and the route's last where it flies it; not heard, its last flight's.
  const fromEnd = fromIdent ? { ident: fromIdent, place: townOf(fromField) ?? (plane ? route?.airports[0]?.location ?? null : null) } : null;
  const toEnd = toIdent ? { ident: toIdent, place: townOf(toField) ?? (plane ? flying?.airports.at(-1)?.location ?? null : null) } : null;
  // How far along, by the miles flown from the field it left against the
  // miles still to go to the one it is bound for; a flight landed all the
  // way.
  const progress = plane
    ? fromField && toField && here ? (() => {
      const done = distanceNm(fromField, here), left = distanceNm(here, toField);
      return done + left > 0 ? done / (done + left) : null;
    })() : null
    : last?.landed ? 1 : null;
  const share = () => void shareFlight(name, hex);
  // The photo first, as Maps opens a place on its photos, where
  // Planespotters has one; else the airplane's shape on the tint, a
  // quiet stand-in, not an empty box. Where it has flown a swipe across.
  const slides = [
    photo ? (
      <PhotoSlide
        key="photo" flush src={photo.src} alt={name} href={photo.link} label={`${name}'s photo on Planespotters`}
        // Planespotters' terms: the photographer named beside it.
        credit={`© ${photo.photographer} · Planespotters`} testId="flight-photo" creditTestId="flight-photo-credit"
      />
    ) : (
      <div key="none" className="flex size-full items-start justify-center bg-linear-to-b from-primary/55 to-primary/15 pt-10" data-testid="flight-photo-none">
        <Plane className="size-20 text-white/55" strokeWidth={1.25} aria-hidden="true" />
      </div>
    ),
    <AirplaneSketch
      key="trail" points={trail} now={here && plane ? { ...here, altFt: plane.altitude_ft ?? null } : null}
      // Its track now, or, not heard, its last flight's last way.
      trackDeg={plane?.track_deg ?? (trail.length > 1 ? bearingDeg(trail[trail.length - 2]!, trail[trail.length - 1]!) : null)}
      from={fromField ?? null} to={toField ?? null}
    />,
  ];
  const registration = detail?.registration ?? plane?.registration ?? null;
  return (
    <PanelCard testId="flight-card" flush>
      <PhotoHead
        title={name} testId="flight-head" titleTestId="flight-name" subtitleTestId="flight-what"
        subtitle={[model, operator].filter(Boolean).join(" · ") || "\u00a0"}
        label={`${name}: ${photo ? "its photo, and " : ""}where it has flown`}
        slides={slides} onClose={onClose} onShare={share} closeTestId="flight-close" shareTestId="flight-share"
        // As the airport card's (2026-10-29): the share at the left, the
        // star beside the close, the actions the three left.
        shareAtLeft beside={look => <FavoriteButton kept={kept} className={look} />}
      />
      <div className="grid grid-cols-3 gap-2 pt-3" data-testid="flight-actions">
        {/* Follow filled, the card's first thing to do; nothing to follow
            where it is not heard now: greyed, not pressed. */}
        <TogglePrimitive.Root asChild pressed={following} disabled={!plane} onPressedChange={on => useTracking.setState({ follow: on })}>
          <CardAction
            icon={<Crosshair />} label={following ? "Following" : "Follow"} filled pressed={following} testId="flight-follow"
            spoken={following ? `Stop following ${name}` : `Follow ${name} on the map`}
          />
        </TogglePrimitive.Root>
        <AircraftAlertMenu hex={hex} name={name} airborne={!!plane} from={fromField ?? null} to={toField ?? null} />
        <CardAction
          icon={<ChartLine />} label="Debrief" testId="flight-debrief" disabled={!debriefed}
          onClick={() => { if (debriefed) onOpenPast(debriefed.id); }}
        />
      </div>
      {/* What the pilot asked to be told of it, while it waits. */}
      {waiting && <p className={cn("pt-2 text-tint", TEXT.note)} data-testid="flight-alerts-set">{waiting}</p>}
      {(plane || last || endOfToday) && (
        <FlightSummary
          plane={plane} badge={badge} chip={chip} from={fromEnd} to={toEnd} progress={progress}
          startedAt={detail?.departed?.at ?? today?.[0]?.t ?? null} departedAt={plane ? detail?.departed?.at ?? null : null}
          now={now} fix={fix} here={here} cpa={cpa} onOpenAirport={onOpenAirport} airport={airport}
        />
      )}
      {/* What it is: who it is registered to, its type and year, its
          squawk -- the rest of what Info had after. */}
      <div className="pt-5">
        <PillSection title="Details" testId="flight-details">
          <ListGroup>
            <ListRow title="Registration" value={<span className="font-semibold text-foreground">{registration ?? "—"}</span>} />
            <ListRow
              title="Type"
              value={<span className="font-semibold text-foreground">{[detail?.type ?? plane?.type, detail?.year].filter(Boolean).join(" · ") || "—"}</span>}
            />
            {squawk && (
              <ListRow
                title="Squawk" data-testid="flight-squawk"
                value={<span className={cn("font-semibold tabular-nums", SQUAWKS[squawk] ? "text-destructive-ink" : "text-foreground")}>{squawk}{SQUAWKS[squawk] ? ` · ${SQUAWKS[squawk]}` : ""}</span>}
              />
            )}
            {detail?.faa?.owner && (
              <ListRow title="Registered to" value={<span className="font-semibold text-foreground" data-testid="flight-owner">{nameCase(detail.faa.owner)}</span>} />
            )}
            {detail?.description && (
              <ListRow title="Model" value={<span className="font-semibold text-foreground" data-testid="flight-model">{nameCase(detail.description)}</span>} />
            )}
            {detail?.operator && (
              <ListRow title="Operator" value={<span className="font-semibold text-foreground" data-testid="flight-operator">{nameCase(detail.operator)}</span>} />
            )}
            <ListRow title="ICAO address" value={<span className={cn("font-semibold text-foreground uppercase tabular-nums", TEXT.row)}>{hex}</span>} />
            <ListRow title="Callsign" value={<span className="font-semibold text-foreground">{plane?.callsign ?? "—"}</span>} />
          </ListGroup>
        </PillSection>
      </div>
      {/* The ones before the flight it is on, each replayed (PastFlights),
          and a day to look back from. */}
      <div className="pt-5">
        <PillSection title="Earlier flights" testId="flight-earlier">
          <PastFlights hex={hex} onOpen={onOpenPast} nowShown={!!plane} untitled type={detail?.type ?? plane?.type ?? past?.pages[0]?.type ?? null} />
        </PillSection>
      </div>
      <div className="flex flex-col gap-5 pt-5">
        {/* The figures the planner flies it on, the pilot's to set, where
            it is the airplane flown now (AirplaneFigures). */}
        {registration && <AirplaneFigures tail={registration} />}
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
      </div>
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

/** The star that adds the airplane to the Aircraft card's Favorites, a
 *  round button beside the card's close, filled in iOS's yellow while it
 *  is one, as the airport card's is: on or off by aria-pressed, the round
 *  button being a tooltip's trigger with its own data-state. */
function FavoriteButton({ kept, className }: { kept: KeptAircraft | null; className?: string }) {
  const starred = usePreferences(s => !!kept && s.favoriteAircraft.some(a => a.hex === kept.hex));
  const toggle = usePreferences(s => s.toggleFavoriteAircraft);
  return (
    <RoundButton
      label={starred ? "Remove from Favorites" : "Add to Favorites"} aria-pressed={starred} disabled={!kept}
      onClick={() => { if (kept) toggle(kept); }} className={className} data-testid="flight-favorite"
    >
      <Star className={cn("size-5", starred && FAVORITE_STAR_ON)} strokeWidth={2} />
    </RoundButton>
  );
}
