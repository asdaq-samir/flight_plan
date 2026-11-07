"""What a developer looks at before trusting the planner, in one
snapshot for Settings' Dev tab: which services answer, how fresh the
reference data is, which model is promoted and how it was trained, which
corridors are built and how far their labels have come -- and the one
pipeline action offered from here, a retrain: the training run
(`python -m wingtip.pipeline run`) as a container the dev-services
sidecar starts."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from fastapi import APIRouter, HTTPException
from wingtip import chartlabels, charts, checkpoint_notes, data_cycles, model_registry, retry, weather
from wingtip.terrain import DEFAULT_FAA_CACHE_DIR

from .. import chart_model, chart_refresh, errors
from ..common import PROCESSED_DIR, paths
from ..settings import CHARTS_REFRESH_WINDOW, CHARTS_REFRESH_WORKERS, get_settings
from ..schemas import (
    ChartModelSnapshot,
    ChartRefreshStarted,
    CorridorStatus,
    DataFile,
    ModelSnapshot,
    ModelVersion,
    PipelineRun,
    PipelineStage,
    PipelineStatus,
    RetrainStarted,
    ServiceStatus,
    Status,
    TrainingReadiness,
    WeatherDataset,
)

from . import devservices

router = APIRouter()

# The gateway, by its compose name; its actuator answers liveness and
# readiness (the readiness group includes the database).
WEBAPP_URL = get_settings().webapp_url
PROBE_TIMEOUT_S = 3.0

# The FAA downloads a nav log depends on, wherever wingtip keeps them.
FAA_FILES = ("DOF.DAT", "NAV_BASE.csv", "APT_BASE.csv", "Shape_Files/Class_Airspace.shp")


def _iso(unix: float | None) -> str | None:
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat() if unix else None


def _mtime(path: Path) -> str | None:
    try:
        return _iso(path.stat().st_mtime)
    except OSError:
        return None


def _webapp_status() -> tuple[ServiceStatus, ServiceStatus]:
    """The webapp's liveness, and its readiness -- which includes the
    database, so that is the database's row -- each as up only on a
    200: a 503 from the actuator is a running process saying no."""
    def ask(path: str) -> ServiceStatus:
        try:
            resp = requests.get(f"{WEBAPP_URL}/actuator/health/{path}", timeout=PROBE_TIMEOUT_S)
            return ServiceStatus(up=resp.ok, detail=f"HTTP {resp.status_code}")
        except requests.RequestException as err:
            return ServiceStatus(up=False, detail=str(err).split("\n")[0][:160])
    return ask("liveness"), ask("readiness")


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _read_metrics(directory: Path) -> dict | None:
    return _read_json(directory / "metrics.json")


def _current_model() -> ModelSnapshot | None:
    metrics = _read_metrics(model_registry.CURRENT_MODEL_DIR)
    if metrics is None:
        return None
    return ModelSnapshot(
        model_type=metrics.get("model_type"), trained_at=metrics.get("trained_at"),
        cv_mae=metrics.get("cv_mae"), held_out_mae=metrics.get("held_out_mae"),
        n_labeled=metrics.get("n_labeled"), n_features=len(metrics.get("feature_cols", [])),
    )


def _chart_model() -> ChartModelSnapshot | None:
    metrics = _read_metrics(model_registry.CHART_CURRENT_DIR)
    if metrics is None:
        return None
    return ChartModelSnapshot(**{k: metrics.get(k) for k in ChartModelSnapshot.model_fields})


def _versions() -> list[ModelVersion]:
    versions_dir = model_registry.MODELS_DIR / "versions"
    out = []
    for directory in sorted(versions_dir.glob("*"), reverse=True):
        metrics = _read_metrics(directory)
        if metrics is None:
            continue
        out.append(ModelVersion(
            name=directory.name, model_type=metrics.get("model_type"),
            trained_at=metrics.get("trained_at"), cv_mae=metrics.get("cv_mae"),
        ))
    return out


def _corridors() -> list[CorridorStatus]:
    out = []
    for features in sorted(PROCESSED_DIR.glob("features_*.parquet")):
        slug = features.stem[len("features_"):]
        dep, _, dest = slug.partition("_")
        if not dep or not dest:
            continue
        dep, dest = dep.upper(), dest.upper()
        candidates, _ = paths(dep, dest)
        n_candidates = None
        if candidates.exists():
            with candidates.open() as f:
                n_candidates = max(sum(1 for _ in f) - 1, 0)
        route = chartlabels.route_key(dep, dest)
        out.append(CorridorStatus(
            departure_ident=dep, destination_ident=dest, candidates=n_candidates,
            features_built_at=_mtime(features), labels=chartlabels.summarise(route),
            notes=checkpoint_notes.places(route),
        ))
    return out


def _faa_files() -> list[DataFile]:
    out = []
    for name in FAA_FILES:
        for base in (DEFAULT_FAA_CACHE_DIR, DEFAULT_FAA_CACHE_DIR.parent):
            path = base / name
            if path.exists():
                out.append(DataFile(name=name, downloaded_at=_mtime(path)))
                break
    return out


def _weather_datasets() -> list[WeatherDataset]:
    return [WeatherDataset(name=name, fetched_at=_iso(fetched)) for name, fetched in weather.dataset_status().items()]


# How to run the training by hand, where the console cannot start it. The
# compose container, not a one-off `compose run`: the sidecar sees only the
# former, and the console reads "is a run going" from it.
BY_HAND = "docker compose up retrain"
RUN_GOING = "A training run is going already; follow it in Performance."


def _last_run() -> PipelineRun | None:
    """The last training run, from the status file it writes as it goes,
    or None before the first."""
    run = _read_json(model_registry.RUN_STATUS_PATH)
    if run is None:
        return None
    return PipelineRun(
        run_id=run.get("run_id"), state=run.get("state"), stage=run.get("stage"),
        started_at=run.get("started_at"), finished_at=run.get("finished_at"), error=run.get("error"),
        stages=[PipelineStage(**s) for s in run.get("stages", []) if isinstance(s, dict) and "name" in s and "state" in s],
    )


def _training() -> TrainingReadiness | None:
    """Whether the ratings are enough to train the chart model on
    (app.chart_model), or None where that cannot be worked out -- a
    file missing or half written, a corridor that would not read -- which
    is the trainer's to report when it runs.

    The chart model's, not the landmark model's: the ratings are made on
    the chart reader's points, and the landmark model could use only
    those within 0.2 nm of an OpenStreetMap landmark and above 0 -- 7 of
    32. A run still retrains the landmark model when it has enough
    (its landmarks_ready stage), and skips it when not."""
    try:
        return TrainingReadiness(**chart_model.readiness())
    except (OSError, ValueError, KeyError, RuntimeError):
        return None


def _pipeline_status() -> PipelineStatus:
    """The training run's container, as the sidecar sees it, beside the
    run's own status file. The container is the truth on whether a run
    is going: the file still shows the last run until the new one has
    written its first line, and says "running" for ever after a run
    whose container was stopped part-way."""
    container = devservices.service_state(devservices.RETRAIN_SERVICE)
    last = _last_run()
    if container == "running":
        if last is None or last.state != "running":
            last = PipelineRun(run_id=None, state="running", stage=None)
    elif last is not None and last.state == "running" and container is not None:
        last = last.model_copy(update={"state": "failed", "error": last.error or "The run stopped before it finished."})
    if container is None:
        detail = f"No dev-services sidecar to start a run from here. By hand: {BY_HAND}"
    elif container == "absent":
        detail = "The training run has no container yet: docker compose create retrain, once"
    else:
        detail = None
    return PipelineStatus(startable=detail is None, last_run=last, detail=detail)


@router.get("/api/status")
def status() -> Status:
    """One snapshot of the whole stack, for Settings' Dev tab. The
    network probes run side by side so a service that is down costs one
    timeout, not one per service."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        webapp = pool.submit(_webapp_status)
        pipeline = pool.submit(_pipeline_status)
        # Each FAA data set's cycle, from the disk; one out of date is
        # logged too (once a day), for the owner.
        cycles = data_cycles.status()
        data_cycles.warn_if_out_of_date(cycles)
        return Status(
            checked_at=datetime.now(tz=timezone.utc).isoformat(),
            services={
                "webapp": webapp.result()[0],
                "db": webapp.result()[1],
            },
            faa_files=_faa_files(),
            weather=_weather_datasets(),
            charts={**charts.status(), "refresh_window": CHARTS_REFRESH_WINDOW, "refresh_workers": CHARTS_REFRESH_WORKERS},
            model={"current": _current_model(), "versions": _versions(),
                   "chart": _chart_model()},
            pipeline=pipeline.result().model_copy(update={"training": _training()}),
            corridors=_corridors(),
            recent_errors=errors.recent(),
            data_cycles=cycles,
        )


@router.post("/api/charts/refresh")
def refresh_charts() -> ChartRefreshStarted:
    """Fetch and render the FAA's current chart cycle now, in a
    subprocess of the planner's own -- the same job it runs daily by
    itself. `started` is False when one is already running."""
    return ChartRefreshStarted(started=chart_refresh.refresh_now(), current_cycle=charts.current_cycle())


@router.post("/api/retrain")
def retrain() -> RetrainStarted:
    """Starts one training run (`python -m wingtip.pipeline run`): the
    chart model (retrain, evaluate, promote) and the landmark model where
    it has the ratings (collect, engineer features, retrain, evaluate,
    promote), each promoted only if it beats the one serving. The run is
    compose's `retrain` container, started through the dev-services
    sidecar, the one door onto Docker (routers/devservices.py). This
    service has no scikit-learn of its own on purpose (see
    requirements.txt), so it cannot train in-process; without the
    sidecar the answer says how to run it by hand.

    Checked first (app.chart_model.readiness): with too few ratings to
    learn from, it says so and what to do, a 409, rather than starting a
    run that ends minutes later with the same news in its log. Then the
    chart model's table is written from the ratings as they are now,
    which the run trains on."""
    training = _training()
    if training is not None and not training.ready:
        raise HTTPException(409, training.message)
    # Before the table is written: a run going now is training on it.
    if devservices.service_state(devservices.RETRAIN_SERVICE) == "running":
        raise HTTPException(409, RUN_GOING)
    try:
        chart_model.write_training_table()
    except (OSError, ValueError, RuntimeError) as err:
        raise HTTPException(500, f"The chart model's training table could not be written: {err}") from err
    response = devservices._sidecar("POST", f"/services/{devservices.RETRAIN_SERVICE}/start")
    if response is None:
        raise HTTPException(501, f"Retraining starts through the dev-services sidecar, which this planner has none of. By hand: {BY_HAND}")
    if response.status_code != 200:
        raise HTTPException(response.status_code, retry.upstream_detail(response, "the dev-services sidecar"))
    body = response.json()
    if not body.get("started") and body.get("state") == "running":
        raise HTTPException(409, RUN_GOING)
    return RetrainStarted(started=bool(body.get("started")), state=body.get("state"))
