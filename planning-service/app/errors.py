"""The planner's recent failures, for the Dev console's System tab: every
answer of 500 or more and every exception no handler caught, the newest
first, held in memory -- the last RECENT of them since the process
started. What a pilot hit, without reading the container's log."""
import threading
import time
from collections import deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

#: How many are held.
RECENT = 50

_HELD: deque = deque(maxlen=RECENT)
_LOCK = threading.Lock()


def record(method: str, path: str, status: int, detail: str) -> None:
    with _LOCK:
        _HELD.appendleft({"at": time.time(), "method": method, "path": path, "status": status, "detail": detail[:300]})


def record_for(request: Request, status: int, detail: str) -> None:
    """A failure an exception handler answered, with its words: the
    middleware then leaves the request alone."""
    request.state.failure_recorded = True
    record(request.method, _where(request), status, detail)


def _where(request: Request) -> str:
    return request.url.path + (f"?{request.url.query}" if request.url.query else "")


def recent() -> list[dict]:
    """The held failures, the newest first."""
    with _LOCK:
        return list(_HELD)


class RecordFailures(BaseHTTPMiddleware):
    """Records each answer of 500 or more -- a weather outage's 502, a
    computation's 504 -- and each exception that reached no handler (then
    let through, for FastAPI's own 500)."""

    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
        except Exception as err:
            record(request.method, _where(request), 500, f"{type(err).__name__}: {err}")
            raise
        if response.status_code >= 500 and not getattr(request.state, "failure_recorded", False):
            record(request.method, _where(request), response.status_code, _status_text(response.status_code))
        return response


def _status_text(status: int) -> str:
    return {502: "Bad gateway: a source it asks did not answer", 503: "Unavailable", 504: "Still computing past its limit"}.get(
        status, "Server error")
