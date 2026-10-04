"""The one way to ask model-service for scores: the chart model's for the
chart reader's detections, which the planner's checkpoints and the
training page's points are ranked by. An HTTP POST to the model-service
container. The agents get their nav log, scores included, from
planning-service itself (vfr.planner_client).
"""
import os

import requests

MODEL_SERVICE_URL = os.environ.get("MODEL_SERVICE_URL", "http://model-service:8000")

# One Session per process, not one per call: a bare requests.post() opens
# a fresh TCP connection (and, to model-service over plain HTTP inside the
# compose network, a fresh handshake) every time, for a process that
# calls the same host on every plan. A Session pools and reuses the
# connection instead.
_session = requests.Session()


def score_detections(rows: list[dict]) -> list | None:
    """The chart model's score for each of the chart reader's detections,
    from their feature rows (vfr.chartfeatures), in order; None where
    model-service has no chart model promoted, or does not answer. Never
    an error: the training page shows the palette's constants alone
    then, as it did before there was a model."""
    try:
        resp = _session.post(f"{MODEL_SERVICE_URL}/score-detections", json={"rows": rows}, timeout=10)
        return resp.json()["scores"] if resp.status_code == 200 else None
    except (requests.RequestException, ValueError, KeyError):
        return None
