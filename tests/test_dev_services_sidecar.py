"""docker/dev-services/server.py: the one process holding the Docker
socket for the developer console. What it must never do is reach the
Docker API for anything but listing and starting its own four
services -- that is the whole reason it replaced a socket proxy."""
import importlib.util
import json
import urllib.parse
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "docker" / "dev-services" / "server.py"
_spec = importlib.util.spec_from_file_location("dev_services_server", _PATH)
server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(server)

ALLOWED = ("ml", "airflow")


class FakeDocker:
    """Records every Docker API call; answers from a table of containers."""

    def __init__(self, containers: dict):
        self.containers = containers  # service name -> state
        self.calls = []

    def __call__(self, method, path):
        self.calls.append((method, path))
        if method == "GET" and path.startswith("/containers/json"):
            name = next((n for n in self.containers if f"service%3D{n}%22" in path), None)
            if name is None:
                return 200, []
            return 200, [{"Id": f"id-{name}", "State": self.containers[name]}]
        if method == "POST" and path.endswith("/start"):
            name = path.split("/")[2].removeprefix("id-")
            self.containers[name] = "running"
            return 204, None
        raise AssertionError(f"unexpected Docker call {method} {path}")


def test_states_report_every_allowed_service():
    api = FakeDocker({"ml": "exited"})
    assert server.states("flight_plan", ALLOWED, api) == [
        {"name": "ml", "state": "exited"},
        {"name": "airflow", "state": "absent"},
    ]


def test_start_starts_a_stopped_service():
    api = FakeDocker({"ml": "exited"})
    status, body = server.start("ml", "flight_plan", ALLOWED, api)
    assert (status, body) == (200, {"name": "ml", "state": "running", "started": True})
    assert ("POST", "/containers/id-ml/start") in api.calls


def test_start_leaves_a_running_service_alone():
    api = FakeDocker({"ml": "running"})
    status, body = server.start("ml", "flight_plan", ALLOWED, api)
    assert (status, body["started"]) == (200, False)
    assert not any(method == "POST" for method, _ in api.calls)


@pytest.mark.parametrize("name", ["webapp", "db", "../containers/create", ""])
def test_start_refuses_anything_off_the_list_without_touching_docker(name):
    api = FakeDocker({"webapp": "exited"})
    status, _ = server.start(name, "flight_plan", ALLOWED, api)
    assert status == 404
    assert api.calls == []


def test_start_needs_an_existing_container():
    status, body = server.start("airflow", "flight_plan", ALLOWED, FakeDocker({}))
    assert status == 409
    assert "docker compose up -d airflow" in body["detail"]


def test_lookups_are_scoped_to_the_project():
    api = FakeDocker({"ml": "running"})
    server.states("other_checkout", ("ml",), api)
    (_, path), = api.calls
    assert "com.docker.compose.project%3Dother_checkout" in path


class LabelledDocker:
    """Lists containers the way Docker does -- every label in the filter
    must match -- so a one-off's labels are what decide."""

    def __init__(self, containers: list):
        self.containers = containers
        self.calls = []

    def __call__(self, method, path):
        self.calls.append((method, path))
        if method == "GET" and path.startswith("/containers/json"):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
            wanted = [label.split("=", 1) for label in json.loads(query["filters"][0])["label"]]
            return 200, [c for c in self.containers if all(c["Labels"].get(k) == v for k, v in wanted)]
        if method == "POST" and path.endswith("/start"):
            return 204, None
        raise AssertionError(f"unexpected Docker call {method} {path}")


def _container(id_: str, state: str, oneoff: bool) -> dict:
    return {"Id": id_, "State": state, "Labels": {
        "com.docker.compose.project": "flight_plan", "com.docker.compose.service": "ml",
        "com.docker.compose.oneoff": str(oneoff),
    }}


def test_a_one_off_run_is_never_taken_for_the_service():
    # `docker compose run ml ...` carries the service's labels: a training
    # run showed as Jupyter running, and an exited one was restarted in
    # Jupyter's place.
    api = LabelledDocker([_container("run-1", "exited", oneoff=True)])
    assert server.states("flight_plan", ("ml",), api) == [{"name": "ml", "state": "absent"}]
    status, _ = server.start("ml", "flight_plan", ("ml",), api)
    assert status == 409
    assert not any(method == "POST" for method, _ in api.calls)


def test_the_service_container_is_started_beside_a_running_one_off():
    api = LabelledDocker([_container("run-1", "running", oneoff=True), _container("svc", "exited", oneoff=False)])
    assert server.states("flight_plan", ("ml",), api) == [{"name": "ml", "state": "exited"}]
    server.start("ml", "flight_plan", ("ml",), api)
    assert ("POST", "/containers/svc/start") in api.calls
