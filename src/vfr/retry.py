"""The one retry loop behind every external request this package makes:
aviationweather.gov, Overpass, the USGS elevation service, the FAA's
data downloads -- and the one way this package reads a service's own
reason out of an error response (upstream_detail)."""
import time

import requests


def with_retries(
    action,
    *,
    describe: str,
    retries: int = 3,
    backoff_s: float = 2.0,
    transient: tuple = (requests.RequestException,),
    error: type = RuntimeError,
):
    """Runs `action()` up to `retries` times, sleeping `backoff_s`, then
    twice that, and so on between attempts, and raises `error` -- naming
    `describe` and the last failure -- once they are spent.

    A certificate problem is raised at once instead: it fails identically
    on every attempt (aviationweather.gov's own certificate expired on
    2026-09-19), so the back-off would only delay the same answer.
    """
    last_err = None
    for attempt in range(retries):
        try:
            return action()
        except requests.exceptions.SSLError as err:
            raise error(f"{describe} failed: {err}") from err
        except transient as err:
            last_err = err
            if attempt < retries - 1:
                time.sleep(backoff_s * (attempt + 1))
    raise error(f"{describe} failed after {retries} attempts: {last_err}") from last_err


def upstream_detail(response, service: str) -> str:
    """Why `service` answered with an error, in its own words: the
    `detail` of a JSON body (FastAPI's shape, which model-service and
    planning-service both send), else the body's text, else just which
    service answered with which status. vfr.model_client and
    vfr.planner_client both report upstream failures through this."""
    try:
        detail = response.json().get("detail")
    except (ValueError, AttributeError):
        detail = None
    if detail:
        return str(detail)
    text = (getattr(response, "text", "") or "").strip()
    return text or f"{service} answered {response.status_code}"
