"""Client for model-service's /invocations endpoint. Identical to
nav-log-agent's -- both builds call the same model-serving endpoint, per
docs/architecture-future.png (the CrewAI build is a framework comparison, not a
different data source).
"""
import os

import requests

MODEL_SERVICE_URL = os.environ.get("MODEL_SERVICE_URL", "http://model-service:8000")


def get_checkpoints(departure_ident: str, destination_ident: str) -> list[dict]:
    resp = requests.post(
        f"{MODEL_SERVICE_URL}/invocations",
        json={"departure_ident": departure_ident, "destination_ident": destination_ident},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["checkpoints"]
