import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Compass, Crosshair, Gauge, MoveVertical, PlaneTakeoff, Radio, Ruler } from "lucide-react";
import { cn } from "cn";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { RowBadge } from "../../../components/RowBadge";
import TogglePill from "../../../components/TogglePill";
import { compassPoint } from "../../../lib/compass";
import { bearingDeg, distanceNm } from "../../../lib/geo";
import { useOwnShip } from "../../../lib/map/ownShip";
import { carriedOn, closestApproach } from "../../../lib/map/traffic";
import { useTracking } from "../../../lib/map/tracking";
import { flightQuery } from "../../../lib/queryClient";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";
import { clockTime } from "../format";

/** What a squawk says, where it says more than a code: the three a
 *  pilot sets in trouble -- 7700 an emergency (AIM 6-2-2), 7500 unlawful
 *  interference (6-3-4), 7600 two-way radio failure (6-4-2). */
const SQUAWKS: Record<string, string> = { "7500": "hijack", "7600": "lost radio", "7700": "emergency" };

/** A name in the FAA's or a registry's capitals as a name is written:
 *  "AIRBUS A-321neo" as "Airbus A-321neo", "UNITED AIRLINES INC" as
 *  "United Airlines Inc"; its codes (a single letter, a figure) kept. */
const nameCase = (text: string) => text.replace(/\b[A-Z]{2,}\b/g, word => word[0] + word.slice(1).toLowerCase());

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
export default function FlightCard({ hex, onClose }: { hex: string; onClose: () => void }) {
  const latest = useTracking(s => (s.latest?.plane.hex === hex ? s.latest : null));
  const follow = useTracking(s => s.follow);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const { data: detail } = useQuery(flightQuery(hex));
  // The report's age, counted on.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const plane = latest?.plane ?? null;
  const name = plane?.callsign ?? detail?.registration ?? plane?.registration ?? hex.toUpperCase();
  const what = [detail?.description ? nameCase(detail.description) : plane?.type, detail?.operator ? nameCase(detail.operator) : null]
    .filter(Boolean).join(" · ");
  // Where it is now, carried on from its report, as the map draws it.
  const here = latest ? carriedOn(latest.plane, (now - latest.at) / 1000) : null;
  const cpa = fix && plane && here ? closestApproach(fix, { ...plane, ...here }) : null;
  const squawk = plane?.squawk ?? null;
  const rate = plane?.vertical_fpm ?? 0;
  return (
    <PanelCard testId="flight-card">
      <CardHead
        name={name} line={what || " "} nameTestId="flight-name" lineTestId="flight-line"
        onClose={onClose} closeTestId="flight-close"
      >
        <TogglePill
          pressed={follow} onPressedChange={on => useTracking.setState({ follow: on })}
          icon={<Crosshair />} label="Follow" testId="flight-follow"
        />
      </CardHead>
      <div className="space-y-5 pt-4">
        <ListGroup title="Now">
          {!plane && <ListRow title={<span className="text-muted-foreground">Not heard by a receiver now</span>} />}
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
                value={<span className="font-semibold text-foreground">{plane.track_deg == null ? "—" : `${String(Math.round(plane.track_deg) % 360).padStart(3, "0")}° true`}</span>}
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
          <ListRow title="Registration" value={<span className="font-semibold text-foreground">{detail?.registration ?? plane?.registration ?? "—"}</span>} />
          <ListRow
            title="Airplane"
            value={<span className="font-semibold text-foreground">{[detail?.type ?? plane?.type, detail?.year].filter(Boolean).join(" · ") || "—"}</span>}
          />
          <ListRow title="ICAO address" value={<span className={cn("font-semibold text-foreground uppercase tabular-nums", TEXT.row)}>{hex}</span>} />
        </ListGroup>
      </div>
    </PanelCard>
  );
}
