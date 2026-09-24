"""/api/dev/services: the console's start buttons, answered by asking the
dev-services sidecar rather than Docker itself."""
from fastapi.testclient import TestClient

from app.main import app
from app.routers import devservices

client = TestClient(app)


class FakeResponse:
    def __init__(self, status_code: int, body):
        self.status_code = status_code
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def test_no_sidecar_means_nothing_to_offer(monkeypatch):
    monkeypatch.setattr(devservices, "SIDECAR_URL", None)

    assert client.get("/api/dev/services").json() == {"available": False, "services": []}
    assert client.post("/api/dev/services/ml/start").status_code == 503


def test_states_come_from_the_sidecar_with_the_consoles_labels(monkeypatch):
    calls = []

    def sidecar(method, path):
        calls.append((method, path))
        return FakeResponse(200, [{"name": "ml", "state": "running"}])

    monkeypatch.setattr(devservices, "_sidecar", sidecar)

    body = client.get("/api/dev/services").json()

    assert calls == [("GET", "/services")]
    assert body["available"] is True
    by_name = {s["name"]: s for s in body["services"]}
    assert by_name["ml"] == {"name": "ml", "label": "Jupyter (the notebooks)", "state": "running"}
    assert by_name["airflow"]["state"] == "absent"


def test_an_unknown_service_is_refused_before_the_sidecar_is_asked(monkeypatch):
    def sidecar(method, path):
        raise AssertionError("the sidecar must not be asked")

    monkeypatch.setattr(devservices, "_sidecar", sidecar)

    assert client.post("/api/dev/services/webapp/start").status_code == 404


def test_the_sidecars_refusal_is_passed_on(monkeypatch):
    monkeypatch.setattr(
        devservices, "_sidecar",
        lambda method, path: FakeResponse(409, {"detail": "airflow has no container yet"}),
    )

    resp = client.post("/api/dev/services/airflow/start")

    assert resp.status_code == 409
    assert resp.json()["detail"] == "airflow has no container yet"


def test_a_start_reports_what_happened(monkeypatch):
    monkeypatch.setattr(
        devservices, "_sidecar",
        lambda method, path: FakeResponse(200, {"name": "ml", "state": "running", "started": True}),
    )

    assert client.post("/api/dev/services/ml/start").json() == {"service": "ml", "state": "running", "started": True}
