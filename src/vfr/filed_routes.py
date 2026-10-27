"""The routes pilots file between two airports, from the FAA's flight plans
as TFMS hands them out (SWIM's TFMData service, its flight data messages:
each fltdMessage's flight by its GUFI, its departure and arrival airports
and its route of flight in the NAS's own dots, "KIAD.RNLDI4.OTTTO..COLNS.
GAVNN4.KCVG/2348"). Kept a year, each flight once with the route it last
had, so FPL's route line can offer the route most filed between two fields
(the owner, 2026-10-27: "Most filed is how you get most flown").

The flight plans are IFR's: TFMS has the NAS's flight plans, and a VFR
flight plan stays with Flight Service. Those are the routes ATC clears and
pilots fly, the "most flown" the owner asked for.
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from .config import DATA_DIR

STORE = Path(os.environ.get("FILED_STORE", str(DATA_DIR / "raw" / "faa_filed" / "filed.sqlite")))
#: How long a flight's route counts, s: a year, so a route a season favours
#: and the airways and fixes of every chart cycle in it are all counted.
KEEP_S = 365 * 24 * 3600
#: The fewest flights a route needs to be the most filed: one flight's
#: route is one pilot's, not the way pilots go.
AT_LEAST = 2

#: An airway a VFR plan can fly: Victor and T routes. Jet routes and Q
#: routes run from 18,000 ft MSL up (AIM 5-3-4, the jet route system and
#: RNAV routes), in Class A (14 CFR 71.33), where no VFR flight goes
#: (14 CFR 91.135), so a route on one is not offered.
_HIGH_AIRWAY = re.compile(r"^[JQ]\d{1,4}$")
#: A departure or an arrival procedure's name, "RNLDI4", "GAVNN4": letters
#: and its number. Picked in the route box as a procedure, not a point, so
#: left out of the stops; the transition fix after or before it stays.
_PROCEDURE = re.compile(r"^[A-Z]{3,6}\d{1,2}[A-Z]?$")
#: A point the route box takes: an airport, a fix, a navaid, an airway.
_POINT = re.compile(r"^(?=.*[A-Z])[A-Z0-9]{2,6}$")

_LOCK = threading.Lock()
_db: sqlite3.Connection | None = None
_pruned_at = 0.0


def _connection() -> sqlite3.Connection:
    global _db
    if _db is None:
        STORE.parent.mkdir(parents=True, exist_ok=True)
        _db = sqlite3.connect(STORE, check_same_thread=False)
        _db.executescript("""
            CREATE TABLE IF NOT EXISTS filings (
                gufi TEXT PRIMARY KEY, dep TEXT, dest TEXT, stops TEXT, aircraft TEXT, heard REAL);
            CREATE INDEX IF NOT EXISTS filings_pair ON filings (dep, dest);
        """)
    return _db


def reset() -> None:
    """The connection closed, for a test to point STORE at its own file."""
    global _db
    with _LOCK:
        if _db is not None:
            _db.close()
        _db = None


def same(ident: str) -> str:
    """An airport as both its idents name it: KUES and UES alike, as TFMS
    writes a small field's FAA ident and the route box its ICAO one."""
    s = ident.strip().upper()
    return s[1:] if len(s) == 4 and s.startswith("K") and s.isalpha() else s


def route_stops(route: str, dep: str, dest: str) -> list[str] | None:
    """A route of flight in the NAS's dots ("KIAD.RNLDI4.OTTTO..COLNS.
    GAVNN4.KCVG/2348": ".." direct, "." along, "/2348" the arrival time) as
    the route box's stops between its ends: its fixes, navaids and Victor
    and T airways, its procedures left out (_PROCEDURE). None for one a
    VFR plan can't fly as written: a jet or Q route, or a point the box
    can't take (a fix-radial-distance, a latitude and longitude)."""
    tokens = [t for t in route.strip().upper().split(".") if t and t != "/"]
    if tokens:
        tokens[-1] = tokens[-1].split("/")[0]
    if tokens and same(tokens[0]) == same(dep):
        tokens = tokens[1:]
    if tokens and same(tokens[-1]) == same(dest):
        tokens = tokens[:-1]
    stops = []
    for token in tokens:
        if _HIGH_AIRWAY.match(token) or not _POINT.match(token):
            return None
        if _PROCEDURE.match(token):
            continue
        if not stops or stops[-1] != token:
            stops.append(token)
    return stops


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def filings(xml: str) -> list[dict]:
    """A TFMData message's flights that carry a route of flight, each
    {"gufi", "dep", "dest", "route", "aircraft"}: a flight plan's, an
    amendment's (its new route) or any update's that repeats it."""
    if "outeOfFlight" not in xml:
        return []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    out = []
    for message in root.iter():
        if _local(message.tag) != "fltdMessage":
            continue
        found: dict = {}
        for el in message.iter():
            name = _local(el.tag)
            if name == "gufi":
                found["gufi"] = (el.text or "").strip()
            elif name in ("departurePoint", "arrivalPoint"):
                airport = next((a for a in el.iter() if _local(a.tag) == "airport"), None)
                if airport is not None:
                    found["dep" if name == "departurePoint" else "dest"] = (airport.text or "").strip().upper()
            elif name in ("routeOfFlight", "newRouteOfFlight") and el.get("legacyFormat"):
                found["route"] = el.get("legacyFormat")
            elif name in ("flightAircraftSpecs", "newFlightAircraftSpecs"):
                found["aircraft"] = (el.text or "").strip().upper()
        if found.get("gufi") and found.get("dep") and found.get("dest") and found.get("route"):
            out.append({"aircraft": None, **found})
    return out


def record(found: list[dict], now: float | None = None) -> int:
    """Each flight kept with the route it has now, replacing the one it
    had: an amended flight counts once, by where it was last cleared.
    Flights older than KEEP_S dropped, once an hour. How many were kept."""
    global _pruned_at
    now = time.time() if now is None else now
    rows = []
    for f in found:
        stops = route_stops(f["route"], f["dep"], f["dest"])
        if stops is not None and same(f["dep"]) != same(f["dest"]):
            rows.append((f["gufi"], same(f["dep"]), same(f["dest"]), " ".join(stops), f.get("aircraft"), now))
    with _LOCK:
        db = _connection()
        if rows:
            # The aircraft kept where an update doesn't repeat it.
            db.executemany("""
                INSERT INTO filings (gufi, dep, dest, stops, aircraft, heard) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (gufi) DO UPDATE SET dep = excluded.dep, dest = excluded.dest, stops = excluded.stops,
                    aircraft = COALESCE(excluded.aircraft, filings.aircraft), heard = excluded.heard""", rows)
        if now - _pruned_at > 3600:
            db.execute("DELETE FROM filings WHERE heard < ?", (now - KEEP_S,))
            _pruned_at = now
        db.commit()
    return len(rows)


def heard(xml: str) -> int:
    """A TFMData message's routes kept: app.swim's handler for the feed."""
    return record(filings(xml))


def most_filed(dep: str, dest: str, *, limit: int = 3, now: float | None = None) -> list[dict]:
    """The routes most filed from `dep` to `dest` this past year, the most
    first, each {"stops": [...], "flights": n} with AT_LEAST flights or
    more. Empty where the store has none (or there's no store yet)."""
    now = time.time() if now is None else now
    if _db is None and not STORE.exists():
        return []
    with _LOCK:
        rows = _connection().execute("""
            SELECT stops, COUNT(*) AS n FROM filings WHERE dep = ? AND dest = ? AND heard >= ?
            GROUP BY stops HAVING n >= ? ORDER BY n DESC, stops LIMIT ?""",
            (same(dep), same(dest), now - KEEP_S, AT_LEAST, limit)).fetchall()
    return [{"stops": stops.split() if stops else [], "flights": n} for stops, n in rows]
