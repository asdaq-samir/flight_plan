"""Request/response shapes for the model-serving API."""
from pydantic import BaseModel


class DetectionRows(BaseModel):
    """The chart reader's detections as feature rows, one per detection:
    vfr.chartfeatures' columns by name, worked out by the planner, which
    has the corridor's other detections to count as neighbours."""

    rows: list[dict[str, float]]


class DetectionScores(BaseModel):
    """The chart model's score for each row, in order, and which model
    gave them and how it fared on the ratings it held out -- beside the
    palette's constants on the same ones."""

    scores: list[float]
    model_type: str | None
    trained_at: str | None
    held_out_mae: float | None
    palette_held_out_mae: float | None
