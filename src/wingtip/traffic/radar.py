"""Airplanes heard by another source -- the FAA's terminal radar through SWIM (planning-service's
app.swim) -- and which of the radar is worth reading now."""
from __future__ import annotations

import math

from .common import STALE_S, _LOCK, _NM_PER_DEG, _clock, _wall
from .recorded import _FOLLOWED, _followed, _record, _recorded

#: Airplanes heard by another source -- the FAA's terminal radar through
#: SWIM (planning-service's app.swim) -- by address: the latest report of
#: each, with "at" (s, wall clock), for the map where adsb.lol does not
#: hear one, and recorded for those followed.
_ELSEWHERE: dict[str, dict] = {}

#: A followed airplane's report from elsewhere is recorded at most this
#: often, s: STARS sweeps every 4.8 s; a point a quarter minute is a
#: track's shape on a phone and a day's file of a few hundred kB.
ELSEWHERE_RECORD_S = 15.0


def heard_elsewhere(plane: dict, at: float) -> None:
    """A report from another source (the FAA's terminal radar, app.swim),
    as `_aircraft` gives an airplane and when it was where it is (s): kept
    as the airplane's latest for the map, and recorded where it is
    followed, a point every ELSEWHERE_RECORD_S."""
    hex_id = plane["hex"]
    with _LOCK:
        was = _ELSEWHERE.get(hex_id)
        if was is not None and was["at"] >= at:
            return
        _ELSEWHERE[hex_id] = {**plane, "at": at}
        if len(_ELSEWHERE) > 20000:
            stale = [h for h, p in _ELSEWHERE.items() if at - p["at"] > STALE_S]
            for h in stale:
                del _ELSEWHERE[h]
    if _followed(hex_id):
        last = _recorded(hex_id)[-1:] or [None]
        if last[0] is None or at - last[0]["t"] >= ELSEWHERE_RECORD_S:
            _record(hex_id, {**plane, "seen_s": max(0.0, _wall() - at)})


#: The places the map has asked for the airplanes near (near): each a
#: view's centre, its radius (nm) and when it last asked, on the monotonic
#: clock.
_LOOKED: dict[tuple[float, float], tuple[float, float, float, float]] = {}
#: How long after the map's last ask the FAA's radar is still read around
#: a place, s: the map asks every few seconds while traffic is shown, so
#: past a minute nobody is looking there.
LOOKED_S = 60.0


def radar_wanted() -> tuple[list[tuple[float, float, float]], set[str]]:
    """What of the FAA's radar is worth reading now: the places the map has
    asked for traffic around within LOOKED_S, each (lat, lon, radius nm),
    and the addresses of the airplanes followed, whose flights are recorded
    wherever they are, card open or not. Reading the whole country's tracks
    with nobody looking kept the planner at a core of its own on the
    owner's Mac (2026-10-20); reading it all while one map looked at one
    place took 40% of the planner's time from the planning a pilot waits
    on (py-spy, 2026-10-20)."""
    _followed("")  # the followed read from their files, the first time
    with _LOCK:
        now = _clock()
        for key in [key for key, view in _LOOKED.items() if now - view[3] > LOOKED_S]:
            del _LOOKED[key]
        return [view[:3] for view in _LOOKED.values()], set(_FOLLOWED)


def _heard_elsewhere_now(hex_id: str) -> dict | None:
    """Its report from elsewhere, where heard within STALE_S, its age now."""
    with _LOCK:
        plane = _ELSEWHERE.get(hex_id)
    if plane is None:
        return None
    age = _wall() - plane["at"]
    return {k: v for k, v in plane.items() if k != "at"} | {"seen_s": round(age, 1)} if age <= STALE_S else None


def _elsewhere_near(lat: float, lon: float, radius_nm: float, have: set[str]) -> list[dict]:
    """The airplanes heard elsewhere in the last STALE_S within `radius_nm`
    that the region's answer left out."""
    now = _wall()
    with _LOCK:
        planes = [p for h, p in _ELSEWHERE.items() if h not in have and now - p["at"] <= STALE_S]
    cos = math.cos(math.radians(lat))
    out = []
    for p in planes:
        if math.hypot((p["lat"] - lat) * _NM_PER_DEG, (p["lon"] - lon) * _NM_PER_DEG * cos) <= radius_nm:
            out.append({k: v for k, v in p.items() if k != "at"} | {"seen_s": round(now - p["at"], 1)})
    return out
