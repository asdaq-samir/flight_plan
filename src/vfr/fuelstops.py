"""Where a flight too long for its tanks can land for fuel, as an electric
car's planner offers its chargers on the way: the fields that sell the
airplane's fuel near the course, the one that makes the trip quickest
put in for the pilot, and others to choose from.

A flight reaches a field when the fuel to it -- the start, taxi and
takeoff allowance and the course's own burn per mile -- leaves at least
the reserve the flight is held to: 30 minutes by day and 45 at night
under VFR (14 CFR 91.151(a)), 45 under IFR (91.167(a)(3)), as
vfr.navlog.fuel_plan works it. The burn per mile and the minutes per mile
are the flight's own, from its legs as planned (winds and climb in them),
so a field off the line costs what its extra miles cost there. The plan
made with the stop put in is the real check: this only chooses where.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from . import airports, faa_data
from .geo import distance_nm
from .terrain import DEFAULT_FAA_CACHE_DIR

#: The fuel looked for: avgas, which every piston profile here burns. A
#: field's FUEL_TYPES lists what it sells (the FAA's NASR APT_BASE).
FUEL = "100LL"

#: The shortest runway a stop is offered on, feet, paved: a suggestion a
#: pilot would turn down on sight -- a turf strip, a 1,800 ft runway -- is
#: no help. Not a rule; the pilot still judges the field (14 CFR 91.103(b)).
MIN_RUNWAY_FT = 2500

#: How far off the straight line a stop may take the flight, the miles it
#: adds: beyond that, a field nearer the line is always the better stop.
MAX_ADDED_NM = 30.0

#: Stops put in for one flight at most: eight, half the planner's own most
#: for a route (app.common.MAX_STOPS), so a long trip is planned whole at once. At 3, a
#: Los Angeles to Hartford in a 48-gallon airplane was given three and,
#: once they were kept, asked for a fourth (the owner's "After it added 3
#: stops, it asked for another fuel stop").
MAX_STOPS = 8

#: Fields offered beside the one put in.
CHOICES = 4

#: The minutes that count as the same trip when choosing between fields:
#: a few minutes are not worth landing with less fuel.
SAME_MINUTES = 5.0


@dataclass(frozen=True)
class FuelStop:
    ident: str
    name: str
    city: str
    lat: float
    lon: float
    #: Miles from the flight's departure to it, and the miles it adds to
    #: the flight's straight line.
    from_nm: float
    added_nm: float
    #: The fuel left on landing there, gallons, and the minutes flown to
    #: it from the flight's departure.
    lands_with_gal: float
    minutes: float
    fuel_types: str
    runway_ft: int
    elevation_ft: float | None

    def as_dict(self) -> dict:
        return asdict(self)


@lru_cache(maxsize=4)
def _fields_of(path: str, _mtime: float, fuel_only: bool = True) -> pd.DataFrame:
    """The public airports that sell FUEL, from APT_BASE -- or, not
    `fuel_only`, every public airport: ident (the ICAO one where there is
    one, as the route spells it), name, city, where, elevation and what
    fuel."""
    df = faa_data._read_apt_base_cached(path, _mtime)
    sells = df["FUEL_TYPES"].fillna("").str.split(",").apply(lambda types: FUEL in [t.strip() for t in types])
    open_public = (df["FACILITY_USE_CODE"] == "PU") & (df["SITE_TYPE_CODE"] == "A") & (df["ARPT_STATUS"].fillna("O") == "O")
    df = df[(sells | (not fuel_only)) & open_public]
    icao = df["ICAO_ID"].fillna("").str.strip()
    return pd.DataFrame({
        "ident": np.where(icao != "", icao, df["ARPT_ID"].str.strip()),
        "faa_ident": df["ARPT_ID"].str.strip(),
        "name": df["ARPT_NAME"].fillna("").str.strip(),
        "city": df["CITY"].fillna("").str.strip(),
        "lat": df["LAT_DECIMAL"].astype(float),
        "lon": df["LONG_DECIMAL"].astype(float),
        "elevation_ft": pd.to_numeric(df["ELEV"], errors="coerce"),
        "fuel_types": df["FUEL_TYPES"].fillna("").str.strip(),
    }).reset_index(drop=True)


def fields_with_fuel(cache_dir=DEFAULT_FAA_CACHE_DIR) -> pd.DataFrame:
    path = faa_data.ensure_nasr_file("APT_BASE.csv", cache_dir)
    return _fields_of(str(path), Path(path).stat().st_mtime)


def public_fields(cache_dir=DEFAULT_FAA_CACHE_DIR) -> pd.DataFrame:
    """Every open public airport, fuel or not: a meal or a bed needs none."""
    path = faa_data.ensure_nasr_file("APT_BASE.csv", cache_dir)
    return _fields_of(str(path), Path(path).stat().st_mtime, False)


@lru_cache(maxsize=2)
def _paved_runways_of(path: str, _mtime: float) -> dict[str, int]:
    """Each field's longest open paved runway, feet, by ident (OurAirports'
    runways table: "ASPH", "CONC", "ASPH-G" and the like are paved)."""
    df = airports._read_table(path, _mtime)
    surface = df["surface"].fillna("").str.upper()
    paved = surface.str.contains("ASP|CON|PEM|BIT", regex=True) & (df["closed"].fillna(0).astype(int) == 0)
    df = df[paved & df["length_ft"].notna()]
    return df.groupby(df["airport_ident"].str.upper())["length_ft"].max().astype(int).to_dict()


def paved_runway_ft(ident: str) -> int:
    path = airports._ensure_cached(airports.RUNWAYS_URL, airports.RUNWAYS_CACHE_PATH)
    return _paved_runways_of(str(path), Path(path).stat().st_mtime).get(ident.strip().upper(), 0)


def _corridor(start: tuple, end: tuple, fields: pd.DataFrame, skip: set) -> list[dict]:
    """The fields with fuel no more than MAX_ADDED_NM off the straight line
    from `start` to `end`, on a long enough paved runway, not the route's
    own (`skip`)."""
    direct = float(distance_nm(start[0], start[1], end[0], end[1]))
    lat, lon = fields["lat"].to_numpy(), fields["lon"].to_numpy()
    added = distance_nm(start[0], start[1], lat, lon) + distance_nm(lat, lon, end[0], end[1]) - direct
    out = []
    for i in np.flatnonzero(added <= MAX_ADDED_NM):
        row = fields.iloc[i]
        if row["ident"] in skip or row["faa_ident"] in skip:
            continue
        runway = max(paved_runway_ft(row["ident"]), paved_runway_ft(row["faa_ident"]))
        if runway >= MIN_RUNWAY_FT:
            out.append({**row.to_dict(), "runway_ft": runway})
    return out


def _fits(start: tuple, end: tuple, fuel_per_nm: float, usable_gal: float, taxi_gal: float, reserve_gal: float) -> bool:
    return usable_gal - taxi_gal - float(distance_nm(start[0], start[1], end[0], end[1])) * fuel_per_nm >= reserve_gal


def suggest(start: tuple, end: tuple, *, fuel_per_nm: float, min_per_nm: float, usable_gal: float,
            taxi_gal: float, reserve_gal: float, ground_min: float = 30.0, skip: set | None = None,
            fields: pd.DataFrame | None = None) -> tuple[list[FuelStop], list[FuelStop]]:
    """The stops that take a flight from `start` to `end` (lat, lon) with
    the reserve left on every landing -- the tanks filled at each -- and
    other fields the first could be: ([], []) where none is needed or no
    fields reach.

    The quickest trip: the miles flown at the flight's minutes per mile
    and `ground_min` on the ground at each stop, the least of them over
    every chain of fields the tanks reach between (a shortest path from
    the destination back). Among first stops within SAME_MINUTES of the
    quickest, the one whose landings keep the most fuel, so no leg of it
    runs close; the others offered, quickest first."""
    if _fits(start, end, fuel_per_nm, usable_gal, taxi_gal, reserve_gal):
        return [], []
    fields = fields_with_fuel() if fields is None else fields
    nodes = _corridor(start, end, fields, set(skip or ()))
    if not nodes:
        return [], []
    reach_nm = (usable_gal - taxi_gal - reserve_gal) / fuel_per_nm
    # Index 0 the destination, then the fields.
    lat = np.array([end[0]] + [n["lat"] for n in nodes])
    lon = np.array([end[1]] + [n["lon"] for n in nodes])
    apart = distance_nm(lat[:, None], lon[:, None], lat[None, :], lon[None, :])
    # Minutes from each to the destination, the stops on the way counted,
    # and the next place on the quickest way there.
    to_go = np.full(len(lat), np.inf)
    to_go[0] = 0.0
    then = np.full(len(lat), -1)
    done = np.zeros(len(lat), dtype=bool)
    for _ in range(len(lat)):
        open_ = np.where(done, np.inf, to_go)
        here = int(np.argmin(open_))
        if not np.isfinite(open_[here]):
            break
        done[here] = True
        # Landing at `here` from each field i: its leg, and the stop's
        # time on the ground where `here` is a field, not the destination.
        via = apart[:, here] * min_per_nm + (ground_min if here else 0.0) + to_go[here]
        better = (apart[:, here] <= reach_nm) & (via < to_go) & ~done
        to_go[better] = via[better]
        then[better] = here
    from_start = distance_nm(start[0], start[1], lat, lon)
    first = [i for i in range(1, len(lat)) if from_start[i] <= reach_nm and np.isfinite(to_go[i])]
    if not first:
        return [], []

    def chain(i: int) -> list[int]:
        out = [i]
        while then[out[-1]] > 0:
            out.append(int(then[out[-1]]))
        return out

    def trip(i: int) -> float:
        return from_start[i] * min_per_nm + ground_min + to_go[i]

    def least_landing(i: int) -> float:
        legs = [from_start[i]] + [apart[a, b] for a, b in zip(chain(i), chain(i)[1:] + [0])]
        return usable_gal - taxi_gal - max(legs) * fuel_per_nm

    first = [i for i in first if len(chain(i)) <= MAX_STOPS]
    if not first:
        return [], []
    quickest = min(trip(i) for i in first)
    ranked = sorted(first, key=lambda i: (trip(i) > quickest + SAME_MINUTES, -least_landing(i), trip(i)))
    direct = float(distance_nm(start[0], start[1], end[0], end[1]))

    def stop(i: int, prev: int | None, flown_nm: float) -> FuelStop:
        n = nodes[i - 1]
        leg = from_start[i] if prev is None else apart[prev, i]
        off = float(distance_nm(start[0], start[1], n["lat"], n["lon"]) + distance_nm(n["lat"], n["lon"], end[0], end[1])) - direct
        at_nm = flown_nm + float(leg)
        return FuelStop(
            ident=n["ident"], name=n["name"], city=n["city"], lat=float(n["lat"]), lon=float(n["lon"]),
            from_nm=round(at_nm, 1),
            added_nm=round(off, 1),
            lands_with_gal=round(usable_gal - taxi_gal - float(leg) * fuel_per_nm, 1),
            minutes=round(at_nm * min_per_nm, 1),
            fuel_types=n["fuel_types"], runway_ft=int(n["runway_ft"]),
            elevation_ft=None if pd.isna(n["elevation_ft"]) else float(n["elevation_ft"]),
        )

    stops, prev, flown = [], None, 0.0
    for i in chain(ranked[0]):
        stops.append(stop(i, prev, flown))
        flown, prev = stops[-1].from_nm, i
    choices = [stop(i, None, 0.0) for i in ranked[1:1 + CHOICES]]
    return stops, choices


#: The most fields listed along a route (along): the nearest the line
#: first, so a long flight's list stays one a pilot reads, and its
#: places are read in seconds, not a minute.
ALONG_MOST = 40


def along(flights: list[tuple[str, tuple, tuple]], skip: set | None = None,
          fields: pd.DataFrame | None = None) -> list[dict]:
    """The public fields on a long enough paved runway no more than
    MAX_ADDED_NM off each flight's straight line ((departure ident, start,
    end) for each), at the owner's ask for the food, fuel and rest stops
    along the route to pick from (2026-10-23, the map's Stops): each
    with the flight it is on (`flight`, its index, and `departure`), its
    miles from that flight's departure and the miles it adds, in route
    order. A field near two flights is listed on the first; the ALONG_MOST
    nearest the line kept."""
    fields = public_fields() if fields is None else fields
    seen, out = set(skip or ()), []
    for k, (departure, start, end) in enumerate(flights):
        for n in _corridor(start, end, fields, seen):
            if n["ident"] in seen:
                continue
            seen.add(n["ident"])
            to_it = float(distance_nm(start[0], start[1], n["lat"], n["lon"]))
            then = float(distance_nm(n["lat"], n["lon"], end[0], end[1]))
            out.append({
                "ident": n["ident"], "name": n["name"], "city": n["city"], "lat": float(n["lat"]), "lon": float(n["lon"]),
                "flight": k, "departure": departure, "from_nm": round(to_it, 1),
                "added_nm": round(to_it + then - float(distance_nm(start[0], start[1], end[0], end[1])), 1),
                "fuel_types": [t.strip() for t in str(n["fuel_types"]).split(",") if t.strip()],
                "runway_ft": int(n["runway_ft"]),
                "elevation_ft": None if pd.isna(n["elevation_ft"]) else float(n["elevation_ft"]),
            })
    kept = sorted(out, key=lambda f: f["added_nm"])[:ALONG_MOST]
    return sorted(kept, key=lambda f: (f["flight"], f["from_nm"]))
