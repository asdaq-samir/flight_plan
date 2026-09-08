"""Request/response shapes for the model-serving API.

Structured toward the eventual real response (a trained model's scored
candidate checkpoints, same fields notebooks 01-03 already produce), even
though /invocations currently returns a hand-written stub -- see main.py.
"""
from pydantic import BaseModel


class RouteRequest(BaseModel):
    departure_ident: str
    destination_ident: str


class Checkpoint(BaseModel):
    osm_id: str
    category: str
    name: str
    lat: float
    lon: float
    along_track_nm: float
    predicted_score: float


class RouteResponse(BaseModel):
    departure_ident: str
    destination_ident: str
    checkpoints: list[Checkpoint]
    stub: bool
