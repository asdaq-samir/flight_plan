"""An ATC clearance heard by the phone, its places found: the web's
lib/clearance and the app's Clearance read the words the recognizer
wrote into the clearance's items (AIM 4-4-3), and ask here for the
idents of the places it named (vfr.spoken), near the route. Before
listening, the names the recognizer is told to expect."""
import math
import re

from fastapi import APIRouter, Query, Response
from vfr import airports, fixes, procedures, spoken

from ..schemas import ClearanceAsk, ClearancePlaces, ClearanceWords
from .devml import _near

router = APIRouter()

#: How far round the route's points a place said is looked for, degrees:
#: about 60 nm of latitude, a clearance's points being near its route.
PAD_DEG = 1.0

#: As many names as Apple suggests a recognizer's contextualStrings hold.
MOST_WORDS = 100


def _places(near: tuple) -> list[dict]:
    """The navaids, fixes and airports round the route's points, each
    with `what` it is, for vfr.spoken."""
    if not near:
        return []
    lats, lons = [p[0] for p in near], [p[1] for p in near]
    south, north, west, east = min(lats) - PAD_DEG, max(lats) + PAD_DEG, min(lons) - PAD_DEG * 1.4, max(lons) + PAD_DEG * 1.4
    found = [{**f, "what": "navaid" if f.get("navaid") else "fix"} for f in fixes.within(south, west, north, east)]
    found += [{**a, "what": "airport"} for a in airports.places_in(south, west, north, east, limit=500)]
    # The nearest to the route's points first: of two fixes that sound the
    # same, PYKLA by Duluth and PICLE in Iowa, the one by the route
    # (vfr.spoken keeps this order between equals).
    # Flat-earth distances do for an order, at a thousandth of the cost.
    squeeze = math.cos(math.radians(sum(lats) / len(lats)))
    return sorted(found, key=lambda p: min((p["lat"] - lat) ** 2 + ((p["lon"] - lon) * squeeze) ** 2 for lat, lon in near))


def _exact(said: str, near: tuple) -> list[dict]:
    """The places anywhere whose ident one of the words, or all of them
    run together, is -- a point spelled in the phonetic alphabet far from
    the route's ends."""
    words = re.findall(r"[a-z0-9]+", said.lower())
    out = []
    for ident in {"".join(words).upper(), *(w.upper() for w in words)}:
        if len(ident) < 2:
            continue
        navaid = fixes.find_navaid(ident, near)
        if navaid:
            out.append({**navaid, "what": "navaid"})
        fix = fixes.find_fix(ident)
        if fix:
            out.append({**fix, "what": "fix"})
        place = airports.find_place(ident)
        if place:
            out.append({**place, "what": "airport"})
    return out


def _airport(said: str, near: tuple) -> dict | None:
    """The field an airport's name said is, the nearest of its name."""
    words, _ = spoken.words_of(said)
    if not words:
        return None
    hits = airports.search_airports(" ".join(words), limit=1, near=list(near) or None)
    return airports.find_place(hits[0]["ident"]) if hits else None


def _navaid_names(places: list[dict]) -> dict[str, str]:
    return {p["ident"]: p["name"] for p in places if p["what"] == "navaid" and p.get("name")}


def _procedure(field: str | None, ask, kind: str, places: list[dict]) -> dict | None:
    if not field or ask is None:
        return None
    listed = procedures.procedures_at(field)
    if not listed:
        return None
    found = spoken.procedure(ask.name, ask.number, kind, listed["procedures"], _navaid_names(places))
    if found is None:
        return None
    via = spoken.transition(ask.transition, found["transitions"], places) if ask.transition else None
    return {"id": found["id"], "transition": via, "sure": found["sure"]}


@router.post("/api/clearance/places")
def clearance_places(ask: ClearanceAsk) -> ClearancePlaces:
    """The places a clearance said, found near the route: its limit (an
    airport by its name, AIM 4-4-3 a), each phrase of its route as the
    points in it, and its SID and STAR among its fields' own. A place
    found by its sound alone is not `sure`; one not found has no ident."""
    near = _near(ask.near)
    places = _places(near)
    limit = None
    if ask.limit:
        limit = spoken.point(ask.limit, places + _exact(ask.limit, near), _airport(ask.limit, near))
        limit = limit or {"said": ask.limit}
    route = [spoken.points(phrase, places + _exact(phrase, near)) for phrase in ask.route]
    return {
        "limit": limit, "route": route,
        "departure": _procedure(ask.dep, ask.departure, "departure", places),
        "arrival": _procedure(ask.dest, ask.arrival, "arrival", places),
    }


@router.get("/api/clearance/words")
def clearance_words(response: Response, near: str = Query(default=""), dep: str = Query(default="")) -> ClearanceWords:
    """The names a clearance near the route will likely say, for the
    phone's recognizer to listen for: the departure's SIDs as said, the
    navaids' names, then the fixes' five letters as words, at most 100."""
    response.headers["Cache-Control"] = "private, max-age=3600"
    places = _places(_near(near))
    names = _navaid_names(places)
    words: list[str] = []
    listed = procedures.procedures_at(dep) if dep else None
    for p in (listed or {}).get("procedures", []):
        m = re.fullmatch(r"([A-Z]+)\d", p["id"]) if p["kind"] == "departure" else None
        if m:
            words.append(f"{names.get(m.group(1), m.group(1).title())} departure")
    words += sorted({n for n in names.values()})
    words += sorted({p["ident"].title() for p in places if p["what"] == "fix" and len(p["ident"]) == 5})
    seen: set[str] = set()
    return {"words": [w for w in words if not (w in seen or seen.add(w))][:MOST_WORDS]}
