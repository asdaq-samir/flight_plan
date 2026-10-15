import { memo, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ListGroup, ListRow } from "../../components/GroupedList";
import Segmented from "../../components/Segmented";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { api, errorMessage } from "../../lib/api/client";
import { figure, METRICS, seriesOf, type Metric } from "./speedTrend";

const DEVICES = [
  { value: "phone", label: "Phone" },
  { value: "tablet", label: "Tablet" },
  { value: "desktop", label: "Desktop" },
];

const SPANS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "A year" },
];

const chartConfig = {
  field: { label: "Pilots (75th percentile)", color: "var(--chart-1)" },
  lab: { label: "Lab", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** "Oct 11" under the chart, from the day's own date. */
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`));

/**
 * The web app's speed over time, a page of the developer console's System
 * tab (DevPanel): each Core Web Vital as pilots' browsers measured it
 * (lib/speed) beside the nightly lab run (ci.yml's Speed trend), and the
 * lab's own timings, against where "good" ends. Kept by the webapp
 * (SpeedController) for 400 days.
 */
export default function SpeedPage() {
  const [device, setDevice] = useState("phone");
  const [span, setSpan] = useState("90");
  const { data, error } = useQuery({
    queryKey: ["speedTrend", span],
    queryFn: () => api.speedTrend(Number(span)),
    staleTime: 5 * 60_000,
  });
  const shown = useMemo(
    () => METRICS.map(m => ({ metric: m, points: data ? seriesOf(data, m, device) : [] })).filter(c => c.points.length > 0),
    [data, device],
  );
  return (
    <div className="space-y-6">
      <ListGroup footer="Pilots' browsers report as they leave a page; the lab run measures every night, as a phone.">
        <ListRow title="Device">
          <Segmented label="Device" value={device} onChange={setDevice} options={DEVICES} testId="speed-device" />
        </ListRow>
        <ListRow title="Over">
          <Segmented label="Over" value={span} onChange={setSpan} options={SPANS} testId="speed-span" />
        </ListRow>
      </ListGroup>
      {error && (
        <ListGroup>
          <ListRow title={<span role="status" className="text-destructive">{`The speed trend did not load: ${errorMessage(error, "the server gave no reason")}.`}</span>} />
        </ListGroup>
      )}
      {!error && !data && (
        <ListGroup><ListRow title={<span role="status" className="text-muted-foreground">Reading the speed trend…</span>} /></ListGroup>
      )}
      {data && shown.length === 0 && (
        <ListGroup>
          <ListRow title={<span role="status" className="text-muted-foreground">Nothing measured in this time on this device yet.</span>} />
        </ListGroup>
      )}
      {shown.map(({ metric, points }) => <MetricChart key={metric.title} metric={metric} points={points} />)}
    </div>
  );
}

/** One metric's chart, its latest figures said under it. Drawn again only
 *  when its points change (memo): recharts measures every line it draws. */
const MetricChart = memo(function MetricChart({ metric, points }: {
  metric: Metric;
  points: ReturnType<typeof seriesOf>;
}) {
  const last = (key: "field" | "lab") => [...points].reverse().find(p => p[key] !== undefined)?.[key];
  const field = last("field");
  const lab = last("lab");
  const footer = [
    field !== undefined && `Pilots ${figure(field, metric.unit)}`,
    lab !== undefined && `lab ${figure(lab, metric.unit)}`,
    metric.good !== undefined && `good ${metric.higher ? "from" : "within"} ${figure(metric.good, metric.unit)}`,
  ].filter(Boolean).join(" · ");
  return (
    <ListGroup title={metric.title} footer={footer}>
      <div className="px-1 py-3" data-testid={`speed-chart-${metric.field ?? metric.lab}`}>
        <ChartContainer config={chartConfig} className="aspect-auto h-36 w-full">
          <LineChart accessibilityLayer data={points} margin={{ left: 4, right: 12, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={6} minTickGap={24} tickFormatter={dayLabel} />
            <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => figure(v, metric.unit)} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={day => dayLabel(String(day))}
              formatter={(value, name) => `${chartConfig[name as "field" | "lab"].label}: ${figure(Number(value), metric.unit)}`} />} />
            {metric.good !== undefined && (
              <ReferenceLine y={metric.good} stroke="var(--muted-foreground)" strokeDasharray="4 4" ifOverflow="extendDomain" />
            )}
            {/* No entry animation: the figures are the point. */}
            {metric.field && <Line dataKey="field" stroke="var(--color-field)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
            {metric.lab && <Line dataKey="lab" stroke="var(--color-lab)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
          </LineChart>
        </ChartContainer>
      </div>
    </ListGroup>
  );
});
