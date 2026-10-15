import { memo } from "react";
import { Area, ComposedChart, Line, ReferenceArea, ReferenceDot, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "../../../../components/ui/chart";
import ChartTick from "../../../../components/chartTick";
import type { RouteProfile } from "../../../../lib/api/types";
import { altFt } from "../../../../lib/units";
import { ceilingOverFloor, ceilings, type planProfile } from "./profile";

/** The sectional's airspace colours: Class B solid blue, C magenta, D
 *  blue dashed. */
// Each name in its colour as text, lightened on a dark card (index.css).
const AIRSPACE: Record<string, { stroke: string; text: string; dash?: string }> = {
  B: { stroke: "#2465b8", text: "var(--airspace-blue-text)" },
  C: { stroke: "#c0309f", text: "var(--airspace-magenta-text)" },
  D: { stroke: "#2465b8", text: "var(--airspace-blue-text)", dash: "5 4" },
};

const config = {
  ground: { label: "Ground", color: "#8b6f47" },
  plan: { label: "Plan", color: "var(--primary)" },
} satisfies ChartConfig;

/**
 * The route from the side: the ground under it, the Class B, C and D it
 * passes through as boxes from floor to ceiling, and the plan's
 * altitudes over them with its tops of climb and descent -- an EFB's
 * profile view. The plan's distances are its legs', checkpoint to
 * checkpoint, laid onto the straight route the ground is sampled along.
 * Recharts, as the console's charts are, and loaded with the section.
 */
// Drawn again only when its profile or its plan is new (memo): recharts
// measures a line's whole length at every draw.
export default memo(function ProfileChart({ profile, plan }: { profile: RouteProfile; plan: ReturnType<typeof planProfile> }) {
  const scale = plan.length_nm > 0 ? profile.length_nm / plan.length_nm : 1;
  const data = [
    ...profile.terrain.map(t => ({ x: t.along_nm, ground: t.ground_ft })),
    ...plan.points.map(p => ({ x: p.along_nm * scale, plan: p.plan_ft })),
  ].sort((a, b) => a.x - b.x);
  // The airspace's ceilings over the plan's line, as the pill's side view
  // has them (MiniProfile), at the owner's ask.
  const highest = Math.max(0, ...profile.terrain.map(t => t.ground_ft), ...plan.points.map(p => p.plan_ft), ...ceilings(profile.airspace));
  const top = Math.ceil((highest + 1500) / 1000) * 1000;
  return (
    // Its labels on SVG's own leading; its axes' figures are ChartTick's,
    // in the text's colour (recharts' own #666 was 2.8:1 on dark glass).
    <ChartContainer
      config={config} data-testid="profile-chart"
      className="aspect-auto h-48 w-full [&_text]:[line-height:normal]"
    >
      <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
        {/* Every tick drawn, plain and unmeasured, as the weight and balance
            envelope's (EnvelopeChart, ChartTick): recharts' own measured each
            in the page. */}
        <XAxis
          type="number" dataKey="x" domain={[0, profile.length_nm]} tickLine={false} axisLine={false}
          tickCount={6} interval={0} tick={props => <ChartTick {...props} format={nm => `${Math.round(nm)} nm`} />}
        />
        <YAxis
          type="number" domain={[0, top]} tickLine={false} axisLine={false} width={44}
          interval={0} tick={props => <ChartTick {...props} format={ft => (ft >= 1000 ? `${ft / 1000}k` : `${ft}`)} />}
        />
        {profile.airspace.map((a, i) => {
          const look = AIRSPACE[a.class] ?? AIRSPACE.D!;
          // Its airport's ident over its widest piece, as the pill's side
          // view has it (MiniProfile), at the owner's ask.
          const label = a.ident || `Class ${a.class}`;
          const widest = profile.airspace.every(b => (b.ident || `Class ${b.class}`) !== label || b === a || b.to_nm - b.from_nm < a.to_nm - a.from_nm);
          return (
            <ReferenceArea
              key={i} x1={a.from_nm} x2={a.to_nm} y1={a.floor_ft} y2={Math.min(a.ceiling_ft ?? top, top)}
              stroke={look.stroke} strokeDasharray={look.dash} strokeOpacity={0.8} fill={look.stroke} fillOpacity={0.08}
              ifOverflow="hidden"
              label={widest ? { value: `${label} ${ceilingOverFloor(a)}`.trim(), position: "insideTop", fontSize: 11, fontWeight: 600, fill: look.text } : undefined}
            />
          );
        })}
        <Area
          dataKey="ground" type="monotone" connectNulls isAnimationActive={false}
          stroke="var(--color-ground)" fill="var(--color-ground)" fillOpacity={0.45}
        />
        <Line dataKey="plan" type="linear" connectNulls dot={false} isAnimationActive={false} stroke="var(--color-plan)" strokeWidth={2.5} />
        {plan.marks.map((m, i) => (
          <ReferenceDot
            key={i} x={m.along_nm * scale} y={m.plan_ft} r={3.5} fill="var(--color-plan)" stroke="white"
            label={{ value: `${m.kind} ${altFt(m.plan_ft)}`, position: "top", fontSize: 11, fill: "currentColor" }}
          />
        ))}
      </ComposedChart>
    </ChartContainer>
  );
});
