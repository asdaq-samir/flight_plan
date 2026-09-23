"""The one way for a service other than the planner to get a route's
nav log: ask planning-service for it.

planning-service is where the nav log is built -- the departure and
destination as the first and last fixes, each leg's own legal altitude
from the three plans, the climb from the field, the winds period for
the departure time and the fuel check against the tanks. Both agents
used to assemble their own from vfr's pieces and got a different
answer: no legs to or from the airports, one altitude for the whole
route, no climbs. Now they fetch the one a pilot sees.

Deliberately `requests` and nothing else (vfr.retry, which it reads
error bodies with, needs no more), the way vfr.model_client is for
model-service: the agents import this module and none of vfr's
geometry, raster or data dependencies, so their images do not install
them either.
"""
import os

import requests

from .retry import upstream_detail

PLANNING_SERVICE_URL = os.environ.get("PLANNING_SERVICE_URL", "http://planning-service:8000")
# An uncached plan reads terrain, obstacles and airspace and then the
# winds at every legal altitude of every leg; on a slow
# aviationweather.gov day one was observed taking over two minutes.
TIMEOUT_S = 300

# One Session per process, for the same reason as vfr.model_client's:
# a pooled connection to the same host instead of a handshake per call.
_session = requests.Session()


class PlannerError(Exception):
    """planning-service did not answer with a plan. The message is its
    own `detail` where it sent one -- an unknown ident, a corridor nobody
    has collected, no legal altitude for the route, or an upstream it
    could not reach -- which says what happened and what to do next.
    `status` is the planner's HTTP status, or 502 when it could not be
    reached at all."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def plan(departure_ident: str, destination_ident: str, altitude_ft: float | None = None,
         aircraft_name: str | None = None) -> dict:
    """The whole plan (`/api/plan`): the selected checkpoints, the
    altitude selection and the three plans, the legs flown and their
    totals. With `altitude_ft` the legs are flown at it instead of the
    planner's own choice; without `aircraft_name` the planner's default
    aeroplane is used."""
    params: dict = {"dep": departure_ident, "dest": destination_ident}
    if altitude_ft is not None:
        params["altitude_ft"] = altitude_ft
    if aircraft_name:
        params["aircraft"] = aircraft_name
    return _get("/api/plan", params)


def checkpoints(departure_ident: str, destination_ident: str) -> dict:
    """Every scored candidate and the subset worth flying
    (`/api/checkpoints`)."""
    return _get("/api/checkpoints", {"dep": departure_ident, "dest": destination_ident})


def altitude_breakdown(departure_ident: str, destination_ident: str, aircraft_name: str | None = None) -> dict:
    """The route-wide cruise altitude selection and its reasoning
    (`/api/altitude-breakdown`)."""
    params: dict = {"dep": departure_ident, "dest": destination_ident}
    if aircraft_name:
        params["aircraft"] = aircraft_name
    return _get("/api/altitude-breakdown", params)


def _get(path: str, params: dict) -> dict:
    try:
        response = _session.get(f"{PLANNING_SERVICE_URL}{path}", params=params, timeout=TIMEOUT_S)
    except requests.RequestException as err:
        raise PlannerError(f"Could not reach planning-service: {err}") from err
    if response.status_code != 200:
        raise PlannerError(upstream_detail(response, "planning-service"), response.status_code)
    return response.json()
