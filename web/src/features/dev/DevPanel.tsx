import type { ComponentProps, ReactNode } from "react";
import { usePreferences } from "../../lib/preferences";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { ExternalLink, RefreshCw, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import IconButton from "../../components/IconButton";
import ThemeToggle from "../../components/ThemeToggle";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { api } from "../../lib/api/client";
import type { ModelComparisonEntry, Status } from "../../lib/api/types";
import RatingGuide from "../label/components/RatingGuide";
import { elapsed } from "../plan/format";
import { useRetrain } from "./useRetrain";

const mae = (n: number) => n.toFixed(4);
/** Every rating on every collected route: what the next retrain reads. */
const ratings = (status: Status) => status.corridors.reduce((n, c) => n + c.labels.total, 0);

/** "just now", "12 min ago", "3 h ago", or the date -- for a timestamp
 *  that may be missing altogether. */
function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
const CHART_KIND_LABELS: Record<string, string> = {
  sec: "Sectional", tac: "TAC", ifr_low: "IFR low", ifr_high: "IFR high", ifr_area: "IFR area",
};
// The tab the console was last on, remembered per browser: a developer
// watching a retrain or a route being collected reopens the console to
// the same tab, not to Model Training every time.
const TABS = ["training", "performance", "system"];

/** The header button that opens the console: a `SheetTrigger` child,
 *  so the sheet's own open state, click and `aria-expanded` arrive as
 *  props and land on the button. A console glyph, not the flask: the
 *  flask is the Dev page's own mark, and one glyph should mean one
 *  thing. */
export function DevButton(props: Omit<ComponentProps<typeof IconButton>, "label" | "children">) {
  return (
    <IconButton label="Developer" data-testid="dev-console-button" {...props}>
      <SquareTerminal className="size-5" />
    </IconButton>
  );
}

/**
 * The developer's own console, in a `MapDrawer` dropping down over the
 * labeling map (see DevView): what the repo does that a pilot never
 * sees, one tab each. Model Training, first -- the three steps that
 * change the model (collect a route, rate it, retrain), the routes
 * collected and how far their ratings have come, the rating guide and
 * the last training run; no inputs of its own, since the header's
 * route form loads and collects routes and the Retrain button sits in
 * the Model Training drawer beside the ratings it learns from.
 * Performance -- every algorithm trained, the promoted one and the
 * registry behind it. System -- which
 * services answer, how fresh the FAA and weather data is, the charts,
 * and the doors into the rest of the stack. All of it from one
 * `/api/status` snapshot, refreshed while open. The pilot's page has
 * the same drawer in the same place, holding the pilot's things
 * instead (see PilotPanel).
 */
export function DevPanel() {
  const queryClient = useQueryClient();
  const { data: status, isFetching } = useQuery({
    queryKey: ["status"], queryFn: api.status, refetchInterval: 30000,
  });
  // The tab the drawer was last on, remembered per browser.
  const savedTab = usePreferences(s => s.devTab);
  const tab = TABS.includes(savedTab) ? savedTab : "training";
  const changeTab = usePreferences(s => s.setDevTab);
  // Everything the console shows, asked for again now rather than at
  // the next 30-second tick: the snapshot, the model comparison and
  // the two health probes the System tab runs itself.
  const refreshAll = () => void queryClient.invalidateQueries({
    predicate: q => ["status", "modelComparison", "webappHealth", "plannerHealth"].includes(String(q.queryKey[0])),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4">
        <Tabs value={tab} onValueChange={changeTab}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="training">Model Training</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              {status && <span className="text-xs text-muted-foreground">Checked {ago(status.checked_at)}</span>}
              <IconButton label="Check again" onClick={refreshAll} disabled={isFetching} data-testid="dev-refresh">
                <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
              </IconButton>
              <ThemeToggle />
            </div>
          </div>
          <TabsContent value="training" className="mt-3"><TrainingTab status={status} /></TabsContent>
          <TabsContent value="performance" className="mt-3"><PerformanceTab status={status} /></TabsContent>
          <TabsContent value="system" className="mt-3"><SystemTab status={status} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

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

function ModelComparisonChart() {
  const { data, error } = useQuery({ queryKey: ["modelComparison"], queryFn: api.modelComparison });
  // A candidate whose metrics file has no score sorts last, not first.
  const rows = data ? [...data.models].sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity)) : null;

  return (
    <section>
      <h3 className="text-sm font-semibold">Model comparison</h3>
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
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

/** How good the models are: the comparison chart and the registry
 *  behind it -- what is serving, what it learned from, every version
 *  promoted before it. */
function PerformanceTab({ status }: { status: Status | undefined }) {
  const model = status?.model;
  return (
    <div className="space-y-6">
      <ModelComparisonChart />
      <section>
        <SectionHeading title="Registry" description="The model serving predictions now, and every version promoted before it." />
        <div className="mb-1" />
        {model?.current ? (
          <div className="mt-1 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Fact label="Promoted" value={model.current.model_type ?? "—"} />
            <Fact label="Trained" value={ago(model.current.trained_at)} />
            <Fact label="Labels it learned from" value={String(model.current.n_labeled ?? "—")} />
            <Fact label="CV MAE" value={model.current.cv_mae == null ? "—" : mae(model.current.cv_mae)} />
            <Fact label="Held-out MAE" value={model.current.held_out_mae == null ? "—" : mae(model.current.held_out_mae)} />
            <Fact label="Features" value={String(model.current.n_features)} />
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{status ? "No model has been promoted yet." : "Loading…"}</p>
        )}
        {model && model.versions.length > 0 && (
          <Table containerClassName="mt-3 rounded-md border" className="min-w-[28rem]">
            <TableCaption className="sr-only">Every version the registry has promoted</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Trained</TableHead>
                <TableHead className="text-right">CV MAE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.versions.slice(0, 5).map(v => (
                <TableRow key={v.name}>
                  <TableCell className="font-mono">{v.name}</TableCell>
                  <TableCell>{v.model_type ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{ago(v.trained_at)}</TableCell>
                  <TableCell className="text-right font-mono">{v.cv_mae == null ? "—" : mae(v.cv_mae)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {model && model.candidates.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Other frameworks trained: {model.candidates.map(c => `${c.name} (${ago(c.trained_at)})`).join(", ")}.
          </p>
        )}
      </section>
    </div>
  );
}

/** One numbered step of the training flow: a number in a circle, the
 *  step's title and what to do, then its own content. */
function Step({ n, title, description, children }: { n: number; title: string; description: string; children?: ReactNode }) {
  return (
    <section className="flex gap-3">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <SectionHeading title={title} description={description} />
        {children && <div className="mt-2">{children}</div>}
      </div>
    </section>
  );
}

/** The one action that changes the model, laid out as the three steps
 *  it takes: collect a route so its candidate landmarks exist, rate
 *  its checkpoints in the side drawer (what the model learns
 *  from), then retrain -- from the button beside those ratings. No
 *  inputs here: the header's route form is what loads a route and
 *  offers to collect it. This planner cannot train in-process (no
 *  scikit-learn of its own, on purpose), so the retrain goes through
 *  Airflow, the same DAG the AWS trigger Lambda starts; without Airflow
 *  reachable the tab says how to run the pipeline by hand instead. */
function TrainingTab({ status }: { status: Status | undefined }) {
  const { pipeline, lastRun } = useRetrain();
  const model = status?.model;
  const corridors = status?.corridors ?? [];
  // The route on the map behind the console, to mark its row and to
  // point the rating step at it.
  const params = new URLSearchParams(useLocation().search);
  const onMapKey = `${params.get("dep") ?? ""}-${params.get("dest") ?? ""}`.toUpperCase();
  const onMap = corridors.find(c => `${c.departure_ident}-${c.destination_ident}`.toUpperCase() === onMapKey);

  return (
    <div className="space-y-6">
      <Step
        n={1}
        title="Collect a route"
        description="Collecting a route gathers every candidate landmark from OpenStreetMap and the FAA files within ten miles of the course, with the features the model scores them by -- Overpass, the FAA files and an elevation lookup per candidate, a few minutes in the background. The planner can score checkpoints only on a collected route. Load a route in the header above; one not yet collected offers to be. These are collected so far:"
      >
        <Table containerClassName="rounded-md border" className="min-w-[40rem]">
          <TableCaption className="sr-only">Collected routes</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead className="text-right">Candidates</TableHead>
              <TableHead className="text-right">Rated</TableHead>
              <TableHead className="text-right">Added</TableHead>
              <TableHead className="text-right">Notes</TableHead>
              <TableHead>Built</TableHead>
              <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {corridors.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-16 text-center text-muted-foreground">
                  {status ? "No route has been collected yet." : "Loading…"}
                </TableCell>
              </TableRow>
            )}
            {corridors.map(c => {
              const route = new URLSearchParams({ dep: c.departure_ident, dest: c.destination_ident }).toString();
              const key = `${c.departure_ident}-${c.destination_ident}`;
              const current = c === onMap;
              const rated = c.candidates ? Math.round((c.labels.total / c.candidates) * 100) : null;
              return (
                <TableRow key={key} data-state={current ? "selected" : undefined}>
                  <TableCell className="font-mono">
                    {c.departure_ident} → {c.destination_ident}
                    {current && <Badge variant="secondary" className="ml-2 font-sans">on the map</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.candidates ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.labels.total}
                    {rated !== null && <span className="ml-1 text-xs text-muted-foreground">({rated}%)</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.labels.added}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.notes}</TableCell>
                  <TableCell className="text-muted-foreground">{ago(c.features_built_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="link" size="sm"><Link to={`/plan?${route}`}>Plan</Link></Button>
                    <Button asChild variant="link" size="sm"><Link to={`/dev?${route}`}>Rate</Link></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Rated counts every pick on the chart, 0 included, against the candidates scored; added are the ones a pilot put on the chart themselves.
        </p>
      </Step>

      <Step
        n={2}
        title="Rate its checkpoints"
        description="Close this drawer and walk the route on the map behind it, from the Model Training drawer at the side: every candidate in flight order, rated 0 to 5 for how findable it is from the air (Space starts, the arrow keys step, the digits rate). Each rating is one labelled example; the model learns from nothing else."
      >
        {onMap ? (
          <p className="text-sm text-muted-foreground">
            {onMap.departure_ident} → {onMap.destination_ident} is on the map now: {onMap.labels.total} of {onMap.candidates ?? "—"} candidates rated.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Pick a route above with Rate to bring it onto the map.</p>
        )}
        <div className="mt-3 rounded-md border border-border p-3">
          <RatingGuide />
        </div>
      </Step>

      <Step
        n={3}
        title="Retrain"
        description="The Retrain button is in the Model Training drawer at the side, beside Undo and Reset. It reads every rating across every route, fits every algorithm in the Performance tab's comparison, and promotes the best one only if it beats the model serving now."
      >
        {pipeline?.airflow_reachable ? (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            {lastRun ? (
              <>
                <StatusDot up={lastRun.state === "success" ? true : lastRun.state === "failed" ? false : undefined}
                  pending={lastRun.state === "running" || lastRun.state === "queued"} />
                <span className="font-medium">Last training run: {lastRun.state ?? "unknown"}</span>
                <span className="text-muted-foreground">
                  started {ago(lastRun.start_date)}
                  {lastRun.end_date && lastRun.start_date
                    && `, took ${elapsed(new Date(lastRun.end_date).getTime() - new Date(lastRun.start_date).getTime())}`}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Airflow is reachable; the training DAG has not run yet.</span>
            )}
            {pipeline.dag_id && LOCAL_HOSTS.includes(window.location.hostname) && (
              <a
                href={`http://${window.location.hostname}:8081/dags/${pipeline.dag_id}`} target="_blank" rel="noreferrer"
                className="underline underline-offset-4"
              >
                open in Airflow
              </a>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {pipeline?.detail ?? "Airflow is not reachable from here"}, so a retrain runs by hand:{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">docker compose run --rm pipeline-training retrain</code>
            {" "}-- the registry promotes it if it beats the current model.
          </p>
        )}
        {status && (
          <p className="mt-2 text-xs text-muted-foreground">
            {ratings(status)} ratings across {status.corridors.length} route{status.corridors.length === 1 ? "" : "s"} to learn from
            {model?.current?.n_labeled != null && `; the serving model learned from ${model.current.n_labeled}`}.
          </p>
        )}
      </Step>
    </div>
  );
}

/** A section's title and the one line that says what it shows. */
function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

/** "up" / "down" / "checking…" as a small pill with the dot. */
function StatusPill({ up }: { up: boolean | undefined }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <StatusDot up={up} />
      {up === undefined ? "checking…" : up ? "up" : "down"}
    </Badge>
  );
}

/** What a reference file is, for a developer who has not memorised the
 *  FAA's file names. */
const DATASET_NAMES: Record<string, string> = {
  "DOF.DAT": "Obstacles",
  "NAV_BASE.csv": "Navaids",
  "APT_BASE.csv": "Airports",
  "Shape_Files/Class_Airspace.shp": "Airspace",
  metars: "METARs",
  tafs: "TAFs",
  airsigmets: "AIRMETs and SIGMETs",
};

/** Green up, red down, grey unknown -- and amber, pulsing, for
 *  something under way (a training run). */
function StatusDot({ up, pending = false }: { up: boolean | undefined; pending?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        pending ? "animate-pulse bg-amber-500"
          : up === undefined ? "bg-muted-foreground/40" : up ? "bg-emerald-500" : "bg-destructive",
      )}
    />
  );
}

/** The FAA charts on disk and the tile pyramid rendered from them,
 *  one row per chart kind -- and, while the FAA has moved on to a
 *  newer cycle, the same rows for the cycle being fetched and
 *  rendered in the background. Used to be one run-on line naming
 *  every count, which read as nothing at all. */
function ChartsSection({ charts, onRefresh, refreshing }: {
  charts: NonNullable<Status["charts"]>; onRefresh: () => void; refreshing: boolean;
}) {
  const sheets = charts.charts.reduce<Record<string, number>>((n, c) => ({ ...n, [c.kind]: (n[c.kind] ?? 0) + 1 }), {});
  const kinds = Object.keys(CHART_KIND_LABELS).filter(k => sheets[k] || charts.pyramid?.[k] || charts.building?.[k]);
  const newer = charts.current_cycle !== charts.cycle;
  const progress = (p: { finished_at: string | null; rasters_done: number; rasters_total: number; current: string | null } | undefined) =>
    !p ? "—"
      : p.finished_at ? "complete"
      : `${p.rasters_done}/${p.rasters_total} sheets${p.current ? `, on ${p.current}` : ""}`;
  const workers = `${charts.refresh_workers} worker${charts.refresh_workers === 1 ? "" : "s"}`;
  return (
    <section data-testid="charts-status">
      <SectionHeading title="Charts" description="The FAA GeoTIFFs on disk and the tile pyramid the map is served from. A new cycle is fetched and rendered by the planner itself." />
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="Serving cycle" value={charts.cycle} />
          <Fact
            label="FAA cycle"
            value={newer ? `${charts.current_cycle} · ${charts.refresh_running ? "rendering" : "not yet"}` : "the same"}
          />
          <Fact label="Tiles" value={charts.tiles_cached.toLocaleString()} />
          <Fact label="Next render" value={charts.refresh_window ? `${charts.refresh_window}, ${workers}` : `any time, ${workers}`} />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing || charts.refresh_running}>
          {charts.refresh_running ? "Rendering…" : "Render now"}
        </Button>
      </div>
      <Table containerClassName="mt-3 rounded-md border" className="min-w-[24rem]">
        <TableCaption className="sr-only">Chart kinds on disk and their tile pyramids</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Chart</TableHead>
            <TableHead className="text-right">Sheets</TableHead>
            <TableHead className="text-right">Tiles</TableHead>
            <TableHead>Pyramid</TableHead>
            {newer && <TableHead>Cycle {charts.current_cycle}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {kinds.map(k => (
            <TableRow key={k}>
              <TableCell>{CHART_KIND_LABELS[k]}</TableCell>
              <TableCell className="text-right tabular-nums">{sheets[k] ?? 0}</TableCell>
              <TableCell className="text-right tabular-nums">{(charts.pyramid?.[k]?.tiles_written ?? 0).toLocaleString()}</TableCell>
              <TableCell className="text-muted-foreground">{progress(charts.pyramid?.[k])}</TableCell>
              {newer && <TableCell className="text-muted-foreground">{progress(charts.building?.[k])}</TableCell>}
            </TableRow>
          ))}
          {kinds.length === 0 && (
            <TableRow><TableCell colSpan={newer ? 5 : 4} className="h-12 text-center text-muted-foreground">No chart prepared yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}

function SystemTab({ status }: { status: Status | undefined }) {
  const queryClient = useQueryClient();
  // The one chart action: fetch and render the FAA's current cycle
  // now rather than at the planner's next daily check -- the same
  // subprocess either way, with its progress on the row below.
  const refreshCharts = useMutation({
    mutationFn: api.refreshCharts,
    onSuccess: r => {
      toast.success(r.started ? `Fetching and rendering cycle ${r.current_cycle} in the background` : "A chart refresh is already running");
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
  // webapp and its database answer for themselves through Spring's
  // public actuator: liveness for the process, readiness for the
  // database (its readiness group includes the DataSource check, see
  // application.yml). The planner is asked for its cheapest own answer
  // through the proxy; the rest comes from the planner's snapshot,
  // which probed them.
  const { data: webapp } = useQuery({
    queryKey: ["webappHealth"],
    queryFn: async () => {
      const [live, ready] = await Promise.all([fetch("/actuator/health/liveness"), fetch("/actuator/health/readiness")]);
      return { up: live.ok, db: ready.ok };
    },
    refetchInterval: 30000, retry: false,
  });
  const { data: plannerUp } = useQuery({
    queryKey: ["plannerHealth"],
    queryFn: async () => (await fetch("/api/planner/aircraft-profiles")).ok,
    refetchInterval: 30000, retry: false,
  });
  const services = status?.services;
  const modelService = services?.model_service;
  const rows: { name: string; up: boolean | undefined; detail: string }[] = [
    { name: "webapp (Spring Boot)", up: webapp?.up, detail: "the gateway, sessions, aircraft and flights" },
    { name: "db (Postgres + pgvector)", up: webapp?.db, detail: "application data and the agent's memory" },
    { name: "planning-service", up: plannerUp, detail: "course, checkpoints, nav log, briefing, chart reading" },
    {
      name: "model-service", up: modelService?.up,
      detail: modelService?.up && modelService.trained_at
        ? `serving a model trained ${ago(modelService.trained_at)}`
        : modelService?.detail ?? "scores candidate checkpoints",
    },
    {
      name: "nav-log-agent (LangGraph, MCP)", up: services?.nav_log_agent?.up,
      detail: services && !services.nav_log_agent ? "not configured here" : "the briefing narrative, with memory",
    },
    {
      name: "crewai-agent", up: services?.crewai_agent?.up,
      detail: services && !services.crewai_agent ? "not configured here" : "the same narrative, in CrewAI",
    },
  ];
  const host = window.location.hostname;
  const local = LOCAL_HOSTS.includes(host);
  const links: { label: string; href: string; localOnly?: boolean }[] = [
    { label: "webapp API docs", href: "/swagger-ui/index.html" },
    { label: "planning-service API docs", href: `http://${host}:8084/docs`, localOnly: true },
    { label: "model-service API docs", href: `http://${host}:8000/docs`, localOnly: true },
    { label: "Jupyter (the notebooks)", href: `http://${host}:8888`, localOnly: true },
    { label: "Airflow (the training DAG)", href: `http://${host}:8081`, localOnly: true },
  ];

  const datasets: { name: string; file: string; source: string; updated: string | null | undefined }[] = [
    ...(status?.faa_files ?? []).map(f => ({
      name: DATASET_NAMES[f.name] ?? f.name, file: f.name.split("/").pop() ?? f.name, source: "FAA", updated: f.downloaded_at,
    })),
    ...(status?.weather ?? []).map(w => ({
      name: DATASET_NAMES[w.name] ?? w.name, file: w.name, source: "aviationweather.gov", updated: w.fetched_at,
    })),
  ];

  return (
    <div className="space-y-6">
      <section>
        <SectionHeading title="Services" description="What answers right now. The gateway and its database report through Spring's actuator, the planner through its own proxy, the rest through the planner's probes." />
        <Table containerClassName="mt-2 rounded-md border" className="min-w-[28rem]">
          <TableCaption className="sr-only">Services and whether each answers</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell><StatusPill up={r.up} /></TableCell>
                <TableCell className="text-muted-foreground">{r.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section>
        <SectionHeading title="Reference data" description="The files the planner reads and how old each copy is." />
        <Table containerClassName="mt-2 rounded-md border" className="min-w-[28rem]">
          <TableCaption className="sr-only">Reference datasets and when each was fetched</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datasets.map(d => (
              <TableRow key={d.file}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell className="font-mono text-xs">{d.file}</TableCell>
                <TableCell className="text-muted-foreground">{d.source}</TableCell>
                <TableCell className="text-muted-foreground">{d.updated ? ago(d.updated) : "not fetched yet"}</TableCell>
              </TableRow>
            ))}
            {datasets.length === 0 && (
              <TableRow><TableCell colSpan={4} className="h-12 text-center text-muted-foreground">{status ? "Nothing on disk yet." : "Loading…"}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      {status?.charts && <ChartsSection charts={status.charts} onRefresh={() => refreshCharts.mutate()} refreshing={refreshCharts.isPending} />}
      <section>
        <SectionHeading title="Elsewhere in the stack" description="The other doors into the running stack, each in a new tab." />
        <div className="mt-2 flex flex-wrap gap-2">
          {[{ label: "This snapshot as JSON", href: "/api/planner/status" }, ...links.filter(l => local || !l.localOnly)].map(l => (
            <Button key={l.href} asChild variant="outline" size="sm">
              <a href={l.href} target="_blank" rel="noreferrer">
                {l.label}
                <ExternalLink className="text-muted-foreground" />
              </a>
            </Button>
          ))}
        </div>
        {local && (
          <p className="mt-2 text-xs text-muted-foreground">
            MCP server at <span className="font-mono">http://{host}:8082/mcp/sse</span>, bearer token as nav-log-agent's README says.
          </p>
        )}
      </section>
    </div>
  );
}
