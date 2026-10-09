import { CartesianGrid, ComposedChart, Line, ReferenceDot, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "../../../../components/ui/chart";
import ChartTick from "../../../../components/chartTick";
import type { Condition } from "../../../../lib/weightBalance";

const config = {
  envelope: { label: "Envelope", color: "var(--muted-foreground)" },
  loaded: { label: "Loaded", color: "var(--primary)" },
} satisfies ChartConfig;

/**
 * The POH's centre-of-gravity envelope -- weight up, arm across -- with
 * the takeoff and landing points on it and the line the fuel burned
 * takes between them, as the loading graph is read. Recharts, as the
 * console's charts are, loaded with the section.
 */
export default function EnvelopeChart({ envelope, takeoff, landing }: {
  envelope: [number, number][]; takeoff: Condition; landing: Condition;
}) {
  const outline = [...envelope, envelope[0]!].map(([arm, weight]) => ({ arm, envelope: weight }));
  const arms = [...envelope.map(p => p[0]), takeoff.armIn, landing.armIn];
  const weights = [...envelope.map(p => p[1]), takeoff.weightLb, landing.weightLb];
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full" data-testid="envelope-chart">
      <ComposedChart margin={{ top: 12, right: 12, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" />
        {/* Every tick drawn (`interval={0}`) and drawn plain (ChartTick):
            recharts measured each tick's words in the page, to thin them
            out and to wrap them, a forced layout apiece of a page holding
            every tab -- two seconds of a phone's main thread on opening
            Performance, measured at a quarter of a laptop's speed. Six
            ticks fit the width anyway. */}
        <XAxis
          type="number" dataKey="arm" domain={[Math.floor(Math.min(...arms)) - 1, Math.ceil(Math.max(...arms)) + 1]}
          tickLine={false} axisLine={false} tickCount={6} interval={0}
          tick={props => <ChartTick {...props} format={arm => `${arm} in`} />}
        />
        <YAxis
          type="number" domain={[Math.floor(Math.min(...weights) / 100) * 100 - 100, Math.ceil(Math.max(...weights) / 100) * 100 + 100]}
          tickLine={false} axisLine={false} width={48} tickCount={6} interval={0} tick={props => <ChartTick {...props} />}
        />
        <Line data={outline} dataKey="envelope" type="linear" dot={false} isAnimationActive={false} stroke="var(--color-envelope)" strokeWidth={2} />
        <Line
          data={[{ arm: landing.armIn, loaded: landing.weightLb }, { arm: takeoff.armIn, loaded: takeoff.weightLb }]}
          dataKey="loaded" type="linear" dot={false} isAnimationActive={false} stroke="var(--color-loaded)" strokeWidth={2}
        />
        {/* The two points' labels at an axis's 12 (chartTick), as charts
            label things, outside the type scale on purpose. */}
        <ReferenceDot x={takeoff.armIn} y={takeoff.weightLb} r={4.5} fill="var(--color-loaded)" stroke="white"
          label={{ value: "Takeoff", position: "top", className: "text-xs", fill: "currentColor" }} />
        <ReferenceDot x={landing.armIn} y={landing.weightLb} r={4.5} fill="var(--color-loaded)" stroke="white"
          label={{ value: "Landing", position: "bottom", className: "text-xs", fill: "currentColor" }} />
      </ComposedChart>
    </ChartContainer>
  );
}
