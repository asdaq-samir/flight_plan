"""/api/build: one corridor build at a time from a short queue, and a
failure reported in one line rather than a traceback."""
import threading
import time

from fastapi.testclient import TestClient
from vfr import pipeline

from app import common
from app.main import app
from app.routers import build

client = TestClient(app)


def _setup(monkeypatch, tmp_path, collect):
    monkeypatch.setattr(common, "PROCESSED_DIR", tmp_path)
    monkeypatch.setattr(build, "paths", lambda dep, dest: (tmp_path / f"c_{dep}_{dest}.csv", tmp_path / f"f_{dep}_{dest}.parquet"))
    monkeypatch.setattr(build, "resolve", lambda dep, dest: None)
    monkeypatch.setattr(pipeline, "collect", collect)
    monkeypatch.setattr(pipeline, "engineer_features", lambda in_path, out_path: out_path.write_text("x"))
    monkeypatch.setattr(build, "_builds", {})
    import queue
    monkeypatch.setattr(build, "_queue", queue.Queue())
    monkeypatch.setattr(build, "_worker", None)


def _start(dep, dest):
    return client.post("/api/build", json={"departure_ident": dep, "destination_ident": dest})


def _wait(job_id, state, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/build/{job_id}").json()
        if job["state"] == state:
            return job
        time.sleep(0.02)
    raise AssertionError(f"{job_id} never reached {state}: {job}")


def test_one_build_runs_and_the_rest_wait_their_turn(monkeypatch, tmp_path):
    release = threading.Event()
    running = []

    def collect(dep_ident, dest_ident, out_path):
        running.append(dep_ident)
        release.wait(5)

    _setup(monkeypatch, tmp_path, collect)
    first = _start("C81", "KDLH").json()
    _wait(first["job_id"], "running")
    second = _start("KMSP", "KDLH").json()

    assert second["state"] == "queued"
    assert running == ["C81"]
    release.set()
    _wait(second["job_id"], "done")
    assert running == ["C81", "KMSP"]


def test_the_same_route_joins_its_job_and_a_full_queue_is_refused(monkeypatch, tmp_path):
    release = threading.Event()
    _setup(monkeypatch, tmp_path, lambda dep_ident, dest_ident, out_path: release.wait(5))
    first = _start("C81", "KDLH").json()
    _wait(first["job_id"], "running")

    assert _start("C81", "KDLH").json()["job_id"] == first["job_id"]
    for i in range(build.MAX_QUEUED):
        assert _start(f"K{i:03d}", "KDLH").status_code == 200
    assert _start("KORD", "KDLH").status_code == 429
    release.set()
    build._queue.join()  # the queued ones run against these stubs, not the real pipeline


def test_a_failure_is_one_line_with_no_traceback(monkeypatch, tmp_path):
    def collect(dep_ident, dest_ident, out_path):
        raise OSError("/workspace/data/raw/secret.csv: no space left")

    _setup(monkeypatch, tmp_path, collect)
    job = _wait(_start("C81", "KDLH").json()["job_id"], "failed")

    assert job["detail"].startswith("OSError: ")
    assert "traceback" not in job
    assert "Traceback" not in str(job)


def test_finished_jobs_are_forgotten_after_an_hour(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, lambda dep_ident, dest_ident, out_path: None)
    job_id = _start("C81", "KDLH").json()["job_id"]
    _wait(job_id, "done")

    build._builds[job_id]["finished"] -= build.KEEP_FINISHED_S + 1
    assert client.get(f"/api/build/{job_id}").status_code == 404
