import { memo, useMemo } from "react";
import { Area, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "../../../components/ui/chart";
import type { PastFlightPoint } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { grouped } from "../../../lib/units";
import { when } from "./pastFlightFormat";
import { TRACES } from "./flightTraces";

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
const FlightChart = memo(function FlightChart({ points, at, alongNm }: { points: PastFlightPoint[]; at: number | null; alongNm?: number[] }) {
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
  // A quarter again over the highest of each, the white space on top.
  const headroom = (max: number) => Math.ceil(max * 1.25);
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
        <YAxis yAxisId="alt" hide={plain} domain={plain ? [0, headroom] : undefined} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${grouped(v)}`} />
        <YAxis yAxisId="kt" hide={plain} domain={plain ? [0, headroom] : undefined} orientation="right" tickLine={false} axisLine={false} width={32} />
        <Area yAxisId="alt" dataKey="alt" type="monotone" stroke="var(--color-alt)" fill="var(--color-alt)" fillOpacity={0.15}
          strokeWidth={2} isAnimationActive={false} dot={false} />
        <Line yAxisId="kt" dataKey="kt" type="monotone" stroke="var(--color-kt)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        {(plain ? atNm : at) !== null && <ReferenceLine yAxisId="alt" x={(plain ? atNm : at)!} stroke="var(--tint)" strokeWidth={2} />}
      </ComposedChart>
    </ChartContainer>
  );
});

export default FlightChart;
