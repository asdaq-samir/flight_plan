import { memo, useMemo } from "react";
import { Area, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "../../../components/ui/chart";
import type { PastFlightPoint } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { grouped } from "../../../lib/units";
import { when } from "./pastFlightFormat";

// Green height and amber speed, as FlightAware's Track Log draws them:
// the theme's chart greys read as one line.
const chartConfig = {
  alt: { label: "Altitude", color: "#2f9e5b" },
  kt: { label: "Ground speed", color: "#e5a00d" },
} satisfies ChartConfig;

/** A past flight's height and ground speed (PastFlightCard), in a chunk
 *  of its own, loaded once a flight is opened: drawn again with each
 *  second of a replay, for its mark. */
const FlightChart = memo(function FlightChart({ points, at }: { points: PastFlightPoint[]; at: number | null }) {
  const data = useMemo(() => points.map(p => ({ t: p.t, alt: p.alt_ft ?? 0, kt: p.gs_kt ?? null })), [points]);
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
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

export default FlightChart;
