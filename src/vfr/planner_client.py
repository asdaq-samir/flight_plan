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

from .config import PLAN_LIMIT_S
from .retry import upstream_detail

PLANNING_SERVICE_URL = os.environ.get("PLANNING_SERVICE_URL", "http://planning-service:8000")
# The planner answers within its own bound -- with the plan, or with a 504
# saying what it is still waiting on -- so this waits that long and a
# little more for the answer to arrive. It was 300 s beside a 240 s bound
# linked only by a comment, and the plan's scoring and a typed altitude's
# legs ran outside the bound: a slow plan read as "could not reach
# planning-service".
TIMEOUT_S = PLAN_LIMIT_S + 30

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
         aircraft_name: str | None = None, *, depart: str | None = None, altitude_choice: str | None = None,
         cruise_tas_kt: float | None = None, fuel_burn_gph: float | None = None,
         usable_fuel_gal: float | None = None) -> dict:
    """The whole plan (`/api/plan`): the selected checkpoints, the
    altitude selection and the three plans, the legs flown and their
    totals -- the one a pilot sees, when given what the pilot planned
    with. With `altitude_ft` the legs are flown at it instead of the
    planner's own choice; without `aircraft_name` the planner's default
    aeroplane is used. `depart` (ISO time) picks the winds period, the
    day or night reserve and the forecast's hours -- without it, now;
    `altitude_choice` the plan flown (lowest, highest, fastest; the
    planner's own when omitted); the three numbers a pilot's own
    aeroplane's, over the profile's."""
    params: dict = {"dep": departure_ident, "dest": destination_ident}
    optional = {
        "altitude_ft": altitude_ft, "aircraft": aircraft_name or None, "depart": depart,
        "altitude_choice": altitude_choice, "cruise_tas_kt": cruise_tas_kt,
        "fuel_burn_gph": fuel_burn_gph, "usable_fuel_gal": usable_fuel_gal,
    }
    params.update({k: v for k, v in optional.items() if v is not None})
    return _get("/api/plan", params)


def checkpoints(departure_ident: str, destination_ident: str) -> dict:
    """Every scored candidate and the subset worth flying
    (`/api/checkpoints`)."""
    return _get("/api/checkpoints", {"dep": departure_ident, "dest": destination_ident})


def _get(path: str, params: dict) -> dict:
    try:
        response = _session.get(f"{PLANNING_SERVICE_URL}{path}", params=params, timeout=TIMEOUT_S)
    except requests.RequestException as err:
        raise PlannerError(f"Could not reach planning-service: {err}") from err
    if response.status_code != 200:
        raise PlannerError(upstream_detail(response, "planning-service"), response.status_code)
    return response.json()
