"""vfr.model_client: the one client planning-service and both agents use
to reach model-service. Only the HTTP path is exercised here -- the
SageMaker path needs AWS -- plus the switch that picks between them."""
import pytest
import requests

from vfr import model_client


class _Response:
    def __init__(self, status_code: int, body=None, text: str = ""):
        self.status_code = status_code
        self._body = body
        self.text = text

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


@pytest.fixture(autouse=True)
def _http_path(monkeypatch):
    monkeypatch.setattr(model_client, "SAGEMAKER_ENDPOINT_NAME", None)


def _posting(monkeypatch, response, calls=None):
    def fake_post(url, json, timeout):
        if calls is not None:
            calls.append((url, json))
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(model_client.requests, "post", fake_post)


def test_get_checkpoints_posts_the_route_and_unwraps_the_list(monkeypatch):
    calls = []
    _posting(monkeypatch, _Response(200, {"checkpoints": [{"name": "Long Lake"}]}), calls)

    assert model_client.get_checkpoints("C81", "KDLH") == [{"name": "Long Lake"}]
    assert calls == [(
        f"{model_client.MODEL_SERVICE_URL}/invocations",
        {"departure_ident": "C81", "destination_ident": "KDLH"},
    )]


def test_a_model_selector_is_sent_only_when_asked_for(monkeypatch):
    calls = []
    _posting(monkeypatch, _Response(200, {"checkpoints": []}), calls)

    model_client.invoke("C81", "KDLH", model="pytorch")

    assert calls[0][1]["model"] == "pytorch"


def test_a_404_means_the_corridor_has_not_been_collected(monkeypatch):
    _posting(monkeypatch, _Response(404, {"detail": "no feature store"}))

    with pytest.raises(model_client.RouteNotCollected) as err:
        model_client.get_checkpoints("C81", "KDLH")

    assert err.value.status == 404
    assert "C81->KDLH" in str(err.value)


def test_an_unreachable_service_is_a_502(monkeypatch):
    _posting(monkeypatch, requests.ConnectionError("refused"))

    with pytest.raises(model_client.ModelServiceError) as err:
        model_client.get_checkpoints("C81", "KDLH")

    assert err.value.status == 502


def test_any_other_status_is_relayed_with_its_detail(monkeypatch):
    _posting(monkeypatch, _Response(503, {"detail": "no model promoted"}))

    with pytest.raises(model_client.ModelServiceError) as err:
        model_client.get_checkpoints("C81", "KDLH")

    assert err.value.status == 503
    assert str(err.value) == "no model promoted"


def test_the_endpoint_name_alone_selects_the_sagemaker_path(monkeypatch):
    monkeypatch.setattr(model_client, "SAGEMAKER_ENDPOINT_NAME", "vfr-route-endpoint")
    seen = []
    monkeypatch.setattr(model_client, "_invoke_sagemaker", lambda payload: seen.append(payload) or {"checkpoints": []})
    _posting(monkeypatch, AssertionError("HTTP must not be used"))

    model_client.get_checkpoints("C81", "KDLH")

    assert seen == [{"departure_ident": "C81", "destination_ident": "KDLH"}]
