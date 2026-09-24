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


def _plan(departure_ident: str, destination_ident: str, aircraft_name: str | None, depart: str | None = None) -> dict:
    """The planner's own plan, flying the altitudes it chose -- the nav log
    LangGraph's build fetches, and the planner keeps it, so the two tools
    below asking for it costs one plan."""
    return planner_client.plan(departure_ident, destination_ident, None, aircraft_name, depart=depart)


@tool("get_recommended_altitude")
def get_recommended_altitude(departure_ident: str, destination_ident: str, aircraft_name: str | None = None) -> str:
    """Get the cruising altitudes the planner flies this route at, as JSON:
    the altitude of the first leg, each leg's own reasoning (terrain and
    obstacle clearance, controlled airspace, current weather, the
    aircraft's service ceiling), the three plans it considered and the
    one chosen. aircraft_name is one of the planner's aircraft profiles
    (e.g. "c172", "pa28"); omit it for the planner's default.

    The plan's own, not the route-wide breakdown it used to read, which
    has no altitude at all where the highest floor is above the lowest
    shelf -- a route the plan still flies, stepping under the shelf."""
    plan = _plan(departure_ident, destination_ident, aircraft_name)
    return json.dumps({
        "altitude_ft": plan["altitude_ft"],
        "altitude_choice": plan["altitude_choice"],
        "altitude_options": plan["altitude_options"],
        "altitude_selection": plan["altitude_selection"],
    })


@tool("compute_dead_reckoning_legs")
def compute_dead_reckoning_legs(
    departure_ident: str, destination_ident: str, aircraft_name: str | None = None, depart: str | None = None,
) -> str:
    """Compute the dead-reckoning nav-log legs the planner flies, from the
    departure airport through each checkpoint to the destination (each
    leg's altitude, true and magnetic heading, wind correction angle,
    groundspeed, ETE, fuel burn, the climb from the field), and the
    route's totals with the fuel check, as JSON. `depart` (ISO 8601) is
    the departure time the winds and the fuel reserve are for; omitted,
    now.

    At the planner's own altitudes, as LangGraph's build flies them. It
    took an altitude and flew the whole route flat at it, so the two
    frameworks briefed different nav logs -- the comparison's whole
    point is that they brief the same one."""
    plan = _plan(departure_ident, destination_ident, aircraft_name, depart)
    return json.dumps({"legs": plan["legs"], "totals": plan["totals"]})
