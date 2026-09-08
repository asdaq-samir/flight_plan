"""Model-serving microservice, called by the Spring Boot app over REST.

Structured toward /ping + /invocations -- the health-check and inference
route names a SageMaker inference container expects -- so the eventual
AWS migration (deferred, see project memory) doesn't need a rename, even
though nothing here actually talks to SageMaker yet.

/invocations currently returns a hand-written stub, not real inference:
there's no trained model yet (hand-labeling is still in progress). The
stub checkpoints are real early-route candidates from the C81->KDLH data
collected this session (data/processed/candidates_c81_kdlh.csv), with
made-up predicted_score values standing in for a model's output -- the
point is exercising the request/response contract, not the prediction.
"""
from fastapi import FastAPI

from .schemas import Checkpoint, RouteRequest, RouteResponse

app = FastAPI(title="vfr-route model-service")

_STUB_CHECKPOINTS = [
    Checkpoint(
        osm_id="411077224",
        category="lake_or_pond",
        name="(unnamed)",
        lat=42.3172,
        lon=-88.0905,
        along_track_nm=0.0,
        predicted_score=0.41,
    ),
    Checkpoint(
        osm_id="235262686",
        category="intersection",
        name="IL 120 & IL 134",
        lat=42.3451,
        lon=-88.0700,
        along_track_nm=1.0,
        predicted_score=0.58,
    ),
    Checkpoint(
        osm_id="153546173",
        category="town",
        name="Round Lake",
        lat=42.3534,
        lon=-88.0934,
        along_track_nm=1.9,
        predicted_score=0.72,
    ),
    Checkpoint(
        osm_id="419631379",
        category="railroad",
        name="Fox Lake Subdivision",
        lat=42.3602,
        lon=-88.1038,
        along_track_nm=2.5,
        predicted_score=0.63,
    ),
    Checkpoint(
        osm_id="1500067797",
        category="river",
        name="White River",
        lat=42.6507,
        lon=-88.3472,
        along_track_nm=23.0,
        predicted_score=0.79,
    ),
]


@app.get("/ping")
def ping() -> dict:
    return {"status": "ok"}


@app.post("/invocations", response_model=RouteResponse)
def invocations(request: RouteRequest) -> RouteResponse:
    return RouteResponse(
        departure_ident=request.departure_ident,
        destination_ident=request.destination_ident,
        checkpoints=_STUB_CHECKPOINTS,
        stub=True,
    )
