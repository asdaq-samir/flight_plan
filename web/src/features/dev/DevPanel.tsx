import type { ReactNode } from "react";
import { usePreferences } from "../../lib/preferences";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import ConsoleTabs from "../../components/ConsoleTabs";
import IconButton from "../../components/IconButton";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../components/ui/table";
import { api } from "../../lib/api/client";
import type { ModelComparisonEntry, Status } from "../../lib/api/types";
import RatingGuide from "../train/components/RatingGuide";
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

const CHART_KIND_LABELS: Record<string, string> = {
  sec: "Sectional", tac: "TAC", ifr_low: "IFR low", ifr_high: "IFR high", ifr_area: "IFR area",
};
/**
 * The developer's own console, in a `MapDrawer` dropping down over the
 * training map (see MapPage): what the repo does that a pilot never
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
  const { data: status, isFetching, isError: statusFailed } = useQuery({
    queryKey: ["status"], queryFn: api.status, refetchInterval: 30000,
  });
  // The tab the console was last on, remembered per browser: a
  // developer watching a retrain or a route being collected reopens the
  // console to the same tab, not to Model Training every time.
  const savedTab = usePreferences(s => s.devTab);
  const changeTab = usePreferences(s => s.setDevTab);
  // Everything the console shows, asked for again now rather than at
  // the next 30-second tick: the snapshot, the model comparison and
  // the two health probes the System tab runs itself.
  const refreshAll = () => void queryClient.invalidateQueries({
    predicate: q => ["status", "modelComparison", "webappHealth", "plannerHealth"].includes(String(q.queryKey[0])),
  });

  return (
    <ConsoleTabs
      saved={savedTab}
      onChange={changeTab}
      actions={
        <>
          {status && <span className="text-xs text-muted-foreground">Checked {ago(status.checked_at)}</span>}
          <IconButton label="Check again" onClick={refreshAll} disabled={isFetching} data-testid="dev-refresh">
            <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          </IconButton>
        </>
      }
      tabs={[
        { value: "training", label: "Model Training", content: <TrainingTab status={status} failed={statusFailed} /> },
        { value: "performance", label: "Performance", content: <PerformanceTab status={status} failed={statusFailed} /> },
        { value: "system", label: "System", content: <SystemTab status={status} failed={statusFailed} /> },
      ]}
    />
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
        Mean absolute error on the {data?.n_labeled ?? "—"} hand-rated checkpoints -- lower is
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

/** What a section shows before the snapshot is here: that it is on its
 *  way, or that the planner did not answer. It said "Loading…" for
 *  ever when /api/status failed. */
const waiting = (failed: boolean) => (failed ? "The planner did not answer." : "Loading…");

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
function PerformanceTab({ status, failed }: { status: Status | undefined; failed: boolean }) {
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
            <Fact label="Ratings it trained on" value={String(model.current.n_labeled ?? "—")} />
            <Fact label="CV MAE" value={model.current.cv_mae == null ? "—" : mae(model.current.cv_mae)} />
            <Fact label="Held-out MAE" value={model.current.held_out_mae == null ? "—" : mae(model.current.held_out_mae)} />
            <Fact label="Features" value={String(model.current.n_features)} />
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{status ? "No model has been promoted yet." : waiting(failed)}</p>
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
/**
 * One door into the stack, which opens what it links to -- starting the
 * service first if it is not running.
 *
 * A link to a stopped service is a dead link, and telling a developer
 * to go and type the compose command is a worse answer than doing it.
 * The planner starts it through docker-compose.yml's dev-services
 * sidecar, which holds the Docker socket and can start nothing but a
 * fixed list of four names.
 *
 * The tab is opened *before* the start, not after: a browser only
 * allows window.open during the click that asked for it, and one
 * opened after an await is a popup the browser blocks. So the tab
 * appears immediately and is pointed at the service once it answers.
 */
function StackLink({ link }: { link: { label: string; href: string; service?: string } }) {
  const queryClient = useQueryClient();
  const { data: dev } = useQuery({
    queryKey: ["devServices"], queryFn: api.devServices, retry: false, staleTime: 30_000, meta: { silent: true },
  });
  const start = useMutation({ mutationFn: api.startDevService, meta: { silent: true } });

  const state = dev?.services.find(s => s.name === link.service)?.state;
  const startable = !!link.service && dev?.available === true && state !== undefined && state !== "running";

  if (!startable) {
    return (
      <Button asChild variant="outline" size="sm">
        <a href={link.href} target="_blank" rel="noreferrer">
          {link.label}
          <ExternalLink className="text-muted-foreground" />
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={start.isPending}
      onClick={() => {
        const tab = window.open("", "_blank", "noopener");
        start.mutate(link.service!, {
          onSuccess: () => {
            toast.success(`Started ${link.service}`);
            // So the control goes back to being a plain link rather
            // than still offering to start what is now running.
            void queryClient.invalidateQueries({ queryKey: ["devServices"] });
            // A container that has just started is not yet listening,
            // so the tab waits a moment rather than landing on a
            // connection refused.
            window.setTimeout(() => { if (tab) tab.location.href = link.href; }, 2500);
          },
          onError: () => { tab?.close(); toast.error(`Could not start ${link.service}`); },
        });
      }}
    >
      {start.isPending ? `Starting ${link.service}…` : `${link.label} — start it`}
      <ExternalLink className="text-muted-foreground" />
    </Button>
  );
}

function TrainingTab({ status, failed }: { status: Status | undefined; failed: boolean }) {
  const { pipeline, lastRun, running } = useRetrain();
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
                  {status ? "No route has been collected yet." : waiting(failed)}
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
                <Dot tone={running ? "running" : lastRun.state === "success" ? "up" : lastRun.state === "failed" ? "down" : "checking"} />
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
            {pipeline.dag_id && (
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

/**
 * What the console knows about a service, as one value. It was
 * `up: boolean | undefined`, and undefined meant in flight, failed, not
 * configured and unknown alike: an agent not configured here read
 * "checking…" for ever, as did every row once /api/status failed.
 */
type Health = "checking" | "up" | "down" | "no answer" | "not configured";

const HEALTH: Record<Health, { tone: Tone; label: string }> = {
  checking: { tone: "checking", label: "checking…" },
  up: { tone: "up", label: "up" },
  down: { tone: "down", label: "down" },
  "no answer": { tone: "down", label: "no answer" },
  "not configured": { tone: "checking", label: "not configured" },
};

/** A service the console asks itself. A check that failed is "no
 *  answer", not the answer before it, which TanStack keeps as data. */
function probed<T>(query: { data: T | undefined; isError: boolean }, up: (data: T) => boolean): Health {
  if (query.isError) return "no answer";
  if (query.data === undefined) return "checking";
  return up(query.data) ? "up" : "down";
}

/** A service the planner's snapshot probed: null there means this
 *  deployment does not run it. */
function reported(service: { up: boolean } | null | undefined, snapshotFailed: boolean): Health {
  if (snapshotFailed) return "no answer";
  if (service === null) return "not configured";
  if (service === undefined) return "checking";
  return service.up ? "up" : "down";
}

function StatusPill({ health }: { health: Health }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <Dot tone={HEALTH[health].tone} />
      {HEALTH[health].label}
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
type Tone = "up" | "down" | "checking" | "running";
const TONES: Record<Tone, string> = {
  up: "bg-emerald-500",
  down: "bg-destructive",
  checking: "bg-muted-foreground/40",
  running: "animate-pulse bg-amber-500",
};

function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", TONES[tone])} />;
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

function SystemTab({ status, failed }: { status: Status | undefined; failed: boolean }) {
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
  const webapp = useQuery({
    queryKey: ["webappHealth"],
    queryFn: async () => {
      const [live, ready] = await Promise.all([fetch("/actuator/health/liveness"), fetch("/actuator/health/readiness")]);
      return { up: live.ok, db: ready.ok };
    },
    refetchInterval: 30000, retry: false,
  });
  const planner = useQuery({
    queryKey: ["plannerHealth"],
    queryFn: async () => (await fetch("/api/planner/aircraft-profiles")).ok,
    refetchInterval: 30000, retry: false,
  });
  const services = status?.services;
  const modelService = services?.model_service;
  const rows: { name: string; health: Health; detail: string }[] = [
    { name: "webapp (Spring Boot)", health: probed(webapp, w => w.up), detail: "the gateway, sessions, aircraft and flights" },
    { name: "db (Postgres + pgvector)", health: probed(webapp, w => w.db), detail: "application data and the agent's memory" },
    { name: "planning-service", health: probed(planner, up => up), detail: "course, checkpoints, nav log, briefing, chart reading" },
    {
      name: "model-service", health: reported(modelService, failed),
      detail: modelService?.up && modelService.trained_at
        ? `serving a model trained ${ago(modelService.trained_at)}`
        : modelService?.detail ?? "scores candidate checkpoints",
    },
    { name: "nav-log-agent (LangGraph, MCP)", health: reported(services?.nav_log_agent, failed), detail: "the briefing narrative, with memory" },
    { name: "crewai-agent", health: reported(services?.crewai_agent, failed), detail: "the same narrative, in CrewAI" },
  ];
  const host = window.location.hostname;
  const links: { label: string; href: string; localOnly?: boolean; service?: string }[] = [
    { label: "webapp API docs", href: "/swagger-ui/index.html" },
    { label: "planning-service API docs", href: `http://${host}:8084/docs`, localOnly: true },
    { label: "model-service API docs", href: `http://${host}:8000/docs`, localOnly: true, service: "model-service" },
    { label: "Jupyter (the notebooks)", href: `http://${host}:8888`, localOnly: true, service: "ml" },
    { label: "Airflow (the training DAG)", href: `http://${host}:8081`, localOnly: true, service: "airflow" },
  ];

  // Every door, always. Two cleverer versions of this were wrong:
  // guessing from the hostname hid links that worked and showed links
  // that could not, and probing each one is impossible from here --
  // SecurityConfig's Content-Security-Policy sets `connect-src 'self'`,
  // so a cross-origin fetch to localhost:8084 is refused by the browser
  // before it is attempted, and loosening that header to allow a
  // liveness check is a bad trade for a tidier list.
  //
  // So the list is honest about what exists and the note below is
  // honest about what it takes to reach it.
  const shown: { label: string; href: string; localOnly?: boolean; service?: string }[] =
    [{ label: "This snapshot as JSON", href: "/api/planner/status" }, ...links];

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
                <TableCell><StatusPill health={r.health} /></TableCell>
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
              <TableRow><TableCell colSpan={4} className="h-12 text-center text-muted-foreground">{status ? "Nothing on disk yet." : waiting(failed)}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      {status?.charts && <ChartsSection charts={status.charts} onRefresh={() => refreshCharts.mutate()} refreshing={refreshCharts.isPending} />}
      <section>
        <SectionHeading title="Elsewhere in the stack" description="The other doors into the running stack, each in a new tab." />
        <div className="mt-2 flex flex-wrap gap-2">
          {shown.map(l => <StackLink key={l.href} link={l} />)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The last four are published by docker-compose on <span className="font-mono">127.0.0.1</span>, so they
          open on the machine running the stack. To reach them from a phone or another machine, start it with
          <span className="font-mono"> docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d</span> —
          read that file first, it publishes an unauthenticated Jupyter. Jupyter also needs its own service
          running: <span className="font-mono">docker compose up -d ml</span>.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          MCP server at <span className="font-mono">http://{host}:8082/mcp/sse</span>, bearer token as nav-log-agent's README says.
        </p>
      </section>
    </div>
  );
}
