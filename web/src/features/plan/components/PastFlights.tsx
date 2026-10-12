import { memo, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Square } from "lucide-react";
import { Area, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import RoundButton from "../../../components/RoundButton";
import Segmented from "../../../components/Segmented";
import { ChartContainer, type ChartConfig } from "../../../components/ui/chart";
import { api } from "../../../lib/api/client";
import type { PastFlightPoint, PastFlightSummary } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { compassPoint } from "../../../lib/compass";
import {
  REPLAY_SPEEDS, choosePastFlight, clearPastFlight, pausePastFlight, playPastFlight, positionAt, stopPastFlight, usePastFlight,
} from "../../../lib/map/pastFlight";
import { TEXT } from "../../../lib/text";
import { altFt, grouped } from "../../../lib/units";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat 11 Oct", this device's day, written by hand as lib/clock writes times. */
const dayOf = (at: Date) => `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
const when = (s: number) => new Date(s * 1000);
/** "2 h 13 min", "41 min". */
function lasted(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** The track log's rows shown before "All reports" is asked for. */
const LOG_ROWS = 60;

/**
 * An airplane's flights of the last seven days on its card, at the
 * pilot's ask ("can we show past flights of an aircraft", with
 * FlightAware's list as the example): each from and to the fields its
 * track starts and ends at, newest first. A tap draws one on the map
 * (lib/map/pastFlight) and opens its replay -- the airplane flown along
 * it again at 10, 50 or 200 times -- and its track log, its height and
 * speed over the flight and each report, as FlightAware's Track Log.
 */
export default function PastFlights({ hex }: { hex: string }) {
  const { data, isError } = useQuery({
    queryKey: ["pastFlights", hex], queryFn: () => api.trafficHistory(hex), staleTime: 5 * 60_000, meta: { silent: true },
    // Days adsb.lol did not give just now are asked for again, a minute
    // apart, five times at most.
    refetchInterval: query => ((query.state.data?.unread_days ?? 0) > 0 && query.state.dataUpdateCount <= 5 ? 60_000 : false),
  });
  const chosen = usePastFlight(s => (s.hex === hex ? s.id : null));
  // The card closed or another airplane tracked: its past flight goes too.
  useEffect(() => () => clearPastFlight(), [hex]);
  const flights = data?.flights ?? [];
  const picked = flights.find(f => f.id === chosen) ?? null;
  return (
    <>
      <ListGroup
        title="Past flights"
        footer="The last seven days, from adsb.lol's ADS-B receivers. A flight is taken to start or end at a field where it was heard low near it, or headed for it; where none was, it says where it was last heard."
      >
        {!data && !isError && <ListRow title={<span role="status" className="text-muted-foreground">Looking…</span>} />}
        {isError && <ListRow title={<span className={cn("text-destructive", TEXT.detail)}>Its past flights could not be had. Try again in a moment.</span>} />}
        {data && !flights.length && !data.unread_days && (
          <ListRow title={<span className="text-muted-foreground">None heard in the last seven days</span>} />
        )}
        {flights.map(flight => (
          <PastFlightRow
            key={flight.id} flight={flight} selected={flight.id === chosen}
            onPick={() => (flight.id === chosen ? clearPastFlight() : choosePastFlight(hex, flight.id))}
          />
        ))}
        {/* A gap that is adsb.lol's, not the airplane's, said as one. */}
        {!!data?.unread_days && (
          <ListRow title={
            <span className={cn("text-muted-foreground", TEXT.detail)} data-testid="past-flights-unread">
              {data.unread_days === 1 ? "One day" : `${data.unread_days} days`} could not be read from adsb.lol just now, so their flights are missing; asking again.
            </span>
          } />
        )}
      </ListGroup>
      {picked && <Replay flight={picked} />}
    </>
  );
}

const PastFlightRow = memo(function PastFlightRow({ flight, selected, onPick }: {
  flight: PastFlightSummary;
  selected: boolean;
  onPick: () => void;
}) {
  const from = flight.origin?.ident ?? "—";
  const to = flight.in_air ? "in the air" : flight.destination?.ident ?? "—";
  const off = when(flight.off), on = when(flight.on);
  const status = flight.in_air ? "In the air" : flight.landed ? "Arrived" : "Last heard";
  return (
    <ListRow
      title={<span className="font-semibold">{from} → {to}</span>}
      description={`${dayOf(off)} · ${clockTime(off)}–${clockTime(on)} · ${lasted(flight.on - flight.off)}`}
      value={<span className={cn(flight.landed || flight.in_air ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground", "font-medium")}>{status}</span>}
      onClick={onPick} aria-pressed={selected} data-testid="past-flight"
      className={selected ? "bg-[var(--tint)]/10" : undefined}
    />
  );
});

const SPEED_OPTIONS = REPLAY_SPEEDS.map(n => ({ value: String(n), label: `${n}×` }));

/** The flight picked: its replay's controls and where the airplane is in
 *  it, then its track log. */
function Replay({ flight }: { flight: PastFlightSummary }) {
  const points = usePastFlight(s => s.points);
  const playing = usePastFlight(s => s.playing);
  const speed = usePastFlight(s => s.speed);
  // The replay's moment, to the second, for the figures under it.
  const second = usePastFlight(s => (s.at === null ? null : Math.floor(s.at)));
  const here = second === null ? null : positionAt(points, second);
  const from = flight.origin?.ident ?? "—", to = flight.destination?.ident ?? "—";
  return (
    <>
      <ListGroup title={`Replay · ${from} → ${to}`} footer="Drawn on the map in its heights' colours; the replay keeps the airplane in sight.">
        <ListRow
          title={
            <span className="flex items-center gap-2">
              <RoundButton
                label={playing ? "Pause" : "Play"} onClick={playing ? pausePastFlight : playPastFlight}
                disabled={!points.length} data-testid="replay-play"
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </RoundButton>
              <RoundButton label="Stop" onClick={stopPastFlight} disabled={second === null} data-testid="replay-stop">
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
        <ListRow
          title={here ? clockTime(when(here.t)) : "Not started"}
          value={here
            ? <span className="font-semibold text-foreground tabular-nums" data-testid="replay-now">
              {altFt(here.alt_ft)} ft · {here.gs_kt != null ? `${Math.round(here.gs_kt)} kt` : "—"}
              {here.track_deg != null ? ` · ${compassPoint(here.track_deg)}` : ""}
            </span>
            : <span className="text-muted-foreground">{points.length ? "Play to fly it again" : "Reading its track…"}</span>}
        />
      </ListGroup>
      {points.length > 1 && <TrackLog points={points} at={second} />}
    </>
  );
}

// Green height and amber speed, as FlightAware's Track Log draws them:
// the theme's chart greys read as one line.
const chartConfig = {
  alt: { label: "Altitude", color: "#2f9e5b" },
  kt: { label: "Ground speed", color: "#e5a00d" },
} satisfies ChartConfig;

/** Its height and ground speed over the flight, the replay's moment
 *  marked, and each report under it: as FlightAware's Track Log, in the
 *  figures a pilot uses (feet, knots, degrees, feet a minute). */
const TrackLog = memo(function TrackLog({ points, at }: { points: PastFlightPoint[]; at: number | null }) {
  const [all, setAll] = useState(false);
  const data = useMemo(() => points.map(p => ({ t: p.t, alt: p.alt_ft ?? 0, kt: p.gs_kt ?? null })), [points]);
  const rows = all ? points : points.slice(0, LOG_ROWS);
  return (
    <ListGroup title="Track log" footer={`${grouped(points.length)} reports. Heights are GNSS where the airplane sends one, else pressure altitude.`}>
      <div className="px-1 py-3" data-testid="track-log-chart">
        <ChartContainer config={chartConfig} className="aspect-auto h-40 w-full">
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
        <p className={cn("px-3 pt-1 text-muted-foreground", TEXT.note)}>Altitude, ft (left) · ground speed, kt (right)</p>
      </div>
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
    </ListGroup>
  );
});
