import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, Star, Compass, Crosshair, Fan, Gauge, History, IdCard, MoveVertical, Plane, PlaneTakeoff, Radio, Route,
  Ruler, Share, UserRound,
} from "lucide-react";
import { cn } from "cn";
import { CardClose, CardTop, PanelCard } from "../../../components/PanelCard";
import { useCardTitle } from "../../../components/mapChrome";
import { PillSection } from "../../../components/Favorites";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { RowBadge } from "../../../components/RowBadge";
import RoundButton from "../../../components/RoundButton";
import { usePreferences, type KeptAircraft } from "../../../lib/preferences";
import { compassPoint } from "../../../lib/compass";
import { bearingDeg, distanceNm } from "../../../lib/geo";
import { useOwnShip } from "../../../lib/map/ownShip";
import { carriedOn, closestApproach } from "../../../lib/map/traffic";
import { useTracking } from "../../../lib/map/tracking";
import type { AircraftRegistration } from "../../../lib/api/types";
import { flightQuery, routeQuery } from "../../../lib/queryClient";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { altFt, bearing, grouped } from "../../../lib/units";
import { clockTime } from "../format";
import PastFlights from "./PastFlights";
import TrailSketch from "./TrailSketch";
import { api } from "../../../lib/api/client";
import { CardAction } from "./CardAction";
import { CardTabBar, CardTabPanel } from "../../../components/CardTabs";
import { useCardTab } from "../../../lib/cardTab";
import { Tabs } from "../../../components/ui/tabs";

/** The card's tabs, at the pilot's ask, where its groups ran one under
 *  another: what it is doing now, its flights of the last days (each
 *  replayed), and what it is -- named Now, Activity and Info at the
 *  owner's ask. */
const FLIGHT_TABS = [
  { value: "now", label: "Now" },
  // Flights, at the owner's pick of the redesign (it read Activity).
  { value: "activity", label: "Flights" },
  { value: "info", label: "Info" },
] as const;
type FlightTab = (typeof FLIGHT_TABS)[number]["value"];

/** What a squawk says, where it says more than a code: the three a
 *  pilot sets in trouble -- 7700 an emergency (AIM 6-2-2), 7500 unlawful
 *  interference (6-2-4, air piracy), 7600 two-way radio failure (6-4-2). */
/** A link to the airplane on the planner, shared where the phone can,
 *  copied where it cannot. */
async function shareFlight(name: string, hex: string) {
  const url = `${location.origin}/app/plan?flight=${hex}`;
  try {
    if (navigator.share) await navigator.share({ title: name, url });
    else await navigator.clipboard.writeText(url);
  } catch {
    // Put away, or not allowed: nothing to say.
  }
}

const SQUAWKS: Record<string, string> = { "7500": "hijack", "7600": "lost radio", "7700": "emergency" };

/** A name in the FAA's or a registry's capitals as a name is written:
 *  "AIRBUS A-321neo" as "Airbus A-321neo", "UNITED AIRLINES INC" as
 *  "United Airlines Inc"; its codes (a single letter, a figure) kept. */
const nameCase = (text: string) => text.replace(/\b[A-Z]{2,}\b/g, word => word[0] + word.slice(1).toLowerCase());

/** An ISO date as a day, in the phone's own way: "Jan 31, 2033". */
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

/** "4 s ago", "1 min ago". */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** Feet against own ship's: "500 ft above", "1,200 ft below", "level". */
function against(feet: number): string {
  const rounded = Math.round(feet / 100) * 100;
  if (rounded === 0) return "level";
  return `${altFt(Math.abs(rounded))} ft ${rounded > 0 ? "above" : "below"}`;
}

/** A field's place, for the trace's sketch, as an airport card asks for it
 *  (the same query, so a card opened on it after has it already). */
const sketchField = (ident: string | null) => ({
  queryKey: ["airport", ident], queryFn: () => api.airport(ident!), enabled: !!ident, staleTime: 5 * 60_000,
  meta: { silent: true },
  select: (field: { ident: string; lat: number; lon: number }) => ({ ident: field.ident, lat: field.lat, lon: field.lon }),
});

/**
 * An airplane being tracked, as FlightAware's flight page and ForeFlight's
 * traffic card show one: what it is and who flies it, where it took off
 * from where its track shows that, and how it is flying now -- height and
 * climb, ground speed, track, squawk, how old its report is; and, with own
 * ship on, how far and which way it is, how high against own ship and
 * when and how near it comes, which neither does. The map keeps it in the
 * middle while Follow is on (TrafficLayer), its path flown today drawn in
 * its heights' colours. Seconds-old internet data from adsb.lol's
 * receivers: for knowing what is about, not for avoiding it.
 */
export default function FlightCard({ hex, onClose, onOpenPast, onExpand, onLower, summary = false }: {
  hex: string;
  onClose: () => void;
  /** The panel all the way up, for a tab picked, and back to the pill, the
   *  open one tapped again, as an airport's card's tabs do (CardTabBar). */
  onExpand?: () => void;
  onLower?: () => void;
  /** Opens one of its past flights' own card over this one. */
  onOpenPast: (id: number) => void;
  /** At the panel's minimal size, as every card opens: its head, its
   *  actions and its route, the rest a swipe up (the airport card's). */
  summary?: boolean;
}) {
  const latest = useTracking(s => (s.latest?.plane.hex === hex ? s.latest : null));
  const follow = useTracking(s => s.follow);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const { data: detail } = useQuery(flightQuery(hex));
  // Its flight number's route, asked once a callsign is heard, with where
  // it is then, to say whether it is flying that route today.
  const callsign = latest?.plane.callsign ?? null;
  const firstAt = latest ? { lat: latest.plane.lat, lon: latest.plane.lon } : null;
  const { data: route } = useQuery(routeQuery(callsign, firstAt));
  // The report's age, counted on.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const plane = latest?.plane ?? null;
  // Opened on what it is doing now, or, not heard now -- landed, or found
  // by its registration -- on its flights; the pilot's pick kept after.
  // Back from a past flight's card (PastFlightCard), on the Activity it was
  // opened from: the tab picked is kept for the airplane while the page is.
  const tabsRef = useRef<HTMLDivElement>(null);
  const raise = onExpand && onLower ? { onExpand, onLower } : undefined;
  const [tab, setPicked] = useCardTab<FlightTab>(`flight:${hex}`, plane ? "now" : "activity");
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
  // How far and which way from own ship, where there is a fix.
  const away = fix && here ? `${distanceNm({ lat: fix.lat, lon: fix.lon }, here).toFixed(1)} nm ${compassPoint(bearingDeg({ lat: fix.lat, lon: fix.lon }, here))}` : null;
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
  // Its state under the star: an emergency's code first (AIM 6-2-2, 6-3-4,
  // 6-4-2), else climbing or descending past 300 feet a minute, else level.
  const state = squawk && SQUAWKS[squawk] ? { word: squawk, alarm: true }
    : plane ? { word: rate >= 300 ? "CLB" : rate <= -300 ? "DES" : "LVL", alarm: false } : null;
  // Where it has flown, in the diagram's place: its trace, its height and
  // speed over it.
  const trail = useMemo(() => (detail?.trail ?? []).map(p => ({ lat: p.lat, lon: p.lon, altFt: p.alt_ft ?? null })), [detail?.trail]);
  // The fields it left and is bound for, on the sketch: where its trace
  // says it took off, else its flight number's route's first; the route's
  // last where the route is the one it is flying.
  const fromIdent = detail?.departed?.ident ?? route?.airports[0]?.ident ?? null;
  const toIdent = route && route.plausible !== false && route.airports.length > 1 ? route.airports[route.airports.length - 1]!.ident : null;
  const { data: fromField } = useQuery(sketchField(fromIdent));
  const { data: toField } = useQuery(sketchField(toIdent));
  const trailBox = (className: string) => (
    <div className={cn("relative min-h-0 overflow-hidden rounded-xl bg-background/70", className)} data-testid="flight-trail">
      <TrailSketch
        points={trail} now={here && { ...here, altFt: plane?.altitude_ft ?? null }} trackDeg={plane?.track_deg ?? null}
        from={fromField ?? null} to={toField ?? null}
      />
      {plane && (
        <span className={cn("pointer-events-none absolute top-1 left-1.5 rounded-md bg-background/75 px-1 font-semibold text-foreground", TEXT.note)}>
          {plane.altitude_ft == null ? "—" : `${altFt(Math.round(plane.altitude_ft / 100) * 100)} ft`}
          {plane.speed_kt != null && <span className="font-normal"> · {Math.round(plane.speed_kt)} kt</span>}
        </span>
      )}
    </div>
  );
  return (
    <PanelCard testId="flight-card">
      {/* The airport card's head, at the owner's pick of the redesign
          ("the half layout as we discussed before"): its name; how far and
          which way, then what it is and who flies it, on lines of their
          own; where it has flown in the diagram's place, its height and
          speed on it; the star and its state (climbing, level,
          descending, or an emergency's code) in a column under the close.
          The same all the way up, the rest under it. */}
      <CardTop
        name={model ?? name} nameTestId="flight-name" nameFitTestId="flight-name-fit"
        lines={(
          <>
            {away && <p className={cn("truncate text-muted-foreground", TEXT.note)} data-testid="flight-away">{away}</p>}
            {operator && <p className={cn("line-clamp-2 text-muted-foreground", TEXT.note)} data-testid="flight-what">{operator}</p>}
          </>
        )}
        picture={trailBox("min-w-0 flex-1")}
        side={(
          <>
            <CardClose onClose={onClose} testId="flight-close" />
            <FavoriteButton kept={kept} />
            {state && (
              <span
                className={cn("flex w-9 justify-center rounded-md py-0.5 font-bold text-white", TEXT.caption, state.alarm ? "bg-destructive" : "bg-teal-700")}
                data-testid="flight-state"
              >{state.word}</span>
            )}
          </>
        )}
        columns={4}
        // Follow, its flights, the FAA's record of it, and a link to it.
        actions={(
          <>
            <CardAction
              icon={<Crosshair />} label="Follow" filled={follow} testId="flight-follow"
              onClick={() => useTracking.setState({ follow: !follow })} pressed={follow}
            />
            <CardAction icon={<History />} label="Flights" testId="flight-flights" onClick={() => { setPicked("activity"); onExpand?.(); }} />
            <CardAction icon={<IdCard />} label="Registry" testId="flight-registry" onClick={() => { setPicked("info"); onExpand?.(); }} />
            <CardAction icon={<Share />} label="Share" testId="flight-share" onClick={() => void shareFlight(name, hex)} />
          </>
        )}
      />
      {/* At the pill's size its route under the actions, or with none
          known how it flies; all the way up the pages under the actions
          instead, Now first with both, as the airport card's (the owner's
          "These tabs look nicer"). */}
      {summary && (route || plane) && <div className="pt-3">
        {route ? (
          <PillSection title={`Route (${route.airports.map(a => a.ident).join(" → ")})`} onMore={() => { setPicked("now"); onExpand?.(); }} testId="flight-summary-route">
            <ListGroup>
              <ListRow title={route.airports.map(a => a.location ?? a.name).filter(Boolean).join(" to ")} />
            </ListGroup>
          </PillSection>
        ) : plane && (
          <PillSection title="In the air" onMore={() => { setPicked("now"); onExpand?.(); }} testId="flight-summary-now">
            <ListGroup>
              <ListRow title="Ground speed · track" value={`${plane.speed_kt == null ? "—" : `${Math.round(plane.speed_kt)} kt`} · ${plane.track_deg == null ? "—" : bearing(plane.track_deg)}`} />
            </ListGroup>
          </PillSection>
        )}
      </div>}
      {!summary && (
      <Tabs value={tab} className="gap-0">
        {/* The cards' tabs (CardTabBar), the airport card's: tapped, the
            panel all the way up, as its are. */}
        <CardTabBar tabs={FLIGHT_TABS} value={tab} onPick={setPicked} testIdPrefix="flight-tab" raise={raise} barRef={tabsRef} className="mt-3" />
      <CardTabPanel value="now">
        <ListGroup title="In the air">
          {/* Not heard now -- on the ground, out of a receiver's reach, or
              found by its registration: when it was last, from its trace. */}
          {!plane && (() => {
            const last = detail?.trail?.at(-1);
            return (
              <ListRow
                data-testid="flight-not-heard"
                title={<span className="text-muted-foreground">Not heard by a receiver now</span>}
                description={last ? `Last heard ${clockTime(new Date(last.t * 1000))}${last.alt_ft != null ? ` at ${altFt(Math.round(last.alt_ft / 100) * 100)} ft` : ""}` : undefined}
              />
            );
          })()}
          {plane && (
            <>
              <ListRow
                media={<RowBadge colour={BADGE.weather}><MoveVertical /></RowBadge>} title="Altitude" data-testid="flight-altitude"
                description={Math.abs(rate) >= 100 ? `${rate > 0 ? "Climbing" : "Descending"} ${altFt(Math.abs(Math.round(rate / 100) * 100))} ft a minute` : "Level"}
                value={plane.altitude_ft == null ? "—" : (
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    {rate >= 500 && <ArrowUpRight className="size-4" aria-hidden />}{rate <= -500 && <ArrowDownRight className="size-4" aria-hidden />}
                    {altFt(Math.round(plane.altitude_ft / 25) * 25)} ft
                  </span>
                )}
              />
              <ListRow
                media={<RowBadge colour={BADGE.weather}><Gauge /></RowBadge>} title="Ground speed"
                value={<span className="font-semibold text-foreground">{plane.speed_kt == null ? "—" : `${Math.round(plane.speed_kt)} kt`}</span>}
              />
              <ListRow
                media={<RowBadge colour={BADGE.weather}><Compass /></RowBadge>} title="Track"
                value={<span className="font-semibold text-foreground">{plane.track_deg == null ? "—" : `${bearing(plane.track_deg)} true`}</span>}
              />
              {squawk && (
                <ListRow
                  media={<RowBadge colour={SQUAWKS[squawk] ? BADGE.hazard : BADGE.other}><Radio /></RowBadge>} title="Squawk"
                  data-testid="flight-squawk"
                  value={<span className={cn("font-semibold tabular-nums", SQUAWKS[squawk] ? "text-destructive-ink" : "text-foreground")}>
                    {squawk}{SQUAWKS[squawk] ? ` · ${SQUAWKS[squawk]}` : ""}
                  </span>}
                />
              )}
            </>
          )}
        </ListGroup>
        {fix && plane && here && (
          <ListGroup title="From you">
            <ListRow
              media={<RowBadge colour={BADGE.rule}><Ruler /></RowBadge>} title="Where" data-testid="flight-from-you"
              value={<span className="font-semibold text-foreground">
                {`${distanceNm({ lat: fix.lat, lon: fix.lon }, here).toFixed(1)} nm ${compassPoint(bearingDeg({ lat: fix.lat, lon: fix.lon }, here))}`}
                {fix.altitudeFt != null && plane.altitude_ft != null ? `, ${against(plane.altitude_ft - fix.altitudeFt)}` : ""}
              </span>}
            />
            {cpa && (
              <ListRow
                media={<RowBadge colour={cpa.nm < 1 && (cpa.aboveFt == null || Math.abs(cpa.aboveFt) < 1000) ? BADGE.hazard : BADGE.rule}><Crosshair /></RowBadge>}
                title="Closest" data-testid="flight-closest"
                value={<span className="font-semibold text-foreground">
                  {cpa.inMin < 0.5 ? "Now, drawing apart" : `In ${Math.round(cpa.inMin)} min`}
                  {`: ${cpa.nm.toFixed(1)} nm${cpa.aboveFt != null ? `, ${against(cpa.aboveFt)}` : ""}`}
                </span>}
              />
            )}
          </ListGroup>
        )}
        {route && (
          <ListGroup
            title="Route"
            footer="The route its flight number is scheduled to fly, from Virtual Radar Server's route database: not the flight plan filed for this flight, which the FAA does not publish openly."
          >
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
        <ListGroup
          title="Flight"
          footer={`${latest ? `Heard ${ago(now - latest.at)}. ` : ""}From adsb.lol's ADS-B receivers, under the Open Database License: seconds old, with gaps where none hears -- for knowing what is about, not for avoiding it.`}
        >
          {/* Where it took off, only where its track shows it on the
              ground at a field: no field, no row. */}
          {detail?.departed && (
            <ListRow
              media={<RowBadge colour={BADGE.weather}><PlaneTakeoff /></RowBadge>} title="Departed" data-testid="flight-departed"
              description={detail.departed.name ?? undefined}
              value={<span className="font-semibold text-foreground">{detail.departed.ident} · {clockTime(new Date(detail.departed.at * 1000))}</span>}
            />
          )}
          <ListRow title="Callsign" value={<span className="font-semibold text-foreground">{plane?.callsign ?? "—"}</span>} />
        </ListGroup>
      </CardTabPanel>
      {/* Its flights of the last days, each replayed on the map. */}
      <CardTabPanel value="activity">
        <PastFlights hex={hex} onOpen={onOpenPast} />
      </CardTabPanel>
      {/* What it is -- its make and model and who flies it, which were the
          line under its name -- its registration, and the FAA's record. */}
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
        </ListGroup>
        {detail?.faa && <FaaRegistration faa={detail.faa} />}
      </CardTabPanel>
      </Tabs>
      )}
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
    <ListGroup
      title="FAA registration"
      footer="From the FAA's aircraft registry, read each day. An owner who asked the FAA to withhold their name (49 U.S.C. 44114) is not in it."
    >
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
