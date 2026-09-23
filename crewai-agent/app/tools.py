"""CrewAI tools over the planner's own answers -- the same nav log
nav-log-agent's LangGraph build fetches, and the one a pilot sees on the
page: the point of this build is comparing frameworks on the same task,
not a different task.

Each tool asks planning-service through vfr.planner_client. They used to
assemble the pieces from vfr themselves, and got a different nav log from
the planner's: no legs to or from the airports, no climbs. Each tool is
still self-contained rather than relying on the agent passing complex
structured data between calls, since that tends to be less reliable than
a few atomic tool calls.
"""
import json

from crewai.tools import tool

from vfr import planner_client


@tool("get_route_checkpoints")
def get_route_checkpoints(departure_ident: str, destination_ident: str) -> str:
    """Get the visual checkpoints worth flying along a VFR route, in route
    order, as JSON. departure_ident/destination_ident are ICAO/FAA idents
    (e.g. "C81", "KDLH")."""
    # The planner's selection rather than every scored candidate in the
    # corridor (206 of them on C81->KDLH): a nav log is a short list, and
    # this is a tool result going into an LLM prompt, where 206 rows spend
    # context to make the model do the selection worse than the planner
    # does it deterministically.
    return json.dumps(planner_client.checkpoints(departure_ident, destination_ident)["selected"])


@tool("get_recommended_altitude")
def get_recommended_altitude(departure_ident: str, destination_ident: str, aircraft_name: str | None = None) -> str:
    """Get the recommended VFR cruising altitude for a route, as JSON --
    constrained by terrain/obstacle clearance, controlled airspace, current
    weather, and the aircraft's service ceiling. aircraft_name is one of
    the planner's aircraft profiles (e.g. "c172", "pa28"); omit it for
    the planner's default."""
    return json.dumps(planner_client.altitude_breakdown(departure_ident, destination_ident, aircraft_name))


@tool("compute_dead_reckoning_legs")
def compute_dead_reckoning_legs(
    departure_ident: str, destination_ident: str, altitude_ft: float, aircraft_name: str | None = None,
) -> str:
    """Compute the dead-reckoning nav-log legs at altitude_ft, from the
    departure airport through each checkpoint to the destination (true
    and magnetic heading, wind correction angle, groundspeed, ETE, fuel
    burn, the climb from the field), and the route's totals with the fuel
    check, as JSON."""
    plan = planner_client.plan(departure_ident, destination_ident, altitude_ft, aircraft_name)
    return json.dumps({"legs": plan["legs"], "totals": plan["totals"]})
