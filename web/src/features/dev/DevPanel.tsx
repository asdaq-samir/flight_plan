import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import IconButton from "../../components/IconButton";
import RouteForm from "../../components/RouteForm";
import ThemeToggle from "../../components/ThemeToggle";
import { Button } from "../../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { api, describeError, errorMessage } from "../../lib/api/client";
import { identSchema } from "../../lib/identSchema";
import type { ModelComparisonEntry, Status } from "../../lib/api/types";
import { useErrorToasts } from "../../lib/usePageStatus";
import { elapsed } from "../plan/format";

const mae = (n: number) => n.toFixed(4);

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

/** The header button that opens the console -- `aria-expanded` so the
 *  state is readable, the same as the sidebar's own toggle. A console
 *  glyph, not the flask: the flask is the Dev page's own mark (the Dev
 *  link on Plan carries it), and one glyph should mean one thing. */
export function DevButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <IconButton label="Dev console" aria-expanded={open} onClick={onClick} data-testid="dev-console-button">
      <SquareTerminal className="size-5" />
    </IconButton>
  );
}

/**
 * The developer's own console, in a `MapDrawer` dropping down over the
 * labeling map (see DevView): what the repo does that a pilot never
 * sees, one tab each. Model -- every algorithm trained, the promoted
 * one and the registry behind it, and a retrain through Airflow.
 * Corridors -- what has been collected, how far its labels have come,
 * and a form to collect another. System -- which services answer, how
 * fresh the FAA and weather data is, and the doors into the rest of
 * the stack (API docs, Jupyter, Airflow, the MCP server). All of it
 * from one `/api/status` snapshot, refreshed while open. The pilot's
 * page has the same drawer in the same place, holding the pilot's
 * things instead (see PilotPanel).
 */
export function DevPanel() {
  const { data: status, error, refetch } = useQuery({
    queryKey: ["status"], queryFn: api.status, refetchInterval: 30000, retry: false,
  });
  const statusMessage = errorMessage(error, "Could not read the system status");
  useErrorToasts({ status: statusMessage && { message: statusMessage, retry: () => void refetch() } });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4">
        <Tabs defaultValue="model">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="model">Model</TabsTrigger>
              <TabsTrigger value="corridors">Corridors</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              {status && <span className="text-xs text-muted-foreground">Checked {ago(status.checked_at)}</span>}
              <ThemeToggle />
            </div>
          </div>
          <TabsContent value="model" className="mt-3"><ModelTab status={status} /></TabsContent>
          <TabsContent value="corridors" className="mt-3"><CorridorsTab status={status} /></TabsContent>
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
  const {
    data, error, refetch,
  } = useQuery({ queryKey: ["modelComparison"], queryFn: api.modelComparison, retry: false });
  // A candidate whose metrics file has no score sorts last, not first.
  const rows = data ? [...data.models].sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity)) : null;
  const loadMessage = errorMessage(error, "Could not load the model comparison");
  useErrorToasts({ modelComparison: loadMessage && { message: loadMessage, retry: () => void refetch() } });

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

/** The registry behind the chart, and the one action: a retrain run.
 *  This planner cannot train in-process (no scikit-learn of its own,
 *  on purpose), so the button goes through Airflow, the same DAG the
 *  AWS trigger Lambda starts; without Airflow reachable it says how to
 *  run the pipeline by hand instead. */
function ModelTab({ status }: { status: Status | undefined }) {
  const queryClient = useQueryClient();
  const retrain = useMutation({
    mutationFn: api.retrain,
    onSuccess: run => {
      toast.success("Retrain started", { description: run.dag_run_id ? `Airflow run ${run.dag_run_id}` : undefined });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
    },
    onError: err => toast.error(describeError(err, "Could not start a retrain"), { duration: 10000 }),
  });
  const model = status?.model;
  const pipeline = status?.pipeline;
  const lastRun = pipeline?.last_run;

  return (
    <div className="space-y-5">
      <ModelComparisonChart />
      <section>
        <h3 className="text-sm font-semibold">Registry</h3>
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
      <section>
        <h3 className="text-sm font-semibold">Pipeline</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {pipeline?.airflow_reachable
            ? (lastRun
              ? `Last Airflow run of the training DAG: ${lastRun.state ?? "unknown"}, started ${ago(lastRun.start_date)}.`
              : "Airflow is reachable; the training DAG has not run yet.")
            : `${pipeline?.detail ?? "Airflow is not reachable from here"}, so a retrain runs by hand: `
              + "docker compose run --rm pipeline-training retrain, then the registry promotes it if it beats the current model."}
        </p>
        <Button
          type="button" size="sm" className="mt-2"
          onClick={() => retrain.mutate()}
          disabled={retrain.isPending || !pipeline?.airflow_reachable}
        >
          {retrain.isPending ? "Starting…" : "Retrain through Airflow"}
        </Button>
      </section>
    </div>
  );
}

/** Collect a corridor from here -- the same background job Plan's own
 *  "Collect this route" notice starts, polled the same way. */
function CollectCorridor() {
  const queryClient = useQueryClient();
  const [dep, setDep] = useState("");
  const [dest, setDest] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const collect = useCallback(async () => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a || d === a) {
      toast.error("Enter two different airport identifiers.");
      return;
    }
    try {
      const job = await api.startBuild(d, a);
      if (job.state === "done" || !job.job_id) {
        toast.info(`${d} → ${a} is already collected.`);
        return;
      }
      const jobId = job.job_id;
      startedAt.current = Date.now();
      setProgress(job.step);
      timer.current = window.setInterval(async () => {
        try {
          const current = await api.buildStatus(jobId);
          setProgress(`${current.step} — ${elapsed(Date.now() - startedAt.current)} elapsed`);
          if (current.state === "done" || current.state === "failed") {
            if (timer.current) window.clearInterval(timer.current);
            setProgress(null);
            if (current.state === "done") {
              toast.success(`${d} → ${a} collected`);
              void queryClient.invalidateQueries({ queryKey: ["status"] });
              void queryClient.invalidateQueries({ queryKey: ["routes"] });
            } else {
              toast.error(current.detail ?? "collection failed", { duration: 10000 });
            }
          }
        } catch {
          // a transient blip should not abandon a running job
        }
      }, 2000);
    } catch (err) {
      toast.error(describeError(err, "Could not start collecting"));
    }
  }, [dep, dest, queryClient]);

  return (
    <section>
      <h3 className="text-sm font-semibold">Collect a corridor</h3>
      <p className="mt-1 mb-2 text-sm text-muted-foreground">
        Overpass, the FAA files and an elevation lookup per candidate -- a few minutes, run by the
        planner in the background: the same collect and engineer-features steps the Airflow DAG runs.
        Label it afterwards, and the next retrain learns from it.
      </p>
      <RouteForm dep={dep} dest={dest} onDepChange={setDep} onDestChange={setDest} onSubmit={() => void collect()} disabled={progress !== null} />
      {progress && <p className="mt-2 text-sm text-muted-foreground">{progress}</p>}
    </section>
  );
}

function CorridorsTab({ status }: { status: Status | undefined }) {
  const corridors = status?.corridors ?? [];
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold">Collected corridors</h3>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Every route with a feature store, and how far its labels have come. Rated counts every
          pick on the chart, 0 included; added are the ones a pilot put on the chart themselves.
        </p>
        <Table containerClassName="rounded-md border" className="min-w-[40rem]">
          <TableCaption className="sr-only">Collected corridors</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Corridor</TableHead>
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
                  {status ? "No corridor has been collected yet." : "Loading…"}
                </TableCell>
              </TableRow>
            )}
            {corridors.map(c => {
              const route = new URLSearchParams({ dep: c.departure_ident, dest: c.destination_ident }).toString();
              return (
                <TableRow key={`${c.departure_ident}-${c.destination_ident}`}>
                  <TableCell className="font-mono">{c.departure_ident} → {c.destination_ident}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.candidates ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.labels.total}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.labels.added}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.notes}</TableCell>
                  <TableCell className="text-muted-foreground">{ago(c.features_built_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="link" size="sm"><Link to={`/plan?${route}`}>Plan</Link></Button>
                    <Button asChild variant="link" size="sm"><Link to={`/dev?${route}`}>Label</Link></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <CollectCorridor />
    </div>
  );
}

function StatusDot({ up }: { up: boolean | undefined }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        up === undefined ? "bg-muted-foreground/40" : up ? "bg-emerald-500" : "bg-destructive",
      )}
    />
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
    onError: err => toast.error(describeError(err, "Could not start a chart refresh"), { duration: 10000 }),
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

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold">Services</h3>
        <ul className="mt-1 space-y-1 text-sm">
          {rows.map(r => (
            <li key={r.name} className="flex items-baseline gap-2">
              <StatusDot up={r.up} />
              <span className="font-medium">{r.name}</span>
              <span className="text-muted-foreground">{r.detail}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Reference data</h3>
        <ul className="mt-1 space-y-1 text-sm">
          {(status?.faa_files ?? []).map(f => (
            <li key={f.name} className="flex items-baseline gap-2">
              <span className="font-mono">{f.name}</span>
              <span className="text-muted-foreground">FAA download, {ago(f.downloaded_at)}</span>
            </li>
          ))}
          {(status?.weather ?? []).map(w => (
            <li key={w.name} className="flex items-baseline gap-2">
              <span className="font-mono">{w.name}</span>
              <span className="text-muted-foreground">
                aviationweather.gov cache file, {w.fetched_at ? `fetched ${ago(w.fetched_at)}` : "not fetched yet"}
              </span>
            </li>
          ))}
          {status?.charts && (
            <li className="flex items-baseline gap-2" data-testid="charts-status">
              <span className="font-mono">VFR charts</span>
              <span className="text-muted-foreground">
                FAA GeoTIFFs, cycle {status.charts.cycle}:{" "}
                {status.charts.charts.length
                  ? status.charts.charts
                      .map(c => `${c.name.replace(/_/g, " ")} ${c.kind === "tac" ? "TAC" : "sectional"}`)
                      .join(", ")
                  : "none prepared yet"}
                {` · ${status.charts.tiles_cached} tiles rendered`}
                {Object.values(status.charts.pyramid ?? {}).map(p => (
                  <span key={p.kind}>
                    {` · ${p.kind === "tac" ? "TAC" : "sectional"} pyramid `}
                    {p.finished_at
                      ? `complete (${p.rasters_done} sheets, ${p.tiles_written} tiles)`
                      : `${p.rasters_done}/${p.rasters_total} sheets${p.current ? `, on ${p.current}` : ""}`}
                  </span>
                ))}
                {status.charts.current_cycle !== status.charts.cycle && (
                  <span>
                    {` · the FAA is on cycle ${status.charts.current_cycle}`}
                    {Object.values(status.charts.building ?? {}).map(p => (
                      <span key={p.kind}>
                        {`, ${p.kind === "tac" ? "TAC" : "sectional"} ${p.finished_at ? "rendered" : `${p.rasters_done}/${p.rasters_total} sheets`}`}
                      </span>
                    ))}
                    {status.charts.refresh_running ? ", fetching and rendering it now" : ", not fetched yet"}
                  </span>
                )}
                {" "}
                <Button
                  variant="link" size="sm" className="h-auto p-0"
                  onClick={() => refreshCharts.mutate()}
                  disabled={refreshCharts.isPending || status.charts.refresh_running}
                >
                  {status.charts.refresh_running ? "refreshing…" : "refresh now"}
                </Button>
              </span>
            </li>
          )}
          {!status && <li className="text-muted-foreground">Loading…</li>}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Elsewhere in the stack</h3>
        <ul className="mt-1 space-y-1 text-sm">
          {links.filter(l => local || !l.localOnly).map(l => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noreferrer" className="underline underline-offset-4">{l.label}</a>
            </li>
          ))}
          {local && (
            <li className="text-muted-foreground">
              MCP server: <span className="font-mono">http://{host}:8082/mcp/sse</span> (bearer token, see nav-log-agent)
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
