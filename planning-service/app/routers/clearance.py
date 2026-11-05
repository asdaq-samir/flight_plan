"""An ATC clearance heard by the phone, its places found: the web's
lib/clearance and the app's Clearance read the words the recognizer
wrote into the clearance's items (AIM 4-4-3), and ask here for the
idents of the places it named (wingtip.spoken), near the route. Before
listening, the names the recognizer is told to expect."""
import functools
import math
import re

from fastapi import APIRouter, Query, Response
from wingtip import airports, fixes, procedures, spoken

from ..schemas import ClearanceAsk, ClearancePlaces, ClearanceWords
from .devml import _near

router = APIRouter()

#: How far round the route's points a place said is looked for, degrees:
#: about 60 nm of latitude, a clearance's points being near its route.
PAD_DEG = 1.0

#: As many names as Apple suggests a recognizer's contextualStrings hold.
MOST_WORDS = 100


def _corridor(near: tuple) -> list[tuple[float, float, float, float]]:
    """Boxes along the lines between the route's points, a degree apart
    and PAD_DEG round each: a navaid halfway along a long route -- Hill
    City on one from San Jose to Nashville -- is outside the boxes round
    its ends, and a box round both ends is most of the country."""
    boxes = []
    for (lat1, lon1), (lat2, lon2) in zip(near, near[1:] or near):
        steps = max(1, int(max(abs(lat2 - lat1), abs(lon2 - lon1))))
        for k in range(steps + 1):
            lat, lon = lat1 + (lat2 - lat1) * k / steps, lon1 + (lon2 - lon1) * k / steps
            boxes.append((lat - PAD_DEG, lon - PAD_DEG * 1.4, lat + PAD_DEG, lon + PAD_DEG * 1.4))
    return boxes


def _places(near: tuple) -> list[dict]:
    """The navaids, fixes and airports along the route, each with `what`
    it is, for wingtip.spoken."""
    if not near:
        return []
    lats = [p[0] for p in near]
    seen, found = set(), []
    for south, west, north, east in _corridor(near):
        for f in fixes.within(south, west, north, east):
            place = {**f, "what": "navaid" if f.get("navaid") else "fix"}
            if (place["ident"], place["what"], place["lat"]) not in seen:
                seen.add((place["ident"], place["what"], place["lat"]))
                found.append(place)
        for a in airports.places_in(south, west, north, east, limit=200):
            if (a["ident"], "airport", a["lat"]) not in seen:
                seen.add((a["ident"], "airport", a["lat"]))
                found.append({**a, "what": "airport"})
    # The nearest to the route's points first: of two fixes that sound the
    # same, PYKLA by Duluth and PICLE in Iowa, the one by the route
    # (wingtip.spoken keeps this order between equals).
    # Flat-earth distances do for an order, at a thousandth of the cost.
    squeeze = math.cos(math.radians(sum(lats) / len(lats)))
    return sorted(found, key=lambda p: min((p["lat"] - lat) ** 2 + ((p["lon"] - lon) * squeeze) ** 2 for lat, lon in near))


@functools.cache
def _navaids_by_name() -> dict[str, list[dict]]:
    """Every navaid in service by its name as words ("WILL ROGERS"), held
    while the planner runs: a few thousand."""
    by_name: dict[str, list[dict]] = {}
    for navaid in fixes.navaids():
        if navaid.get("name"):
            by_name.setdefault(spoken.name_words(navaid["name"]), []).append({**navaid, "what": "navaid"})
    return by_name


def _exact(said: str, near: tuple) -> list[dict]:
    """The places anywhere whose ident one of the words, or all of them
    run together, is -- a point spelled in the phonetic alphabet far from
    the route's ends -- and the navaids anywhere named by a run of them:
    a route that doglegs far off the line between the points known, as
    one from Charlotte to Phoenix by Will Rogers (IRW) does."""
    words = re.findall(r"[a-z0-9]+", said.lower())
    out = []
    by_name = _navaids_by_name()
    for n in (1, 2, 3):
        for i in range(len(words) - n + 1):
            out += by_name.get(" ".join(words[i:i + n]).upper(), [])
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
    """The field an airport's name said is, the nearest of its name. A
    name said short or long of the one on file -- "Seattle Tacoma" for
    Seattle–Tacoma International, "city of Colorado Springs" -- is tried
    by fewer of its words, the longest run first."""
    words, _ = spoken.words_of(said)
    runs = [words[i:i + n] for n in range(len(words), 0, -1) for i in range(len(words) - n + 1)]
    for run in runs:
        if len(run) == 1 and len(run[0]) < 4:
            continue
        hits = airports.search_airports(" ".join(run), limit=1, near=list(near) or None)
        if hits:
            return airports.find_place(hits[0]["ident"])
    return None


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
