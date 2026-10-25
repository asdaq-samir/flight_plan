"""The runway check at each airport a flight takes off from or lands at
(web/src/lib/runwayCheck.ts, lib/takeoffLanding.ts and lib/pattern.ts's
runwayFlown): the runway the pilot picked, else the one the wind
favours, the field's pressure and density altitude, the reported wind
along and across it, and the POH's short-field distances against that
runway's length -- the runway lengths and takeoff and landing distances
14 CFR 91.103(b) asks a pilot to know."""
import math
import re

from .minimums import runway_crosswind_kt

#: The ICAO standard atmosphere's troposphere (ICAO Doc 7488): sea level
#: 288.15 K, the lapse rate 6.5 K a kilometre (0.0019812 K a foot), and
#: the exponents its pressure and density fall off with height by --
#: g/(R·L) and one less.
T0_K = 288.15
LAPSE_K_PER_FT = 0.0019812
PRESSURE_EXP = 5.25588
DENSITY_EXP = PRESSURE_EXP - 1


def isa_temp_c(altitude_ft: float) -> float:
    """A standard day's temperature at an altitude, as vfr.performance has it."""
    return 15 - 0.0019812 * altitude_ft


def pressure_altitude_ft(elevation_ft: float, altimeter_in_hg: float | None) -> float:
    """The field's pressure altitude from its elevation and the altimeter
    setting reported: a thousand feet for every inch under 29.92
    (FAA-H-8083-25C, chapter 11)."""
    return elevation_ft + ((29.92 - altimeter_in_hg) * 1000 if altimeter_in_hg else 0)


def density_altitude_ft(pressure_alt_ft: float, temp_c: float) -> float:
    """Density altitude: the height in the standard atmosphere whose air is
    as thin as the field's, from its pressure altitude and temperature --
    worked out from the atmosphere itself rather than the 120 ft a degree
    rule of thumb. What an airplane performs as if it were at
    (FAA-H-8083-25C, chapter 11)."""
    pressure = (1 - (LAPSE_K_PER_FT * pressure_alt_ft) / T0_K) ** PRESSURE_EXP
    density = pressure / ((temp_c + 273.15) / T0_K)
    return (T0_K / LAPSE_K_PER_FT) * (1 - density ** (1 / DENSITY_EXP))


def _at(points: list[float], value: float) -> dict:
    """A value between table points, its edge where it is beyond them."""
    n = len(points)
    if value <= points[0]:
        return {"i": 0, "f": 0.0, "beyond": value < points[0]}
    if value >= points[n - 1]:
        return {"i": n - 2, "f": 1.0, "beyond": value > points[n - 1]}
    i = 0
    while points[i + 1] < value:
        i += 1
    return {"i": i, "f": (value - points[i]) / (points[i + 1] - points[i]), "beyond": False}


def _bilinear(grid: list[list[float]], row: dict, col: dict) -> float:
    def g(r, c):
        return grid[r][c]
    top = g(row["i"], col["i"]) + (g(row["i"], col["i"] + 1) - g(row["i"], col["i"])) * col["f"]
    bottom = g(row["i"] + 1, col["i"]) + (g(row["i"] + 1, col["i"] + 1) - g(row["i"] + 1, col["i"])) * col["f"]
    return top + (bottom - top) * row["f"]


def short_field(table: dict, pressure_alt_ft: float, temp_c: float, weight_lb: float, headwind_kt: float, grass: bool) -> dict:
    """A POH's short-field distances (ShortField) at a pressure altitude,
    temperature and weight: read between the table's altitudes and
    temperatures, and between its weights (a weight under the lightest
    table taken at that table, which is the longer); then its notes -- a
    tenth less for every 9 kt of headwind, a tenth more for every 2 kt of
    tailwind up to 10 -- and on dry grass the ground roll's share more
    (the Cessna 172S POH, section 5's takeoff and landing notes)."""
    caveats = []
    row = _at(table["pressure_altitudes_ft"], pressure_alt_ft)
    col = _at(table["temperatures_c"], temp_c)
    if row["beyond"]:
        caveats.append("the field is higher than the table goes")
    if col["beyond"]:
        caveats.append("the temperature is beyond the table's")
    # Weights heaviest first; read between the two either side.
    weights = table["weights_lb"]

    def read(key: str) -> float:
        values = [_bilinear(t[key], row, col) for t in table["tables"]]
        if len(weights) == 1 or weight_lb >= weights[0]:
            return values[0]
        for k in range(len(weights) - 1):
            if weight_lb >= weights[k + 1]:
                f = (weights[k] - weight_lb) / (weights[k] - weights[k + 1])
                return values[k] + (values[k + 1] - values[k]) * f
        return values[-1]

    roll = read("ground_roll_ft")
    total = read("total_50ft_ft")
    factor = 1 - 0.1 * (headwind_kt / 9) if headwind_kt >= 0 else 1 + 0.1 * (-headwind_kt / 2)
    if headwind_kt < -10:
        caveats.append("the POH gives no figures for a tailwind over 10 kt")
    roll *= factor
    total *= factor
    if grass:
        added = (table["grass_ground_roll_pct"] / 100) * roll
        roll += added
        total += added
    # Up to the next 5 ft, never down: a distance a runway is checked
    # against reads long rather than short.
    return {"ground_roll_ft": math.ceil(roll / 5) * 5, "total_ft": math.ceil(total / 5) * 5, "caveats": caveats}


def soft_surface(runway: dict | None) -> bool:
    """A runway with a soft surface -- turf, grass, dirt or gravel, as
    OurAirports and NASR code it -- for the POH's correction to the ground
    roll on dry grass."""
    return bool(re.search(r"turf|grass|grs|dirt|gravel", (runway or {}).get("surface") or "", re.I))


def field_air(elevation_ft: float, altimeter_in_hg: float | None, temp_c: float | None) -> dict:
    """The air a field's distances are worked out in: its pressure
    altitude from the altimeter reported (a standard 29.92 without one)
    and the temperature reported, else a standard day's at its elevation."""
    return {"pressure_alt_ft": pressure_altitude_ft(elevation_ft, altimeter_in_hg),
            "temp_c": temp_c if temp_c is not None else isa_temp_c(elevation_ft)}


def end_distance(table: dict, runway: dict | None, air: dict, weight_lb: float | None, headwind_kt: float) -> dict:
    """One runway end's short-field distance over a 50 ft obstacle, at the
    weight (the table's heaviest, the longest distance, where none is
    known), with the headwind on that end (a tailwind negative) and the
    correction for a soft surface; and whether it is longer than the
    runway."""
    d = short_field(table, air["pressure_alt_ft"], air["temp_c"],
                    weight_lb if weight_lb is not None else max(table["weights_lb"]), headwind_kt, soft_surface(runway))
    length = (runway or {}).get("length_ft")
    return {**d, "over": length is not None and d["total_ft"] > length}


def runway_number(ident: str) -> str:
    """A runway end as painted: "9" for "09"."""
    return re.sub(r"^0+(?=\d)", "", ident)


def _paved(r: dict) -> bool:
    """Paved, asphalt or concrete (OurAirports' surface codes), where an
    unpaved strip may be listed longer."""
    return bool(re.search(r"asp|con|bit|pem|paved", r.get("surface") or "", re.I))


def _most_used_key(r: dict) -> tuple:
    """Paved first, then the longer: the runway a field's traffic uses
    most, as far as its data says."""
    return (-int(_paved(r)), -(r.get("length_ft") or 0))


def runway_in_use(runways: list[dict]) -> dict | None:
    """The runway end a pilot would take off from and land on (lib/pattern
    runwayInUse): of the ends the reported wind favours, the one with the
    most headwind -- AC 90-66C 11.5's runway most nearly into the wind,
    calm, the one the field's last wind favoured -- or, with no wind
    reported, the most used runway's first end. Only ends with a heading."""
    open_ = [r for r in runways if not r.get("closed")
             and any(e.get("heading_true_deg") is not None for e in r.get("runway_ends") or [])]
    winded = sorted((r for r in open_ if r.get("wind")),
                    key=lambda r: (-int(bool(r["wind"].get("in_use"))), -r["wind"]["headwind_kt"], *_most_used_key(r)))
    for runway in winded:
        end = next((e for e in runway.get("runway_ends") or []
                    if e["ident"] == runway["wind"]["end"] and e.get("heading_true_deg") is not None), None)
        if end:
            return {"runway": runway, "end": end, "by_wind": True}
    longest = sorted(open_, key=_most_used_key)[0] if open_ else None
    end = next((e for e in (longest or {}).get("runway_ends") or [] if e.get("heading_true_deg") is not None), None)
    return {"runway": longest, "end": end, "by_wind": False} if longest and end else None


def runway_flown(runways: list[dict], picked: str | None) -> dict | None:
    """The runway end flown at a field (lib/pattern runwayFlown): the
    pilot's pick where they made one, else runway_in_use."""
    if picked:
        for runway in (r for r in runways if not r.get("closed")):
            end = next((e for e in runway.get("runway_ends") or []
                        if runway_number(e["ident"]) == runway_number(picked) and e.get("heading_true_deg") is not None), None)
            if end:
                return {"runway": runway, "end": end, "by_wind": (runway.get("wind") or {}).get("end") == end["ident"]}
    return runway_in_use(runways)


def picked_end(picks: dict | None, ident: str, kind: str, departure: bool) -> str | None:
    """The end the pilot picked at `ident` for a "takeoff" or a "landing",
    by the field's ICAO or FAA ident alike (lib/pattern pickedEnd):
    `picks["pattern"]` holds the departure's runway out and every other
    field's runway in, `picks["takeoff"]` a stop's runway out."""
    if not picks:
        return None
    by_field = (picks.get("takeoff") if kind == "takeoff" and not departure else picks.get("pattern")) or {}

    def bare(i: str) -> str:
        return (i[1:] if len(i) == 4 and i.startswith("K") else i).upper()

    for field, end in by_field.items():
        if bare(field) == bare(ident):
            return None if end == "NONE" else end
    return None


def runway_checks(aircraft: dict | None, briefing: dict | None, fields: list[dict] | None,
                  takeoff_lb: float | None, landing_lb: float | None, picks: dict | None = None) -> list[dict]:
    """Every airport the flight takes off from or lands at, the distances
    it needs there: the takeoff from the departure, the landing at the
    destination, both at a stop. `fields` are the route's airports in
    order, each its `ident` and `elevation_ft`, a waypoint left out.
    Empty without the POH's tables or the briefing's runways."""
    takeoff_table = (aircraft or {}).get("takeoff")
    landing_table = (aircraft or {}).get("landing")
    if not briefing or not fields or not takeoff_table or not landing_table:
        return []
    demonstrated = ((aircraft or {}).get("crosswind") or {}).get("demonstrated_kt")
    checks = []
    for i, field in enumerate(fields):
        metar = (briefing.get("metars") or {}).get(field["ident"])
        runways = ((briefing.get("airports") or {}).get(field["ident"]) or {}).get("runways") or []
        # The runway the wind favours most, or the longest without a wind.
        windward = next(iter(sorted(
            (r for r in runways if not r.get("closed")),
            key=lambda r: (-(r["wind"]["headwind_kt"] if r.get("wind") else -99), -(r.get("length_ft") or 0)),
        )), None)

        def flown_for(kind: str, field=field, runways=runways, windward=windward, i=i) -> dict:
            # The pilot's pick, checked whatever the wind, with the wind on
            # the end picked (a tailwind on the far end of the wind's
            # runway); else the wind's.
            pick = picked_end(picks, field["ident"], kind, i == 0)
            flown = runway_flown(runways, pick)
            picked = bool(flown) and bool(pick)
            runway = flown["runway"] if picked else windward
            w = (runway or {}).get("wind")
            end = flown["end"]["ident"] if picked else (w or {}).get("end")
            headwind = (-w["headwind_kt"] if end is not None and end != w["end"] else w["headwind_kt"]) if w else 0
            crosswind = runway_crosswind_kt(w) if w else 0
            return {"runway": runway, "end": end, "picked": picked, "headwind": headwind, "crosswind": crosswind}

        air = field_air(field.get("elevation_ft") or 0, (metar or {}).get("altimeter_in_hg"), (metar or {}).get("temp_c"))
        last = i == len(fields) - 1
        kinds = ["takeoff"] if i == 0 else ["landing"] if last else ["landing", "takeoff"]
        first = flown_for(kinds[0])
        distances = []
        for kind in kinds:
            on = flown_for(kind)
            d = end_distance(takeoff_table if kind == "takeoff" else landing_table, on["runway"], air,
                             takeoff_lb if kind == "takeoff" else landing_lb, on["headwind"])
            distances.append({"kind": kind, **d, "runway": on["runway"], "end": on["end"]})
        checks.append({
            "field": field, "role": "Departure" if i == 0 else "Destination" if last else "Stop",
            "runway": first["runway"], "end": first["end"], "picked": first["picked"],
            "pressure_alt_ft": air["pressure_alt_ft"], "density_alt_ft": density_altitude_ft(air["pressure_alt_ft"], air["temp_c"]),
            "temp_c": air["temp_c"], "reported": bool(metar),
            "headwind_kt": first["headwind"], "crosswind_kt": first["crosswind"],
            "crosswind_over": demonstrated is not None and first["crosswind"] > demonstrated,
            "grass": soft_surface(first["runway"]), "distances": distances,
        })
    return checks
