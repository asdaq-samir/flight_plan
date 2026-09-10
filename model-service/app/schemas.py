"""Request/response shapes for the model-serving API.

These were written against the eventual real response (a trained model's
scored candidate checkpoints, same fields notebooks 01-03 produce) while
/invocations was still a stub, and did not have to change when real
inference landed 2026-09-10 -- which was the point of shaping them that
way.

`stub` stays in the response rather than being deleted: the Spring Boot
side deserializes it (dto/ModelServiceResponse.java), and a caller being
able to tell real inference from placeholder output is worth a boolean.
It is now always False.
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
