import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import IconButton from "../../components/IconButton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { api } from "../../lib/api/client";
import type { ModelComparisonEntry } from "../../lib/api/types";
import { useErrorToasts } from "../../lib/usePageStatus";
import { errorMessage } from "./shared";

const mae = (n: number) => n.toFixed(4);

/** Every algorithm anyone has actually trained for this problem, not
 *  just the sklearn family retrain() grid-searches -- PyTorch/
 *  TensorFlow/Spark's own candidates (vfr.model_candidates) show up
 *  here too once trained. Sorted best-first; each row names its own
 *  metric rather than implying they're all on the same footing (see
 *  the backend's own reasoning in planning-service's docstring). */
const modelComparisonChartConfig = {
  score: { label: "MAE", color: "var(--chart-1)" },
} satisfies ChartConfig;

// Emerald, matching the promoted Badge's own color elsewhere in this app
// (e.g. the Plan tab's own algorithm badges) -- the one bar that's
// actually serving predictions reads as such at a glance, not just on
// hover.
const PROMOTED_BAR_COLOR = "#10b981";

/** The header button that opens the drawer -- `aria-expanded` so the
 *  state is readable, the same as the sidebar's own toggle. */
export function DevMlButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <IconButton label="Dev ML" aria-expanded={open} onClick={onClick}>
      <FlaskConical className="size-5" />
    </IconButton>
  );
}

/**
 * How the checkpoint model was chosen -- the one thing about this
 * project's ML that is worth a drawer of its own: every algorithm it
 * trained, side by side, with the promoted one marked. A `MapDrawer`
 * in Settings' own Dev tab (see SettingsView), dropping down over the
 * labeling map from the top the way a sheet would, but only over the
 * map's own area. Just the chart: with one thing in the drawer there
 * is nothing to collapse.
 *
 * The algorithm picker that used to sit below this is gone: scoring a
 * route with a model the comparison already shows to be worse answered
 * no question a pilot or a developer had, and Plan always scores with
 * the promoted model (its info popover now says which).
 */
export function DevMlPanel() {
  const {
    data, error, refetch,
  } = useQuery({ queryKey: ["modelComparison"], queryFn: api.modelComparison, retry: false });
  // A candidate whose metrics file has no score sorts last, not first.
  const rows = data ? [...data.models].sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity)) : null;
  const loadMessage = errorMessage(error, "Could not load the model comparison");
  useErrorToasts({ modelComparison: loadMessage && { message: loadMessage, retry: () => void refetch() } });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4">
        <div className="text-sm font-semibold">Model comparison</div>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Mean absolute error on the {data?.n_labeled ?? "—"} hand-labeled checkpoints -- lower is
          better. Every algorithm this project has actually trained, not just the one serving
          predictions; the green bar is the one Plan scores checkpoints with.
        </p>
        {!error && !rows && <p className="text-sm text-muted-foreground">Loading…</p>}
        {rows?.length === 0 && <p className="text-sm text-muted-foreground">No trained models are available.</p>}
        {rows && rows.length > 0 && (
          <ChartContainer
            config={modelComparisonChartConfig}
            className="aspect-auto w-full"
            style={{ height: Math.max(rows.length * 36, 120) }}
          >
            {/* right margin: room for each bar's own MAE label past its
                end -- the number is the point of the chart, and a hover
                tooltip alone leaves a phone reader with unlabeled bars. */}
            <BarChart accessibilityLayer data={rows} layout="vertical" margin={{ left: 12, right: 48 }}>
              <XAxis type="number" dataKey="score" hide />
              <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tickMargin={8} width={110} />
              <ChartTooltip
                cursor={false}
                content={(
                  <ChartTooltipContent
                    formatter={(value, _name, item) => (
                      <div className="flex w-full items-center gap-2">
                        <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                        <span className="text-muted-foreground">MAE</span>
                        <div className="ml-auto flex items-baseline gap-1 font-mono font-medium text-foreground tabular-nums">
                          {mae(Number(value))}
                          <span className="font-sans font-normal text-muted-foreground">
                            {(item.payload as ModelComparisonEntry).metric === "cv_mae" ? "CV" : "held-out"}
                          </span>
                        </div>
                      </div>
                    )}
                  />
                )}
              />
              <Bar dataKey="score" radius={4}>
                {rows.map(m => (
                  <Cell key={m.name} fill={m.promoted ? PROMOTED_BAR_COLOR : "var(--color-score)"} />
                ))}
                <LabelList
                  dataKey="score" position="right" offset={8} fontSize={12} className="fill-foreground"
                  formatter={value => (typeof value === "number" ? mae(value) : "")}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </div>
    </div>
  );
}
