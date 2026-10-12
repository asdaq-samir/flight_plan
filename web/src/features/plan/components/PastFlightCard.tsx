import { memo, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge, MoveVertical, Pause, Play, PlaneLanding, PlaneTakeoff, Route, Square, Timer } from "lucide-react";
import { Area, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import RoundButton from "../../../components/RoundButton";
import { RowBadge } from "../../../components/RowBadge";
import Segmented from "../../../components/Segmented";
import { ChartContainer, type ChartConfig } from "../../../components/ui/chart";
import { api } from "../../../lib/api/client";
import type { PastFlightPoint, PastFlightSummary } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { compassPoint } from "../../../lib/compass";
import { distanceNm } from "../../../lib/geo";
import { REPLAY_SPEEDS, pausePastFlight, playPastFlight, positionAt, stopPastFlight, usePastFlight } from "../../../lib/map/pastFlight";
import { BADGE } from "../../../lib/rowBadges";
import { TEXT } from "../../../lib/text";
import { altFt, grouped } from "../../../lib/units";
import { dayOf, lasted, legOf, statusOf, when } from "./pastFlightFormat";

/** The track log's rows shown before "All reports" is asked for. */
const LOG_ROWS = 60;

/**
 * One of an airplane's past flights, its own card over the airplane's
 * (`?past=`), at the pilot's ask: "when a flight is selected it should
 * open another card with replay options and data". Its replay -- the
 * airplane flown along its path again on the map at 10, 50 or 200 times
 * (lib/map/pastFlight) -- then its figures (off, on, how long, how high,
 * how far and how fast), then its track log, as FlightAware's: its height
 * and speed over the flight and each report. Its close goes back to the
 * airplane's card, on its Flights.
 */
export default function PastFlightCard({ hex, id, onClose }: { hex: string; id: number; onClose: () => void }) {
  // The airplane's list, which this flight was opened from, is held already.
  const { data } = useQuery({
    queryKey: ["pastFlights", hex], queryFn: () => api.trafficHistory(hex), staleTime: 5 * 60_000, meta: { silent: true },
  });
  const flight = data?.flights.find(f => f.id === id) ?? null;
  const points = usePastFlight(s => s.points);
  const off = when(flight?.off ?? id);
  return (
    <PanelCard testId="past-flight-card">
      <CardHead
        name={flight ? legOf(flight) : "Flight"} nameTestId="past-flight-name"
        line={flight ? `${dayOf(off)} · ${clockTime(off)}–${clockTime(when(flight.on))} · ${statusOf(flight)}` : dayOf(off)}
        onClose={onClose} closeTestId="past-flight-close"
      />
      {/* The replay with its graph first, so the graph is in sight as it
          plays at the half sheet, at the pilot's ask; the figures and each
          report under. */}
      <div className="space-y-5 pt-3">
        <Replay />
        {flight && <Figures flight={flight} points={points} />}
        {points.length > 1 && <TrackLog points={points} />}
      </div>
    </PanelCard>
  );
}

/** Off and on, how long, how high, how far over the ground and how fast. */
function Figures({ flight, points }: { flight: PastFlightSummary; points: PastFlightPoint[] }) {
  const flown = useMemo(() => points.slice(1).reduce((nm, p, i) => nm + distanceNm(points[i]!, p), 0), [points]);
  const hours = (flight.on - flight.off) / 3600;
  const value = (text: string) => <span className="font-semibold text-foreground tabular-nums">{text}</span>;
  return (
    <ListGroup title="Flight" footer="Times are this device's. Where it was first or last heard is where the receivers heard it, which for a small airplane is often short of the runway.">
      <ListRow
        media={<RowBadge colour={BADGE.weather}><PlaneTakeoff /></RowBadge>} title={flight.origin?.ident ?? "First heard"}
        description={flight.origin?.name ?? undefined} value={value(clockTime(when(flight.off)))} data-testid="past-flight-off"
      />
      <ListRow
        media={<RowBadge colour={BADGE.weather}><PlaneLanding /></RowBadge>}
        title={flight.in_air ? "In the air" : flight.destination?.ident ?? "Last heard"}
        description={flight.destination?.name ?? undefined} value={value(clockTime(when(flight.on)))} data-testid="past-flight-on"
      />
      <ListRow media={<RowBadge colour={BADGE.rule}><Timer /></RowBadge>} title="Time" value={value(lasted(flight.on - flight.off))} />
      <ListRow media={<RowBadge colour={BADGE.weather}><MoveVertical /></RowBadge>} title="Highest" value={value(`${altFt(flight.max_alt_ft)} ft`)} />
      {points.length > 1 && (
        <>
          <ListRow media={<RowBadge colour={BADGE.rule}><Route /></RowBadge>} title="Flown" value={value(`${Math.round(flown)} nm`)} data-testid="past-flight-flown" />
          <ListRow
            media={<RowBadge colour={BADGE.weather}><Gauge /></RowBadge>} title="Average ground speed"
            value={value(hours > 0 ? `${Math.round(flown / hours)} kt` : "—")}
          />
        </>
      )}
    </ListGroup>
  );
}

const SPEED_OPTIONS = REPLAY_SPEEDS.map(n => ({ value: String(n), label: `${n}×` }));

/** The replay's controls: play or pause, stop, and how fast. */
function Replay() {
  const points = usePastFlight(s => s.points);
  const playing = usePastFlight(s => s.playing);
  const speed = usePastFlight(s => s.speed);
  const started = usePastFlight(s => s.at !== null);
  return (
    // No title over it: the card's name says what is replayed, and the
    // room is the graph's at the half sheet.
    <ListGroup>
      <ListRow
        title={
          <span className="flex items-center gap-2">
            <RoundButton
              label={playing ? "Pause" : "Play"} onClick={playing ? pausePastFlight : playPastFlight}
              disabled={!points.length} data-testid="replay-play"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </RoundButton>
            <RoundButton label="Stop" onClick={stopPastFlight} disabled={!started} data-testid="replay-stop">
              <Square className="size-4" />
            </RoundButton>
          </span>
        }
      >
        <Segmented
          label="Replay speed" value={String(speed)} onChange={v => usePastFlight.setState({ speed: Number(v) })}
          options={SPEED_OPTIONS} testId="replay-speed"
        />
      </ListRow>
      {points.length > 1 && <ReplayChart points={points} />}
    </ListGroup>
  );
}

/** Its height and ground speed over the flight, the replay's moment
 *  marked on it and said over it -- with the controls, so the graph is in
 *  sight as it plays at the half sheet, at the pilot's ask. */
function ReplayChart({ points }: { points: PastFlightPoint[] }) {
  const second = usePastFlight(s => (s.at === null ? null : Math.floor(s.at)));
  const here = second === null ? null : positionAt(points, second);
  return (
    <div className="px-1 pt-1 pb-2" data-testid="track-log-chart">
      <p className={cn("flex justify-between px-3 pb-1 tabular-nums", TEXT.detail)}>
        <span className="text-muted-foreground">{here ? clockTime(when(here.t)) : "Altitude, ft · ground speed, kt"}</span>
        {here && (
          <span className="font-semibold text-foreground" data-testid="replay-now">
            {altFt(here.alt_ft)} ft · {here.gs_kt != null ? `${Math.round(here.gs_kt)} kt` : "—"}
            {here.track_deg != null ? ` · ${compassPoint(here.track_deg)}` : ""}
          </span>
        )}
      </p>
      <FlightChart points={points} at={second} />
    </div>
  );
}

// Green height and amber speed, as FlightAware's Track Log draws them:
// the theme's chart greys read as one line.
const chartConfig = {
  alt: { label: "Altitude", color: "#2f9e5b" },
  kt: { label: "Ground speed", color: "#e5a00d" },
} satisfies ChartConfig;

/** The chart itself: drawn again with each second of a replay, for its mark. */
const FlightChart = memo(function FlightChart({ points, at }: { points: PastFlightPoint[]; at: number | null }) {
  const data = useMemo(() => points.map(p => ({ t: p.t, alt: p.alt_ft ?? 0, kt: p.gs_kt ?? null })), [points]);
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-28 w-full">
      <ComposedChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={false} minTickGap={32}
          tickFormatter={(t: number) => clockTime(when(t))} />
        <YAxis yAxisId="alt" tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${grouped(v)}`} />
        <YAxis yAxisId="kt" orientation="right" tickLine={false} axisLine={false} width={32} />
        <Area yAxisId="alt" dataKey="alt" type="monotone" stroke="var(--color-alt)" fill="var(--color-alt)" fillOpacity={0.15}
          strokeWidth={2} isAnimationActive={false} dot={false} />
        <Line yAxisId="kt" dataKey="kt" type="monotone" stroke="var(--color-kt)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        {at !== null && <ReferenceLine yAxisId="alt" x={at} stroke="var(--tint)" strokeWidth={2} />}
      </ComposedChart>
    </ChartContainer>
  );
});

/** Each report of the flight, as FlightAware's Track Log, in the figures a
 *  pilot uses (feet, knots, degrees, feet a minute). */
function TrackLog({ points }: { points: PastFlightPoint[] }) {
  return (
    <ListGroup
      title="Track log"
      footer={`${grouped(points.length)} reports; green the altitude, amber the ground speed. Heights are GNSS where the airplane sends one, else pressure altitude.`}
    >
      <LogTable points={points} />
    </ListGroup>
  );
}

/** Each report, a row: drawn again only when the reports change (memo),
 *  not with the replay's every second -- the chart above carries that. */
const LogTable = memo(function LogTable({ points }: { points: PastFlightPoint[] }) {
  const [all, setAll] = useState(false);
  const rows = all ? points : points.slice(0, LOG_ROWS);
  return (
    <>
      <div className="overflow-x-auto px-3 pb-2">
        <table className={cn("w-full tabular-nums", TEXT.detail)} data-testid="track-log">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-1 pr-2 font-medium">Time</th><th className="pr-2 font-medium">Course</th><th className="pr-2 text-right font-medium">kt</th>
              <th className="pr-2 text-right font-medium">ft</th><th className="text-right font-medium">ft/min</th></tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.t} className="border-t border-border/60">
                <td className="py-1 pr-2">{clockTime(when(p.t))}</td>
                <td className="pr-2">{p.track_deg != null ? `${compassPoint(p.track_deg)} ${Math.round(p.track_deg)}°` : "—"}</td>
                <td className="pr-2 text-right">{p.gs_kt != null ? Math.round(p.gs_kt) : "—"}</td>
                <td className="pr-2 text-right">{p.alt_ft != null ? altFt(p.alt_ft) : "ground"}</td>
                <td className="text-right">{p.vrate_fpm != null ? grouped(p.vrate_fpm) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all && points.length > LOG_ROWS && (
        <ListRow title={<span className="text-[var(--tint)]">All {grouped(points.length)} reports</span>} onClick={() => setAll(true)} data-testid="track-log-all" />
      )}
    </>
  );
});
