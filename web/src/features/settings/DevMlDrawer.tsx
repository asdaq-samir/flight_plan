import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import CollapsibleSection from "../../components/CollapsibleSection";
import IdentPairInputs from "../../components/IdentPairInputs";
import { Button } from "../../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "../../components/ui/sheet";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { api } from "../../lib/api/client";
import { identSchema } from "../../lib/identSchema";
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

function ModelComparisonPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    data, error, refetch,
  } = useQuery({ queryKey: ["modelComparison"], queryFn: api.modelComparison, enabled: isOpen });
  // A candidate whose metrics file has no score sorts last, not first.
  const rows = data ? [...data.models].sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity)) : null;
  const loadMessage = errorMessage(error, "Could not load the model comparison");
  useErrorToasts({ modelComparison: loadMessage && { message: loadMessage, retry: () => void refetch() } });

  return (
    <CollapsibleSection title="Model Comparison" onOpenChange={setIsOpen}>
      <p className="mb-2 text-sm text-muted-foreground">
        Mean absolute error on the {data?.n_labeled ?? "—"} hand-labeled checkpoints -- lower is
        better. Every algorithm this project has actually trained, not just the one serving
        predictions.
      </p>
      {!error && !rows && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-muted-foreground">No trained models are available.</p>}
      {rows && rows.length > 0 && (
        <ChartContainer
          config={modelComparisonChartConfig}
          className="aspect-auto w-full max-w-xl"
          style={{ height: Math.max(rows.length * 36, 120) }}
        >
          <BarChart accessibilityLayer data={rows} layout="vertical" margin={{ left: 12 }}>
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
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </CollapsibleSection>
  );
}

/** Live scored checkpoints from one chosen algorithm -- calls the
 *  Playground's own /api/playground/score (not the planner's real
 *  scoring path, which never chooses an algorithm). Spark's own
 *  "model" here is a lookup into predictions computed once at
 *  training time, not a live Spark session -- see model-service's own
 *  docstring on why. */
function AlgorithmPickerPanel() {
  const [dep, setDep] = useState("C81");
  const [dest, setDest] = useState("KDLH");
  const [model, setModel] = useState("current");
  const [routeError, setRouteError] = useState<string | null>(null);
  const score = useMutation({
    mutationFn: ({ d, a, m }: { d: string; a: string; m: string }) => api.playgroundScore(d, a, m),
  });

  const run = () => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a) {
      setRouteError("Enter valid departure and destination airport identifiers.");
      return;
    }
    setRouteError(null);
    score.mutate({ d, a, m: model });
  };
  const scoreMessage = errorMessage(score.error, "Could not score this route");
  useErrorToasts({ playgroundScore: scoreMessage && { message: scoreMessage, retry: run } });

  return (
    <CollapsibleSection title="Algorithm Picker">
      <p className="mb-2 text-sm text-muted-foreground">
        The same route, scored by whichever algorithm you pick -- real inference each time
        (Spark's own "model" is a lookup into predictions it computed once at training time, not
        a live Spark session; see the Model Comparison panel above for its own accuracy).
      </p>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); run(); }}>
        <IdentPairInputs
          dep={dep} dest={dest}
          onDepChange={v => { setDep(v); setRouteError(null); }}
          onDestChange={v => { setDest(v); setRouteError(null); }}
          invalid={!!routeError} widthClassName="w-20"
        />
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger aria-label="Algorithm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Currently promoted</SelectItem>
            <SelectItem value="pytorch">PyTorch MLP</SelectItem>
            <SelectItem value="tensorflow">TensorFlow MLP</SelectItem>
            <SelectItem value="spark">Spark GBT</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" disabled={score.isPending}>{score.isPending ? "Scoring…" : "Score checkpoints"}</Button>
      </form>
      {routeError && <p className="text-sm text-destructive" role="alert">{routeError}</p>}
      {score.data && (
        <>
          <p className="mb-1 text-xs text-muted-foreground">Scored by: {score.data.model_type}</p>
          {score.data.checkpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No checkpoints were returned for this route.</p>
          ) : (
            <Table className="min-w-[32rem]">
              <TableCaption className="sr-only">Scored checkpoints</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-1 pr-4 pl-0">Checkpoint</TableHead>
                  <TableHead className="py-1 pr-4">Category</TableHead>
                  <TableHead className="py-1 pr-4">Along track</TableHead>
                  <TableHead className="py-1 pr-4">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {score.data.checkpoints.map(c => (
                  <TableRow key={c.osm_id}>
                    <TableCell className="py-1 pr-4 pl-0">{c.name}</TableCell>
                    <TableCell className="py-1 pr-4">{c.category}</TableCell>
                    <TableCell className="py-1 pr-4">{c.along_track_nm.toFixed(1)} nm</TableCell>
                    <TableCell className="py-1 pr-4 font-mono">{c.predicted_score.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

/** Model Comparison and Algorithm Picker, in a top drawer off the Dev
 *  tab rather than a tab of their own -- both are stateless "explore
 *  how this project's model selection works" demos, not something a
 *  pilot rating checkpoints needs on screen by default the way the
 *  tab's own labeling workspace is. Top, not bottom: the tab's own map
 *  fills the rest of the screen below the header, the same reason
 *  every other sheet in this app opens from the top. */
export default function DevMlDrawer() {
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Dev ML">
              <FlaskConical className="size-5" />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Dev ML</TooltipContent>
      </Tooltip>
      {/* mx-auto max-w-2xl -- stock Sheet only caps width for the
          left/right sides (the top/bottom sides ship `inset-x-0` alone,
          full-bleed); this content's own widest piece (the model
          comparison table) tops out around 32rem, so 2xl leaves it
          comfortable room without spanning the whole screen behind it. */}
      <SheetContent side="top" className="mx-auto max-w-2xl">
        <ScrollArea className="max-h-[85vh]">
          <SheetHeader>
            <SheetTitle>Dev ML</SheetTitle>
            <SheetDescription>How this project actually works, underneath the map.</SheetDescription>
          </SheetHeader>
          <ModelComparisonPanel />
          <AlgorithmPickerPanel />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
