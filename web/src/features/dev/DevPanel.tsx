import { usePreferences } from "../../lib/preferences";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { BrainCircuit, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { showError } from "../../lib/problems";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import { ConsolePages, PageRow, StepRow } from "../../components/ConsolePages";
import ConsoleTabs from "../../components/ConsoleTabs";
import { ListGroup, ListRow } from "../../components/GroupedList";
import StatusBadge, { type Tone } from "../../components/StatusBadge";
import { Progress } from "../../components/ui/progress";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { api, errorMessage } from "../../lib/api/client";
import { statusQuery } from "../../lib/queryClient";
import type { ModelComparisonEntry, Status } from "../../lib/api/types";
import RatingGuide from "../train/components/RatingGuide";
import { TEXT } from "../../lib/text";
import { useRetrain } from "./useRetrain";

const mae = (n: number) => n.toFixed(4);

/** One formatter for every date the console shows: `toLocaleDateString`
 *  builds a new one per call, and was the console's costliest function. */
const DATE = new Intl.DateTimeFormat();
/** A date and a time, for the registry's versions. */
const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "just now", "12 min ago", "3 h ago", or the date -- for a timestamp
 *  that may be missing altogether. */
function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return DATE.format(new Date(iso));
}

const CHART_KIND_LABELS: Record<string, string> = {
  sec: "Sectional", tac: "TAC", ifr_low: "IFR low", ifr_high: "IFR high", ifr_area: "IFR area",
};
/**
 * The developer's own console, in a `MapDrawer` dropping down over the
 * training map (see MapPage): what the repo does that a pilot never
 * sees, one tab each, each a page of grouped lists as iOS's Settings
 * is. Guide, first -- the three steps that change the model (load a
 * route, rate its points, retrain), then the rating scale and the keys;
 * no inputs of its own, since the header's route form loads routes and
 * Retrain sits in the Model Training drawer's More menu,
 * beside the ratings it learns from. Performance -- training first
 * (whether the ratings are enough to learn from, the last run and why
 * it failed, Retrain), then every algorithm compared, the model serving
 * and (a page of its own) the versions before it, and the routes
 * collected. System -- which services answer, then a page each for how
 * fresh the FAA and weather data is, the charts, and the doors into
 * the rest of the stack. All of it from one
 * `/api/status` snapshot, refreshed while open. The pilot's page has
 * the same drawer in the same place, holding the pilot's things
 * instead (see PilotPanel).
 */
export function DevPanel() {
  const queryClient = useQueryClient();
  const { data: status, isFetching, isError: statusFailed } = useQuery(statusQuery);
  // The tab the console was last on, remembered per browser: a
  // developer watching a retrain or a route being collected reopens the
  // console to the same tab, not to the Guide every time.
  const savedTab = usePreferences(s => s.devTab);
  const changeTab = usePreferences(s => s.setDevTab);
  // Everything the console shows, asked for again now rather than at
  // the next 30-second tick: the snapshot, the model comparison, the
  // two health probes the System tab runs itself and which services the
  // sidecar can start.
  const refreshAll = () => void queryClient.invalidateQueries({
    predicate: q => ["status", "modelComparison", "devServices"].includes(String(q.queryKey[0])),
  });

  return (
    <ConsoleTabs
      saved={savedTab}
      onChange={changeTab}
      tabs={[
        // "Guide", as the pilot console's first tab is: it walks the
        // three steps. (The value stays "training", which is what a
        // browser has remembered as its last tab.)
        { value: "training", label: "Guide", content: <TrainingTab /> },
        {
          value: "performance",
          // No badge on the name while a run goes: a confirmed retrain
          // opens this tab (useRetrain), where the run is followed.
          label: "Performance",
          content: <PerformanceTab status={status} failed={statusFailed} />,
        },
        {
          value: "system", label: "System",
          content: <SystemTab status={status} failed={statusFailed} onRefresh={refreshAll} refreshing={isFetching} />,
        },
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

// Emerald, the dot of the serving model's own Serving badge (StatusBadge's
// "up") -- the one bar that's actually serving predictions reads as
// such at a glance, not just on hover.
const PROMOTED_BAR_COLOR = "#10b981";

function ModelComparison() {
  const { data, error } = useQuery({ queryKey: ["modelComparison"], queryFn: api.modelComparison });
  // A candidate whose metrics file has no score sorts last, not first.
  const rows = data ? [...data.models].sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity)) : null;

  // A group of its own, the chart its one row and what it shows in the
  // note under it, as the tab's other groups are.
  return (
    <ListGroup title="Model comparison" footer={`Error on the ${data?.n_labeled ?? "—"} ratings, lower is better; green is the model serving.`}>
      {/* Status, not reading text: grey, as a placeholder is, and said to a
          screen reader when it changes. */}
      {!error && !rows && <ListRow title={<span role="status" className="text-muted-foreground">Reading each model's metrics…</span>} />}
      {rows?.length === 0 && <ListRow title={<span role="status" className="text-muted-foreground">No trained models are available.</span>} />}
      {rows && rows.length > 0 && (
        <div className="px-1 py-3">
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
            {/* No entry animation: the bars grew in for 400 ms after the
                data had arrived, and the numbers are the point. */}
            <Bar dataKey="score" radius={4} isAnimationActive={false}>
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
        </div>
      )}
    </ListGroup>
  );
}

/** What a section shows before the snapshot is here: that it is on its
 *  way, or that the planner did not answer. It said "Loading…" for
 *  ever when /api/status failed. */
const waiting = (failed: boolean) => (failed ? "The planner did not answer." : "Asking the planner for its status…");

/** How a training run went, in the one status badge. */
function RunBadge({ state, running }: { state: string | null | undefined; running: boolean }) {
  const [tone, text]: [Tone, string] =
    running ? ["running", "Training…"]
    : state === "success" ? ["up", "Succeeded"]
    : state === "failed" ? ["down", "Failed"]
    : ["checking", state ?? "Unknown"];
  return <StatusBadge tone={tone}>{text}</StatusBadge>;
}

/**
 * Every collected route, with how far its rating has got. Rows, as
 * Settings' are, where it was a line of grey, dark and outlined chips
 * over a card a route. What the ratings come to for training is the
 * Training group's (TrainingGroup); a Data group of counts went, the
 * readiness saying what they meant.
 */
function RoutesGroup({ status, failed }: { status: Status | undefined; failed: boolean }) {
  const corridors = status?.corridors ?? [];
  const onMap = useOnMap(corridors);
  return (
    <ListGroup title="Routes" footer="A route's name brings it onto the map to rate.">
        {corridors.length === 0 && (
          <ListRow title={<span className="text-muted-foreground">{status ? "No route has been collected yet." : waiting(failed)}</span>} />
        )}
        {corridors.map(c => {
          const route = new URLSearchParams({ dep: c.departure_ident, dest: c.destination_ident }).toString();
          const name = `${c.departure_ident} → ${c.destination_ident}`;
          const pct = c.candidates ? Math.round((c.labels.total / c.candidates) * 100) : null;
          const here = c === onMap;
          return (
            // The route's name brings it onto the map to rate, unless it
            // is there already; at the end, how far its rating has got.
            <ListRow
              key={`${c.departure_ident}-${c.destination_ident}`}
              title={here
                ? <span className="font-mono">{name}</span>
                : <Link to={`/dev?${route}`} className="font-mono underline underline-offset-4">{name}</Link>}
              description={`${here ? "On the map · " : ""}${c.labels.total} of ${c.candidates ?? "—"} rated${pct !== null ? ` (${pct}%)` : ""} · ${
                c.labels.added} added by hand · ${c.notes} notes · collected ${ago(c.features_built_at)}`}
            >
              <Progress
                value={pct ?? 0} className="h-1.5 w-12"
                aria-label={`${c.departure_ident} to ${c.destination_ident}: ${c.labels.total} of ${c.candidates ?? "an unknown number of"} candidates rated`}
              />
            </ListRow>
          );
        })}
    </ListGroup>
  );
}

/**
 * The model serving predictions: what it is, how it scored, and the
 * versions promoted before it (a page of their own), with how each
 * moved the error. Then the chart model (vfr.chartmodel), which scores
 * the chart reader's points on the training page, against the palette's
 * constants it is to replace on the ratings it held out: the
 * checkpoints move onto the chart once it beats them.
 */
function ModelGroup({ status, failed }: { status: Status | undefined; failed: boolean }) {
  const model = status?.model;
  const current = model?.current;
  return (
    <>
      {current ? (
        <ListGroup title="Model">
          <ListRow title={current.model_type ?? "Unknown model"} description={`Trained ${ago(current.trained_at)} · ${current.n_features} features`}>
            <StatusBadge tone="up">Serving</StatusBadge>
          </ListRow>
          <ListRow title="CV MAE" value={current.cv_mae == null ? "—" : mae(current.cv_mae)} />
          <ListRow title="Held-out MAE" value={current.held_out_mae == null ? "—" : mae(current.held_out_mae)} />
          <ListRow title="Ratings it trained on" value={current.n_labeled ?? "—"} />
          {model && model.versions.length > 0
            ? <PageRow page="versions" title="Versions promoted" value={model.versions.length} />
            : <ListRow title="Versions promoted" value={0} />}
        </ListGroup>
      ) : (
        <ListGroup title="Model">
          <ListRow title={<span role="status" className="text-muted-foreground">{status ? "No model has been promoted yet." : waiting(failed)}</span>} />
        </ListGroup>
      )}
      {status && <ChartModelGroup chart={model?.chart ?? null} />}
    </>
  );
}

function ChartModelGroup({ chart }: { chart: NonNullable<Status["model"]>["chart"] }) {
  if (!chart) {
    return (
      <ListGroup title="Chart model" footer="It scores the chart reader's points from your ratings, a 0 for one that is no feature at all.">
        <ListRow title={<span role="status" className="text-muted-foreground">None yet: Retrain trains one.</span>} />
      </ListGroup>
    );
  }
  const beats = chart.held_out_mae != null && chart.palette_held_out_mae != null && chart.held_out_mae < chart.palette_held_out_mae;
  return (
    <ListGroup
      title="Chart model"
      badge={<StatusBadge tone={beats ? "up" : "checking"}>{beats ? "Beats the palette" : "Palette still better"}</StatusBadge>}
      footer={`Error on the ${chart.n_test ?? "—"} ratings it held out, lower is better. It scores the training page's points; the checkpoints move onto the chart once it beats the palette's constants.`}
    >
      <ListRow title={chart.model_type ?? "Unknown model"} description={`Trained ${ago(chart.trained_at)} · ${chart.n_labeled ?? "—"} ratings`} />
      <ListRow title="Held-out MAE" value={chart.held_out_mae == null ? "—" : mae(chart.held_out_mae)} />
      <ListRow title="Palette constants" value={chart.palette_held_out_mae == null ? "—" : mae(chart.palette_held_out_mae)} />
      <ListRow title="Predicting the mean" value={chart.dummy_held_out_mae == null ? "—" : mae(chart.dummy_held_out_mae)} />
    </ListGroup>
  );
}

/**
 * The pipeline that would replace the models: how its last run went, as
 * a badge beside the heading, and Retrain, saying why it is off and
 * what turns it on -- the planner's own sentence, how many more to rate
 * -- or what it does. First on the tab, as a confirmed retrain opens it
 * to follow the run. (Airflow is a link in System's Elsewhere in the
 * stack.)
 */
function TrainingGroup() {
  const retrain = useRetrain();
  const { pipeline, lastRun, running, training } = retrain;
  // Why Retrain is off and what turns it on, in the group's note, where
  // it reads at full strength under the dimmed button, as iOS explains a
  // control it has turned off; or, on the row, what it does.
  const blocked = training && !training.ready ? training.message : null;
  return (
    <>
      <ListGroup
        title="Training"
        // How the last run went, beside the heading: the rows that said
        // it and the ratings' count went, the note saying what matters.
        badge={pipeline?.airflow_reachable && (lastRun || running) && <RunBadge state={lastRun?.state} running={running} />}
        footer={!pipeline?.airflow_reachable
          ? <>{pipeline?.detail ?? "Airflow is not reachable from here"}. Retrain by hand with <code className="rounded bg-muted px-1 py-0.5 font-mono">docker compose run --rm pipeline-training chart-retrain</code>.</>
          : running ? undefined : blocked}
      >
        <ListRow
          media={<BrainCircuit className="size-5" />}
          title={running ? "Retraining…" : "Retrain the model"}
          description={running ? "The new model serves only if it does better" : blocked ? undefined : "From every rating; it serves only if it does better"}
          onClick={retrain.start} disabled={!retrain.canStart} data-testid="retrain-row"
        />
      </ListGroup>
      {retrain.confirmDialog}
    </>
  );
}


/** The versions promoted before the model serving, newest first, with
 *  how each moved the error: a page of its own (ConsolePages), opened
 *  from the Model group's count. */
function Versions({ model }: { model: NonNullable<Status["model"]> }) {
  return (
    <ListGroup
      title="Newest first"
      footer={model.candidates.length > 0 && `Also trained, not promoted: ${model.candidates.map(c => `${c.name} (${ago(c.trained_at)})`).join(", ")}.`}
    >
      {model.versions.map((v, i, all) => {
        const older = all[i + 1];
        const delta = v.cv_mae != null && older?.cv_mae != null ? v.cv_mae - older.cv_mae : null;
        return (
          // When it was trained, to the minute, rather than the
          // registry's id (20260915T213500Z), which says the same
          // thing less readably; and under it how this version
          // moved the error against the one before it, in words.
          <ListRow
            key={v.name}
            title={<span className="tabular-nums">{v.trained_at ? WHEN.format(new Date(v.trained_at)) : v.name}</span>}
            description={<>
              {v.model_type ?? "—"}
              {delta !== null && (
                <> · <span className={cn(delta < -0.00005 ? "text-emerald-700 dark:text-emerald-400" : delta > 0.00005 && "text-destructive-ink")}>
                  {Math.abs(delta) <= 0.00005 ? "no change" : `${mae(Math.abs(delta))} ${delta < 0 ? "lower" : "higher"}`}
                </span></>
              )}
            </>}
            value={v.cv_mae == null ? "—" : mae(v.cv_mae)}
          />
        );
      })}
    </ListGroup>
  );
}

/** The Performance tab, for the developer training the model: the
 *  data it learns from, the model serving and the run that would
 *  replace it, and every algorithm compared -- grouped lists, as iOS's
 *  Settings are, with the versions before the model serving a page of
 *  their own. They were three sections folded under their titles. */
function PerformanceTab({ status, failed }: { status: Status | undefined; failed: boolean }) {
  const model = status?.model;
  return (
    <ConsolePages
      back="Performance"
      pages={{ versions: { title: "Versions promoted", content: model ? <Versions model={model} /> : null } }}
    >
      <div className="space-y-6">
        <TrainingGroup />
        <ModelComparison />
        <ModelGroup status={status} failed={failed} />
        <RoutesGroup status={status} failed={failed} />
      </div>
    </ConsolePages>
  );
}

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
 * It is opened without "noopener", which makes window.open return
 * null -- the tab was then never pointed anywhere and stayed blank --
 * and cut off from this page by hand instead.
 *
 * A service with no container yet is a plain link: the sidecar only
 * starts what `docker compose up` created, and refused it every time.
 *
 * A row of a grouped list, as a link out is in Settings, where it was
 * an outlined button in a wrapping line of them.
 */
function StackLink({ link }: { link: { label: string; href: string; service?: string; note?: string } }) {
  const queryClient = useQueryClient();
  const { data: dev } = useQuery({
    queryKey: ["devServices"], queryFn: api.devServices, retry: false, staleTime: 30_000, meta: { silent: true },
  });
  const start = useMutation({ mutationFn: api.startDevService, meta: { silent: true } });

  const state = dev?.services.find(s => s.name === link.service)?.state;
  const startable = !!link.service && dev?.available === true && state !== undefined && state !== "running" && state !== "absent";

  if (!startable) return <ListRow title={link.label} description={link.note} href={link.href} />;

  return (
    <ListRow
      title={start.isPending ? `Starting ${link.service}…` : link.label}
      description={`Not running; opening it starts ${link.service}`}
      disabled={start.isPending}
      onClick={() => {
        const tab = window.open("", "_blank");
        if (tab) tab.opener = null;
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
          onError: err => { tab?.close(); showError(`Could not start ${link.service}`, errorMessage(err, "the sidecar gave no reason")); },
        });
      }}
    >
      <ExternalLink className="size-4 text-tint" aria-hidden />
    </ListRow>
  );
}

/** The collected route on the map behind the console, if it is one:
 *  the Routes section marks its row and says how far its rating has
 *  got. */
function useOnMap(corridors: Status["corridors"]) {
  const params = new URLSearchParams(useLocation().search);
  const onMapKey = `${params.get("dep") ?? ""}-${params.get("dest") ?? ""}`.toUpperCase();
  return corridors.find(c => `${c.departure_ident}-${c.destination_ident}`.toUpperCase() === onMapKey);
}

/** The one action that changes the model, laid out as the three steps
 *  it takes, as numbered rows: load a route, whose chart the reader
 *  reads for its points, rate them in the Model Training panel (what
 *  the chart model learns from), then retrain -- from More beside the
 *  route, or the Performance tab. Then the rating scale and the keys
 *  (RatingGuide). No inputs here: the route at the top of the panel is
 *  what loads a route. It offered to collect one first, from
 *  OpenStreetMap, before the chart was read instead. This planner cannot
 *  train in-process (no scikit-learn of its own, on purpose), so the
 *  retrain goes through Airflow, the same DAG the AWS trigger Lambda
 *  starts; without Airflow reachable the Performance tab says how to run
 *  the pipeline by hand instead. */
function TrainingTab() {
  return (
    <div className="space-y-6">
      <ListGroup title="Train the model">
        <StepRow n={1} title="Load a route" description="At the top of the panel; the chart reader finds its points along it." />
        <StepRow n={2} title="Rate its points" description="In the Model Training panel, every one in flight order; a 0 for one that is no feature at all." />
        <StepRow n={3} title="Retrain" description="From More beside the route, or Performance; the new model serves only if it does better." />
      </ListGroup>
      <RatingGuide />
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


/** A service the planner's snapshot probed: null there means this
 *  deployment does not run it. */
function reported(service: { up: boolean } | null | undefined, snapshotFailed: boolean): Health {
  if (snapshotFailed) return "no answer";
  if (service === null) return "not configured";
  if (service === undefined) return "checking";
  return service.up ? "up" : "down";
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
  pireps: "Pilot reports",
  gairmets: "G-AIRMETs",
  "winds-06": "Winds aloft, next 6 h",
  "winds-12": "Winds aloft, 12 h",
  "winds-24": "Winds aloft, 24 h",
};

/** The FAA charts on disk and the tile pyramid rendered from them, the
 *  System tab's Charts page:
 *  the cycles and the render as rows, then a row per chart kind with
 *  its sheets, its tiles and how far its pyramid has got -- and, while
 *  the FAA has moved on to a newer cycle, how far that one has, being
 *  fetched and rendered in the background. Used to be one run-on line
 *  naming every count, which read as nothing at all, and then a grid
 *  of figures over a five-column table. */
function ChartsSection({ charts, onRefresh, refreshing }: {
  charts: NonNullable<Status["charts"]>; onRefresh: () => void; refreshing: boolean;
}) {
  const sheets = charts.prepared;
  const kinds = Object.keys(CHART_KIND_LABELS).filter(k => sheets[k] || charts.pyramid?.[k] || charts.building?.[k]);
  const newer = charts.current_cycle !== charts.cycle;
  type Pyramid = NonNullable<Status["charts"]>["pyramid"][string];
  const progress = (p: Pyramid | undefined) =>
    !p ? "—"
      : p.current_pass ? `${p.current_pass.done}/${p.current_pass.total} sheets${p.current_pass.current ? `, on ${p.current_pass.current}` : ""}`
      : p.complete ? "complete"
      : `missing ${p.missing.length} sheet${p.missing.length === 1 ? "" : "s"}: ${p.missing.slice(0, 3).join(", ")}${p.missing.length > 3 ? "…" : ""}`;
  const workers = `${charts.refresh_workers} worker${charts.refresh_workers === 1 ? "" : "s"}`;
  return (
    <div className="space-y-6" data-testid="charts-status">
      <ListGroup footer="The FAA charts on disk and the map tiles rendered from them.">
        <ListRow title="Serving cycle" value={charts.cycle} />
        <ListRow title="FAA cycle" value={newer ? `${charts.current_cycle} · ${charts.refresh_running ? "rendering" : "not yet"}` : "the same"} />
        <ListRow title="Tiles" value={charts.tiles_cached.toLocaleString()} />
        <ListRow title="Next render" value={charts.refresh_window ? `${charts.refresh_window}, ${workers}` : `any time, ${workers}`} />
        <ListRow
          title={charts.refresh_running ? "Fetching and rendering…" : "Render now"}
          description="The FAA's current cycle, now rather than at the next daily check"
          onClick={onRefresh} disabled={refreshing || charts.refresh_running}
        />
      </ListGroup>
      <ListGroup title="Chart kinds">
        {kinds.map(k => (
          <ListRow
            key={k} title={CHART_KIND_LABELS[k]}
            description={`${sheets[k] ?? 0} sheets · ${(charts.pyramid?.[k]?.tiles ?? 0).toLocaleString()} tiles · ${progress(charts.pyramid?.[k])}${
              newer ? ` · cycle ${charts.current_cycle}: ${progress(charts.building?.[k])}` : ""}`}
          />
        ))}
        {kinds.length === 0 && <ListRow title={<span className="text-muted-foreground">No chart prepared yet.</span>} />}
      </ListGroup>
    </div>
  );
}

/** Whether a snapshot is one the service worker served from its cache
 *  with the planner out of reach: its own clock says when it was taken,
 *  and one taken more than five minutes ago cannot be this half-minute's
 *  -- however fresh the response that carried it looked. */
const isStale = (status: Status | undefined) =>
  !!status && Date.now() - new Date(status.checked_at).getTime() > 5 * 60_000;

function SystemTab({ status, failed, onRefresh, refreshing }: {
  status: Status | undefined;
  failed: boolean;
  /** Everything the console shows, asked for again now (DevPanel). */
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const stale = isStale(status);
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
  // Every row from the planner's one snapshot, which probed the others
  // -- the webapp's liveness and its readiness group (the database)
  // included -- and the planner itself by having answered. The browser
  // used to probe the webapp and the planner too, and on a phone those
  // requests queued behind the chart tiles on one HTTP/1.1 connection
  // pool, timed out at ten seconds, and read "no answer" for a gateway
  // that had just served the page.
  const services = status?.services;
  const modelService = services?.model_service;
  const rows: { name: string; health: Health; detail: string }[] = [
    { name: "webapp (Spring Boot)", health: reported(services?.webapp, failed), detail: "the gateway, sessions, aircraft and flights" },
    { name: "db (Postgres + pgvector)", health: reported(services?.db, failed), detail: "application data and the agent's memory" },
    { name: "planning-service", health: reported(status ? { up: true } : null, failed), detail: "course, checkpoints, nav log, briefing, chart reading" },
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
  const links: { label: string; href: string; localOnly?: boolean; service?: string; note?: string }[] = [
    { label: "webapp API docs", href: "/swagger-ui/index.html" },
    { label: "planning-service API docs", href: `http://${host}:8084/docs`, localOnly: true },
    { label: "model-service API docs", href: `http://${host}:8000/docs`, localOnly: true, service: "model-service" },
    { label: "Jupyter (the notebooks)", href: `http://${host}:8888`, localOnly: true, service: "ml" },
    { label: "Airflow (the training DAG)", href: `http://${host}:8081`, localOnly: true, service: "airflow" },
    // The sidecar can start it; its one page is the MCP stream, which
    // answers 401 without the bearer token -- enough to see it is up.
    {
      label: "nav-log-agent (MCP)", href: `http://${host}:8082/mcp/sse`, localOnly: true, service: "nav-log-agent",
      note: "The MCP stream; its bearer token is in the agent's README",
    },
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
  const shown: typeof links = [{ label: "This snapshot as JSON", href: "/api/planner/status" }, ...links];

  const datasets: { name: string; file: string; source: string; updated: string | null | undefined }[] = [
    ...(status?.faa_files ?? []).map(f => ({
      name: DATASET_NAMES[f.name] ?? f.name, file: f.name.split("/").pop() ?? f.name, source: "FAA", updated: f.downloaded_at,
    })),
    ...(status?.weather ?? []).map(w => ({
      name: DATASET_NAMES[w.name] ?? w.name, file: w.name, source: "aviationweather.gov", updated: w.fetched_at,
    })),
  ];

  // Services on the tab's own page, since what answers right now is what
  // the tab is opened for; the reference data, the charts and the links
  // a row each that opens a page of its own (ConsolePages), as iOS's
  // Settings goes deeper. They were sections folded under their titles,
  // and four tables at once had been a screen and a half of scrolling.
  return (
    <ConsolePages
      back="System"
      pages={{
        data: {
          title: "Reference data",
          content: (
            // When it was fetched -- the one thing looked for -- at the
            // row's end, and the file and its source under its name.
            <ListGroup footer="The files the planner reads and how old each copy is.">
              {datasets.map(d => (
                <ListRow
                  key={d.file} title={d.name}
                  description={<><span className="font-mono">{d.file}</span> · {d.source}</>}
                  value={d.updated ? ago(d.updated) : "not fetched yet"}
                />
              ))}
              {datasets.length === 0 && (
                <ListRow title={<span className="text-muted-foreground">{status ? "Nothing on disk yet." : waiting(failed)}</span>} />
              )}
            </ListGroup>
          ),
        },
        charts: {
          title: "Charts",
          content: status?.charts
            ? <ChartsSection charts={status.charts} onRefresh={() => refreshCharts.mutate()} refreshing={refreshCharts.isPending} />
            : <ListGroup><ListRow title={<span className="text-muted-foreground">{waiting(failed)}</span>} /></ListGroup>,
        },
        errors: {
          title: "Recent errors",
          content: (
            // What the planner failed at lately, the newest first: the call
            // a pilot made, its status and its words (app.errors).
            <ListGroup footer="The planner's last 50 answers of 500 or more since it started, and the exceptions no handler caught.">
              {(status?.recent_errors ?? []).map((e, i) => (
                <ListRow
                  key={`${e.at}-${i}`}
                  title={<span className="font-mono break-all">{e.method} {e.path}</span>}
                  description={e.detail}
                  value={<span className="whitespace-nowrap">{e.status} · {ago(new Date(e.at * 1000).toISOString())}</span>}
                  data-testid="recent-error"
                />
              ))}
              {(status?.recent_errors ?? []).length === 0 && (
                <ListRow title={<span className="text-muted-foreground">{status ? "None since the planner started." : waiting(failed)}</span>} />
              )}
            </ListGroup>
          ),
        },
        elsewhere: {
          title: "Elsewhere in the stack",
          content: (
            // docker-compose publishes the last five on 127.0.0.1; its lan
            // overlay publishes them to the network, Jupyter with no
            // password, which is why the file is to be read first.
            <ListGroup
              footer={<>Each in a new tab. The last five open only where the stack runs; <span className="font-mono">docker-compose.lan.yml</span> publishes them (read it first).</>}
            >
              {shown.map(l => <StackLink key={l.href} link={l} />)}
            </ListGroup>
          ),
        },
      }}
    >
      <div className="space-y-6">
        {stale && status && (
          // The service worker serves the last snapshot it has when the
          // planner is out of reach, and it arrives looking like an
          // answer; its own clock gives it away. Said here, and the
          // rows dimmed, rather than "up" in green for services that
          // may be anything by now.
          <p className={cn("px-1 text-amber-700 dark:text-amber-400", TEXT.note)} data-testid="stale-snapshot">
            The planner has not answered since this snapshot, {ago(status.checked_at)}: what follows is what was true then.
          </p>
        )}
        {/* As the planner found them a moment ago: the gateway and its
            database through Spring's actuator, the model service and the
            agents through their own probes, the planner by answering. A
            row a service, its role under its name and the status at its
            end. */}
        {/* When the snapshot was taken under them: it was the console's
            last line on every tab, the Guide's too, where it meant
            nothing. */}
        <ListGroup
          title="Services" className={cn(stale && "opacity-60")}
          footer={status && <>Checked {ago(status.checked_at)}{stale && " — the planner has not answered since"}.</>}
        >
          {rows.map(r => (
            <ListRow key={r.name} title={r.name} description={r.detail}>
              <StatusBadge tone={HEALTH[r.health].tone}>{HEALTH[r.health].label}</StatusBadge>
            </ListRow>
          ))}
        </ListGroup>
        <ListGroup>
          {/* The count alone at the row's end: with the oldest's date as
              well the name wrapped on a phone. The page has the dates. */}
          <PageRow page="data" title="Reference data" value={status ? `${datasets.length} files` : undefined} />
          <PageRow page="charts" title="Charts" value={status?.charts ? `cycle ${status.charts.cycle}` : undefined} />
          <PageRow page="errors" title="Recent errors" value={status ? (status.recent_errors ?? []).length : undefined} />
          <PageRow page="elsewhere" title="Elsewhere in the stack" value={shown.length} />
        </ListGroup>
        {/* The services and the data are probed on a 30-second tick, and
            this asks now: an action row at the tab's foot, as the pilot
            asked, where it was an icon beside the tabs. */}
        <ListGroup>
          <ListRow
            media={<RefreshCw className={cn("size-5", refreshing && "animate-spin")} />}
            title="Check again" description="It checks by itself every 30 seconds"
            onClick={onRefresh} disabled={refreshing} data-testid="dev-refresh"
          />
        </ListGroup>
      </div>
    </ConsolePages>
  );
}
