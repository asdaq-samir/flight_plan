"""What a chart reader's process runs (app.chart_model's pool): one
corridor read and kept on disk, as app.detection reads one.

A module of its own, importing app.detection and no more, because a
spawned process imports the module its work is in before it starts:
app.chart_model's imports -- FastAPI by way of app.common, pandas, the
chart model's features -- were 4.8 s of a new reader's start, every
first new route after the pool had been let go (measured 2026-10-07),
where app.detection's are 3.8."""
from .detection import detect_job


def read_corridor(key: tuple, start: tuple, end: tuple, half_width_nm: float) -> str | None:
    """The corridor read and kept on disk; what went wrong, else None."""
    job = detect_job(key, start, end, half_width_nm)
    with job["cond"]:
        job["cond"].wait_for(lambda: job["done"])
    return job["error"]


def ready() -> bool:
    """Nothing: given to each new process as the planner starts, for it to
    import the above before the first route's read (app.chart_model)."""
    return True
