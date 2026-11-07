"""An airplane's state now, for the alerts a pilot sets on it."""
from __future__ import annotations

from .. import airports
from .common import STALE_S, TrafficUnavailable, _number, _wall
from .adsb_lol import UNREAD, _last_heard, _recent_trace, _trace
from .recorded import _recorded
from .watched import _watch
from .flights import DEPARTED_WITHIN_NM, LEG_GAP_S, _field_at, _left_from, _points

#: An airplane last heard in the air, low near a field or coming down to
#: it, is taken to have landed there once it has gone unheard this long,
#: s: a small airplane in the pattern often drops out of the receivers'
#: hearing for half a minute on its downwind and comes back. Where its
#: last report is on the ground, it has landed at once.
LANDED_UNHEARD_S = 120


def _recorded_status(hex_id: str, recorded: list[dict]) -> dict:
    """`status` from a watched airplane's recorded track: in the air while
    heard within STALE_S, the field its track starts at as where it left;
    landed where unheard for LANDED_UNHEARD_S last low over a field."""
    last = recorded[-1]
    heard = round(max(0.0, _wall() - last["t"]), 1)
    state = {"hex": hex_id, "heard_s": heard, "airborne": False, "aircraft": None, "departed": None, "arrived": None}
    if heard <= STALE_S:
        left = _left_from(recorded[0])
        departed = left and {k: v for k, v in left.items() if k != "at"} | {"city": None, "region": None}
        state.update(airborne=True, aircraft={**last["plane"], "seen_s": heard}, departed=departed)
    elif heard >= LANDED_UNHEARD_S:
        field = _field_at(last, landing=True)
        if field is not None:
            state["arrived"] = {**field, "at": last["t"]}
    return state


def status(hex_id: str) -> dict:
    """An airplane's state now, for the alerts a pilot sets on it (the
    card's Alert): {"hex", "heard_s" (s since its last report, None with
    none), "airborne" (that report in the air and within STALE_S, as the
    map would draw it), "aircraft" (it, as the map draws it, while
    airborne), "departed" (the field this flight took off from, where its
    recent trace shows it on the ground at one or going up from one), and
    "arrived" (where it has landed, while it is not airborne: on the
    ground at a field, or last heard low near one or coming down to it,
    `_field_at`, and unheard for LANDED_UNHEARD_S since; with "at", when
    it was last heard)}. From its recent trace, seconds old; where it has
    none, from its trace of today. TrafficUnavailable where the recent
    trace cannot be read now."""
    hex_id = hex_id.lower()
    trace = _recent_trace(hex_id)
    if trace is UNREAD or (trace is None and _recorded(hex_id)):
        # No recent trace to read: the track recorded while its card was
        # open or it was followed, asked for now where nothing is (`_watch`:
        # adsb.lol's API, adsb.fi, ADS-B Exchange), else unavailable -- the
        # owner's N3429J said "adsb.lol did not answer" with adsb.fi hearing it.
        if not _recorded(hex_id):
            _watch(hex_id)
        recorded = _recorded(hex_id)
        if not recorded:
            raise TrafficUnavailable("adsb.lol's recent trace could not be read")
        return _recorded_status(hex_id, recorded)
    if trace is None:
        trace = _trace(hex_id)
    raw = [p for p in (trace or {}).get("trace") or []
           if isinstance(p, list) and len(p) > 6 and _number(p[1]) is not None and _number(p[2]) is not None]
    points = _points(trace) if raw else []
    state = {"hex": hex_id, "heard_s": None, "airborne": False, "aircraft": None, "departed": None, "arrived": None}
    if not points:
        return state
    last = points[-1]
    ground = [p[3] == "ground" for p in raw]
    state["heard_s"] = round(max(0.0, _wall() - last["t"]), 1)
    aircraft = _last_heard(trace) if not ground[-1] else None
    if aircraft is not None:
        # The run in the air it is on: back to the stretch on the ground
        # it took off from, readsb's own new leg, or a silence of LEG_GAP_S.
        start = len(points) - 1
        while (start > 0 and not ground[start - 1] and not points[start]["new_leg"]
               and points[start]["t"] - points[start - 1]["t"] <= LEG_GAP_S):
            start -= 1
        if start > 0 and ground[start - 1]:
            on = points[start - 1]
            near = airports.nearest(on["lat"], on["lon"], limit=1)
            if near and near[0]["distance_nm"] <= DEPARTED_WITHIN_NM:
                state["departed"] = {"ident": near[0]["ident"], "name": near[0].get("name"),
                                     "city": near[0].get("municipality"), "region": near[0].get("region")}
        else:
            state["departed"] = _field_at(points[start], landing=False)
        state.update(airborne=True, aircraft=aircraft)
    elif ground[-1] or state["heard_s"] >= LANDED_UNHEARD_S:
        field = _field_at(last, landing=True)
        if field is not None:
            state["arrived"] = {**field, "at": last["t"]}
    return state
