"""Client for model-service's /invocations endpoint -- the trained model's
scored checkpoints. Still a hand-written stub as of this writing (see
model-service/app/main.py -- not enough chart-based labels yet to train a
real model), so this agent is exercising the request/response contract, not
yet getting real predictions. Nothing here needs to change once a real
model is promoted -- same endpoint, same shape.
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
