import { Area, ComposedChart, Line, ReferenceArea, ReferenceDot, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "../../../../components/ui/chart";
import type { RouteProfile } from "../../../../lib/api/types";
import { altFt } from "../../../../lib/units";
import type { planProfile } from "./profile";

/** The sectional's airspace colours: Class B solid blue, C magenta, D
 *  blue dashed. */
const AIRSPACE: Record<string, { stroke: string; dash?: string }> = {
  B: { stroke: "#2465b8" },
  C: { stroke: "#b02e7c" },
  D: { stroke: "#2465b8", dash: "5 4" },
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
export default function ProfileChart({ profile, plan }: { profile: RouteProfile; plan: ReturnType<typeof planProfile> }) {
  const scale = plan.length_nm > 0 ? profile.length_nm / plan.length_nm : 1;
  const data = [
    ...profile.terrain.map(t => ({ x: t.along_nm, ground: t.ground_ft })),
    ...plan.points.map(p => ({ x: p.along_nm * scale, plan: p.plan_ft })),
  ].sort((a, b) => a.x - b.x);
  const highest = Math.max(0, ...profile.terrain.map(t => t.ground_ft), ...plan.points.map(p => p.plan_ft));
  const top = Math.ceil((highest + 1500) / 1000) * 1000;
  return (
    <ChartContainer config={config} className="aspect-auto h-48 w-full" data-testid="profile-chart">
      <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
        <XAxis
          type="number" dataKey="x" domain={[0, profile.length_nm]} tickLine={false} axisLine={false}
          tickFormatter={(nm: number) => `${Math.round(nm)}`} unit=" nm" tickCount={6}
        />
        <YAxis
          type="number" domain={[0, top]} tickLine={false} axisLine={false} width={44}
          tickFormatter={(ft: number) => (ft >= 1000 ? `${ft / 1000}k` : `${ft}`)}
        />
        {profile.airspace.map((a, i) => {
          const look = AIRSPACE[a.class] ?? AIRSPACE.D!;
          return (
            <ReferenceArea
              key={i} x1={a.from_nm} x2={a.to_nm} y1={a.floor_ft} y2={Math.min(a.ceiling_ft ?? top, top)}
              stroke={look.stroke} strokeDasharray={look.dash} strokeOpacity={0.8} fill={look.stroke} fillOpacity={0.08}
              ifOverflow="hidden"
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
}
