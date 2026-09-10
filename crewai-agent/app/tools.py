"""CrewAI tools wrapping the exact same underlying logic nav-log-agent's
LangGraph nodes use (vfr.altitude, vfr.navlog, model_client) -- the point of
this build is comparing frameworks on the same task, not a different task.
Each tool is self-contained (re-fetches checkpoints internally as needed)
rather than relying on the agent passing complex structured data between
calls, since that tends to be less reliable than a few atomic tool calls.
"""
import json

from crewai.tools import tool

from vfr import aircraft as aircraft_module, checkpoints as checkpoint_selection
from vfr import airports, altitude, navlog

from . import model_client


@tool("get_route_checkpoints")
def get_route_checkpoints(departure_ident: str, destination_ident: str) -> str:
    """Get the trained model's recommended visual checkpoints along a VFR
    route, as JSON. departure_ident/destination_ident are ICAO/FAA idents
    (e.g. "C81", "KDLH")."""
    scored = model_client.get_checkpoints(departure_ident, destination_ident)
    # Narrowed to the handful actually worth flying rather than every
    # scored candidate in the corridor (206 of them on C81->KDLH). Two
    # reasons here specifically: a nav log is a short list, and this is a
    # tool result going into an LLM prompt, where handing over 206 rows
    # spends context to make the model do the selection worse than
    # vfr.checkpoints does it deterministically.
    return json.dumps(checkpoint_selection.select_checkpoints(scored))


@tool("get_recommended_altitude")
def get_recommended_altitude(departure_ident: str, destination_ident: str, aircraft_name: str = "c172") -> str:
    """Get the recommended VFR cruising altitude for a route, as JSON --
    constrained by terrain/obstacle clearance, controlled airspace, current
    weather, and the aircraft's service ceiling. aircraft_name resolves
    against data/aircraft/<name>.json."""
    dep = airports.get_airport(departure_ident)
    dest = airports.get_airport(destination_ident)
    profile = aircraft_module.load_aircraft_profile(aircraft_name)
    result = altitude.select_cruise_altitude((dep["lat"], dep["lon"]), (dest["lat"], dest["lon"]), profile)
    return json.dumps(result)


@tool("compute_dead_reckoning_legs")
def compute_dead_reckoning_legs(
    departure_ident: str, destination_ident: str, altitude_ft: float, aircraft_name: str = "c172"
) -> str:
    """Compute dead-reckoning nav-log legs (true/magnetic heading, wind
    correction angle, groundspeed, ETE, fuel burn) between each consecutive
    checkpoint on the route at altitude_ft, as JSON."""
    scored = model_client.get_checkpoints(departure_ident, destination_ident)
    profile = aircraft_module.load_aircraft_profile(aircraft_name)
    # Same selection as get_route_checkpoints, so the legs correspond to
    # the checkpoints that tool reports rather than to a different list.
    checkpoints = sorted(
        checkpoint_selection.select_checkpoints(scored), key=lambda c: c["along_track_nm"]
    )
    legs = []
    for a, b in zip(checkpoints, checkpoints[1:]):
        leg = navlog.assemble_leg((a["lat"], a["lon"]), (b["lat"], b["lon"]), altitude_ft, profile)
        leg["from"] = a["name"] or a["category"]
        leg["to"] = b["name"] or b["category"]
        legs.append(leg)
    return json.dumps(legs)
