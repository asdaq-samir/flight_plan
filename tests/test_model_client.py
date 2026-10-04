"""vfr.model_client: the one client planning-service uses to reach
model-service, for the chart model's scores."""
import requests

from vfr import model_client


class _Response:
    def __init__(self, status_code: int, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


def _posting(monkeypatch, response, calls=None):
    def fake_post(url, json, timeout):
        if calls is not None:
            calls.append((url, json))
        if isinstance(response, Exception):
            raise response
        return response

    # On the module's Session instance, not the requests module: the
    # client posts through its one Session (see model_client.py), and
    # Session.post is a bound method of that instance.
    monkeypatch.setattr(model_client._session, "post", fake_post)


def test_the_rows_are_posted_and_their_scores_come_back_in_order(monkeypatch):
    calls = []
    _posting(monkeypatch, _Response(200, {"scores": [3.5, 1.25]}), calls)

    assert model_client.score_detections([{"area_m2": 1.0}, {"area_m2": 2.0}]) == [3.5, 1.25]
    assert calls == [(f"{model_client.MODEL_SERVICE_URL}/score-detections", {"rows": [{"area_m2": 1.0}, {"area_m2": 2.0}]})]


def test_no_chart_model_promoted_is_no_scores(monkeypatch):
    _posting(monkeypatch, _Response(503, {"detail": "No chart model promoted yet"}))

    assert model_client.score_detections([{"area_m2": 1.0}]) is None


def test_an_unreachable_service_is_no_scores_not_an_error(monkeypatch):
    _posting(monkeypatch, requests.ConnectionError("refused"))

    assert model_client.score_detections([{"area_m2": 1.0}]) is None
