import { memo, useMemo } from "react";
import { Area, ComposedChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "../../../components/ui/chart";
import type { PastFlightPoint, RouteProfile } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { grouped } from "../../../lib/units";
import { when } from "./pastFlightFormat";
import { TRACES } from "./flightTraces";
import { AIRSPACE, ceilingOverFloor, ceilings, nameFits, namedPieces } from "./navlog/profile";

// Green height and amber speed (flightTraces): the theme's chart greys
// read as one line.
const chartConfig = {
  alt: { label: TRACES.alt.label, theme: { light: TRACES.alt.light, dark: TRACES.alt.dark } },
  kt: { label: TRACES.kt.label, theme: { light: TRACES.kt.light, dark: TRACES.kt.dark } },
} satisfies ChartConfig;

/** A past flight's height and ground speed (PastFlightCard), in a chunk
 *  of its own, loaded once a flight is opened: drawn again with each
 *  second of a replay, for its mark. The plan's dry run (DryRunControls)
 *  gives the distance flown by each point (`alongNm`), and is drawn as the
 *  owner asked of it: no axes up the sides, its labels coloured as their
 *  traces said over it instead; room over the traces at the top; and
 *  across, the distance flown, not the time ("x axis can be just
 *  distance"), its mark where the moment is along the course. */
const FlightChart = memo(function FlightChart({ points, at, alongNm, airspace = null, laid }: {
  points: PastFlightPoint[];
  at: number | null;
  alongNm?: number[];
  /** The route from the side (vfr.profile), for a dry run's airspace. */
  airspace?: RouteProfile | null;
  /** Where a fraction of the way along the route is along the run, for
   *  the airspace: a dry run's own where an approach flown has made the
   *  run longer than the route near its end (runNmAt), else evenly. */
  laid?: (fraction: number) => number;
}) {
  const data = useMemo(() => points.map((p, i) => ({ t: p.t, nm: alongNm?.[i] ?? null, alt: p.alt_ft ?? 0, kt: p.gs_kt ?? null })), [points, alongNm]);
  const plain = !!alongNm;
  // The moment's distance along the course, between the points either side.
  const atNm = useMemo(() => {
    if (!alongNm || at === null || !points.length) return null;
    if (at <= points[0]!.t) return alongNm[0] ?? null;
    const i = points.findIndex(p => p.t >= at);
    if (i < 0) return alongNm.at(-1) ?? null;
    const a = points[i - 1]!, b = points[i]!;
    const f = b.t > a.t ? (at - a.t) / (b.t - a.t) : 0;
    return alongNm[i - 1]! + (alongNm[i]! - alongNm[i - 1]!) * f;
  }, [alongNm, at, points]);
  // The white space on top, a quarter again over the highest height; the
  // speed held to the chart's lower half, so the two traces read apart
  // where both run level (the owner's recording: a cruise at 3,000 ft and
  // 108 kt drew both as one line along the top).
  const headroom = (max: number) => Math.ceil(max * 1.25);
  const lowerHalf = (max: number) => Math.ceil(max * 2.2);
  // The Class B, C and D the course passes through, floor to ceiling
  // where the run crosses them, as the side view draws them (MiniProfile),
  // at the owner's ask ("Also draw the airspace on the dry run as well"):
  // the profile's distances, along the straight route, laid onto the
  // run's, as the side view lays the plan's onto the route's; the chart
  // tall enough for their ceilings, as the side view's is.
  const start = alongNm?.[0] ?? 0, runNm = (alongNm?.at(-1) ?? 0) - start;
  const route = plain && airspace && airspace.length_nm > 0 ? airspace : null;
  const pieces = route ? route.airspace.filter(a => AIRSPACE[a.class]) : [];
  const runAt = (nm: number) => {
    const fraction = route ? nm / route.length_nm : 0;
    return laid ? laid(fraction) : start + fraction * runNm;
  };
  const named = new Set([...namedPieces(pieces).values()].filter(a => nameFits(a, route?.length_nm ?? 0)));
  const tops = ceilings(pieces);
  const airspaceTop = tops.length ? Math.ceil((Math.max(...tops) + 300) / 500) * 500 : 0;
  // A name at the run's ends kept inside the chart: set from the box's
  // edge there, not its middle.
  const placed = (a: (typeof pieces)[number]) => {
    const middle = runNm > 0 ? (runAt((a.from_nm + a.to_nm) / 2) - start) / runNm : 0.5;
    return middle < 0.2 ? "insideTopLeft" : middle > 0.8 ? "insideTopRight" : "insideTop";
  };
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
      <ComposedChart data={data} margin={{ left: plain ? 12 : 0, right: plain ? 12 : 0, top: 4, bottom: 0 }}>
        {plain ? (
          <XAxis dataKey="nm" type="number" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={false} minTickGap={32}
            tickFormatter={(nm: number) => `${Math.round(nm)} nm`} />
        ) : (
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={false} minTickGap={32}
            tickFormatter={(t: number) => clockTime(when(t))} />
        )}
        <YAxis
          yAxisId="alt" hide={plain} domain={plain ? [0, (max: number) => Math.max(headroom(max), airspaceTop)] : undefined}
          tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${grouped(v)}`}
        />
        <YAxis yAxisId="kt" hide={plain} domain={plain ? [0, lowerHalf] : undefined} orientation="right" tickLine={false} axisLine={false} width={32} />
        {/* Under the traces, each name once, over its widest piece, as the
            side view's: its airport's ident with its ceiling over its floor. */}
        {pieces.map((a, i) => {
          const look = AIRSPACE[a.class]!;
          return (
            <ReferenceArea
              key={i} yAxisId="alt" x1={runAt(a.from_nm)} x2={runAt(a.to_nm)} y1={a.floor_ft} y2={a.ceiling_ft ?? undefined}
              stroke={look.stroke} strokeDasharray={look.dashed ? "5 4" : undefined} strokeOpacity={0.8} fill={look.stroke} fillOpacity={0.08}
              ifOverflow="hidden"
              label={named.has(a) ? {
                value: `${a.ident || `Class ${a.class}`} ${ceilingOverFloor(a)}`.trim(), position: placed(a), fontSize: 11, fontWeight: 600, fill: look.text,
              } : undefined}
            />
          );
        })}
        <Area yAxisId="alt" dataKey="alt" type="monotone" stroke="var(--color-alt)" fill="var(--color-alt)" fillOpacity={0.15}
          strokeWidth={2} isAnimationActive={false} dot={false} />
        <Line yAxisId="kt" dataKey="kt" type="monotone" stroke="var(--color-kt)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        {(plain ? atNm : at) !== null && <ReferenceLine yAxisId="alt" x={(plain ? atNm : at)!} stroke="var(--tint)" strokeWidth={2} />}
      </ComposedChart>
    </ChartContainer>
  );
});

export default FlightChart;
