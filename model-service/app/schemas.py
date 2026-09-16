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
    # None (the default -- existing callers, including Spring Boot's own
    # ModelServiceClient, never set this) means "whatever's currently
    # promoted," unchanged from before this field existed. Otherwise one
    # of "current"/"pytorch"/"tensorflow"/"spark" -- see main.py's _LOADERS.
    model: str | None = None


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
    # Which algorithm actually produced these scores -- from that
    # model's own metrics.json ("RandomForest"/"PyTorchMLP"/etc), not
    # just an echo of the request's own selector, so a caller always
    # knows the truth even when `model` was omitted (defaulting to
    # whatever's currently promoted, which changes over time).
    model_type: str
