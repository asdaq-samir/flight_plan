"""What a developer looks at before trusting the planner, in one
snapshot for Settings' Dev tab: which services answer, how fresh the
reference data is, which model is promoted and how it was trained, which
corridors are built and how far their labels have come -- and the one
pipeline action offered from here, a retrain run through Airflow."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from fastapi import APIRouter, HTTPException
from vfr import chartlabels, charts, checkpoint_notes, model_registry, weather
from vfr.terrain import DEFAULT_FAA_CACHE_DIR

from .. import chart_refresh
from ..common import PROCESSED_DIR, paths
from ..settings import CHARTS_REFRESH_WINDOW, CHARTS_REFRESH_WORKERS
from ..schemas import (
    CandidateModel,
    ChartRefreshStarted,
    CorridorStatus,
    DataFile,
    ModelServiceStatus,
    ModelSnapshot,
    ModelVersion,
    PipelineRun,
    PipelineStatus,
    RetrainStarted,
    ServiceStatus,
    Status,
    WeatherDataset,
)

router = APIRouter()

MODEL_SERVICE_URL = os.environ.get("MODEL_SERVICE_URL", "http://model-service:8000")
# Both optional: unset (the AWS task, or a compose file that leaves them
# out) reports the agent as "not configured" rather than down.
NAV_LOG_AGENT_URL = os.environ.get("NAV_LOG_AGENT_URL")
CREWAI_AGENT_URL = os.environ.get("CREWAI_AGENT_URL")
# Airflow, for the retrain button: its API base, the DAG to run, and
# credentials -- AIRFLOW_USERNAME/AIRFLOW_PASSWORD, or the passwords file
# Airflow's own standalone mode generates (docker-compose.yml mounts that
# volume here read-only, so a local stack needs no configuration).
AIRFLOW_URL = os.environ.get("AIRFLOW_URL")
AIRFLOW_DAG_ID = os.environ.get("AIRFLOW_DAG_ID", "vfr_pipeline")
AIRFLOW_PASSWORDS_FILE = os.environ.get("AIRFLOW_PASSWORDS_FILE")
PROBE_TIMEOUT_S = 3.0

# The FAA downloads a nav log depends on, wherever vfr keeps them.
FAA_FILES = ("DOF.DAT", "NAV_BASE.csv", "APT_BASE.csv", "Shape_Files/Class_Airspace.shp")
CANDIDATE_FRAMEWORKS = ("pytorch", "tensorflow", "spark")


def _iso(unix: float | None) -> str | None:
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat() if unix else None


def _mtime(path: Path) -> str | None:
    try:
        return _iso(path.stat().st_mtime)
    except OSError:
        return None


def probe(url: str) -> tuple[bool, str]:
    """Whether anything answers at url. Any HTTP status counts as up --
    nav-log-agent answers 401 to a call without its bearer token, and
    that is a running service saying so."""
    try:
        resp = requests.get(url, timeout=PROBE_TIMEOUT_S)
        return True, f"HTTP {resp.status_code}"
    except requests.RequestException as err:
        return False, str(err).split("\n")[0][:160]


def _model_service_status() -> ModelServiceStatus:
    try:
        resp = requests.get(f"{MODEL_SERVICE_URL}/ping", timeout=PROBE_TIMEOUT_S)
        body = resp.json() if resp.ok else {}
        return ModelServiceStatus(
            up=resp.ok, detail=f"HTTP {resp.status_code}",
            trained_at=body.get("trained_at"), models=body.get("models", {}),
        )
    except (requests.RequestException, ValueError) as err:
        return ModelServiceStatus(up=False, detail=str(err).split("\n")[0][:160])


def _agent_status(url: str | None) -> ServiceStatus | None:
    if not url:
        return None
    up, detail = probe(url)
    return ServiceStatus(up=up, detail=detail)


def _read_metrics(directory: Path) -> dict | None:
    path = directory / "metrics.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _current_model() -> ModelSnapshot | None:
    metrics = _read_metrics(model_registry.CURRENT_MODEL_DIR)
    if metrics is None:
        return None
    return ModelSnapshot(
        model_type=metrics.get("model_type"), trained_at=metrics.get("trained_at"),
        cv_mae=metrics.get("cv_mae"), held_out_mae=metrics.get("held_out_mae"),
        n_labeled=metrics.get("n_labeled"), n_features=len(metrics.get("feature_cols", [])),
    )


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


def _candidates() -> list[CandidateModel]:
    """The other frameworks' own models (vfr.model_candidates), which the
    registry compares against but never promotes."""
    out = []
    for name in CANDIDATE_FRAMEWORKS:
        metrics = _read_metrics(model_registry.MODELS_DIR / "candidates" / name)
        if metrics is None:
            continue
        metric = "cv_mae" if "cv_mae" in metrics else ("held_out_mae" if "held_out_mae" in metrics else None)
        out.append(CandidateModel(
            name=name, model_type=metrics.get("model_type"), trained_at=metrics.get("trained_at"),
            metric=metric, score=metrics.get(metric) if metric else None,
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
            notes=len(checkpoint_notes.load_notes(route)),
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
    now = datetime.now(tz=timezone.utc).timestamp()
    out = []
    for name in ("metars", "tafs", "airsigmets"):
        cached = weather._DATASETS.get(name)
        fetched = cached["at"] if cached else None
        out.append(WeatherDataset(name=name, fetched_at=_iso(fetched), age_s=(now - fetched) if fetched else None))
    return out


def _airflow_credentials() -> tuple[str, str] | None:
    user, password = os.environ.get("AIRFLOW_USERNAME"), os.environ.get("AIRFLOW_PASSWORD")
    if user and password:
        return user, password
    if AIRFLOW_PASSWORDS_FILE:
        try:
            passwords = json.loads(Path(AIRFLOW_PASSWORDS_FILE).read_text())
        except (OSError, ValueError):
            return None
        user = user or "admin"
        if passwords.get(user):
            return user, passwords[user]
    return None


def _airflow_token(user: str, password: str) -> str:
    resp = requests.post(f"{AIRFLOW_URL}/auth/token", json={"username": user, "password": password}, timeout=10)
    resp.raise_for_status()
    return resp.json()["access_token"]


def _pipeline_unreachable(detail: str, configured: bool) -> PipelineStatus:
    return PipelineStatus(
        airflow_configured=configured, airflow_reachable=False, airflow_url=AIRFLOW_URL,
        dag_id=AIRFLOW_DAG_ID if AIRFLOW_URL else None, last_run=None, detail=detail,
    )


def _pipeline_status() -> PipelineStatus:
    if not AIRFLOW_URL:
        return _pipeline_unreachable("AIRFLOW_URL is not set", configured=False)
    creds = _airflow_credentials()
    if creds is None:
        return _pipeline_unreachable("no Airflow credentials (AIRFLOW_USERNAME/AIRFLOW_PASSWORD or the passwords file)",
                                     configured=False)
    try:
        token = _airflow_token(*creds)
        resp = requests.get(
            f"{AIRFLOW_URL}/api/v2/dags/{AIRFLOW_DAG_ID}/dagRuns",
            params={"order_by": "-logical_date", "limit": 1},
            headers={"Authorization": f"Bearer {token}"}, timeout=PROBE_TIMEOUT_S,
        )
        resp.raise_for_status()
        runs = resp.json().get("dag_runs", [])
    except requests.ConnectionError:
        return _pipeline_unreachable(f"Airflow at {AIRFLOW_URL} is not running", configured=True)
    except (requests.RequestException, ValueError, KeyError) as err:
        return _pipeline_unreachable(f"Airflow did not answer: {str(err).split(chr(10))[0][:160]}", configured=True)
    last = runs[0] if runs else None
    return PipelineStatus(
        airflow_configured=True, airflow_reachable=True, airflow_url=AIRFLOW_URL, dag_id=AIRFLOW_DAG_ID, detail=None,
        last_run=PipelineRun(
            dag_run_id=last.get("dag_run_id"), state=last.get("state"),
            start_date=last.get("start_date"), end_date=last.get("end_date"),
        ) if last else None,
    )


@router.get("/api/status")
def status() -> Status:
    """One snapshot of the whole stack, for Settings' Dev tab. The
    network probes run side by side so a service that is down costs one
    timeout, not one per service."""
    with ThreadPoolExecutor(max_workers=4) as pool:
        model_service = pool.submit(_model_service_status)
        nav_log_agent = pool.submit(_agent_status, NAV_LOG_AGENT_URL)
        crewai_agent = pool.submit(_agent_status, CREWAI_AGENT_URL)
        pipeline = pool.submit(_pipeline_status)
        return Status(
            checked_at=datetime.now(tz=timezone.utc).isoformat(),
            services={
                "model_service": model_service.result(),
                "nav_log_agent": nav_log_agent.result(),
                "crewai_agent": crewai_agent.result(),
            },
            faa_files=_faa_files(),
            weather=_weather_datasets(),
            charts={**charts.status(), "refresh_window": CHARTS_REFRESH_WINDOW, "refresh_workers": CHARTS_REFRESH_WORKERS},
            model={"current": _current_model(), "versions": _versions(), "candidates": _candidates()},
            pipeline=pipeline.result(),
            corridors=_corridors(),
        )


@router.post("/api/charts/refresh")
def refresh_charts() -> ChartRefreshStarted:
    """Fetch and render the FAA's current chart cycle now, in a
    subprocess of the planner's own -- the same job it runs daily by
    itself. `started` is False when one is already running."""
    return ChartRefreshStarted(started=chart_refresh.refresh_now(), current_cycle=charts.current_cycle())


@router.post("/api/retrain")
def retrain() -> RetrainStarted:
    """Starts one run of the training DAG (collect, engineer features,
    retrain, evaluate, promote) through Airflow's own API -- the same
    thing the AWS retrain-trigger Lambda does. This service has no
    scikit-learn of its own on purpose (see requirements.txt), so it
    cannot train in-process; without Airflow reachable the answer says
    how to run the pipeline by hand."""
    if not AIRFLOW_URL:
        raise HTTPException(501, "Retraining runs through Airflow and this planner has no AIRFLOW_URL. "
                                 "By hand: docker compose run --rm pipeline-training retrain")
    creds = _airflow_credentials()
    if creds is None:
        raise HTTPException(501, "No Airflow credentials: set AIRFLOW_USERNAME and AIRFLOW_PASSWORD, or mount "
                                 "Airflow's generated passwords file (AIRFLOW_PASSWORDS_FILE)")
    try:
        token = _airflow_token(*creds)
        headers = {"Authorization": f"Bearer {token}"}
        # Airflow parks every newly discovered DAG paused, and a run
        # triggered on a paused DAG sits "queued" forever -- which is
        # exactly what the first retrain from a fresh stack did, for
        # half an hour, before anyone looked. Unpausing first is
        # idempotent and is what a person would do in Airflow's UI.
        unpause = requests.patch(
            f"{AIRFLOW_URL}/api/v2/dags/{AIRFLOW_DAG_ID}", json={"is_paused": False}, headers=headers, timeout=10,
        )
        if unpause.status_code >= 400:
            raise HTTPException(502, f"Airflow would not unpause {AIRFLOW_DAG_ID}: {unpause.status_code} {unpause.text[:200]}")
        resp = requests.post(
            f"{AIRFLOW_URL}/api/v2/dags/{AIRFLOW_DAG_ID}/dagRuns",
            json={"logical_date": None}, headers=headers, timeout=10,
        )
    except requests.RequestException as err:
        raise HTTPException(502, f"Airflow at {AIRFLOW_URL} did not accept the run: {str(err).split(chr(10))[0][:160]}") from err
    if resp.status_code >= 400:
        raise HTTPException(502, f"Airflow answered {resp.status_code}: {resp.text[:200]}")
    body = resp.json()
    return RetrainStarted(dag_run_id=body.get("dag_run_id"), state=body.get("state"))
