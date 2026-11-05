"""The runway check at each airport a flight takes off from or lands at
(web/src/lib/runwayCheck.ts, lib/takeoffLanding.ts and lib/pattern.ts's
runwayFlown): the runway the pilot picked, else the one the wind favours,
the field's pressure and density altitude, the reported wind along and
across it, and the POH's short-field distances against that runway's
length -- the runway lengths and takeoff and landing distances 14 CFR
91.103(b) asks a pilot to know.

The rules are the engine's (wingtip_engine::gonogo::runways), asked by
name through wingtip_native.call, as the web app asks them; the runways and
fields it answers by index are put back here as the dicts they were."""
from . import ask


def pressure_altitude_ft(elevation_ft: float, altimeter_in_hg: float | None) -> float:
    """The field's pressure altitude from its elevation and the altimeter
    setting reported (FAA-H-8083-25C, chapter 11)."""
    return field_air(elevation_ft, altimeter_in_hg, 15.0)["pressure_alt_ft"]


def density_altitude_ft(pressure_alt_ft: float, temp_c: float) -> float:
    """Density altitude in the engine's standard atmosphere, the one the
    nav log's cruise and climb are flown in (FAA-H-8083-25C, chapter 11)."""
    return ask("gonogo_density_altitude", pressure_alt_ft=pressure_alt_ft, temp_c=temp_c)


def short_field(table: dict, pressure_alt_ft: float, temp_c: float, weight_lb: float, headwind_kt: float, grass: bool) -> dict:
    """A POH's short-field distances (ShortField) at a pressure altitude,
    temperature and weight, with its notes for the wind and dry grass
    (the Cessna 172S POH, section 5's takeoff and landing notes)."""
    return ask("gonogo_short_field", table=table, pressure_alt_ft=pressure_alt_ft, temp_c=temp_c, weight_lb=weight_lb,
               headwind_kt=headwind_kt, grass=bool(grass))


def soft_surface(runway: dict | None) -> bool:
    """A runway with a soft surface -- turf, grass, dirt or gravel, as
    OurAirports and NASR code it -- for the POH's correction on dry grass."""
    return ask("gonogo_soft_surface", surface=(runway or {}).get("surface"))


def field_air(elevation_ft: float, altimeter_in_hg: float | None, temp_c: float | None) -> dict:
    """The air a field's distances are worked out in: its pressure
    altitude, and the temperature reported, else a standard day's."""
    return ask("gonogo_field_air", elevation_ft=elevation_ft, altimeter_in_hg=altimeter_in_hg, temp_c=temp_c)


def end_distance(table: dict, runway: dict | None, air: dict, weight_lb: float | None, headwind_kt: float) -> dict:
    """One runway end's short-field distance over a 50 ft obstacle, and
    whether it is longer than the runway."""
    return ask("gonogo_end_distance", table=table, runway=runway, pressure_alt_ft=air["pressure_alt_ft"], temp_c=air["temp_c"],
               weight_lb=weight_lb, headwind_kt=headwind_kt)


def runway_number(ident: str) -> str:
    """A runway end as painted: "9" for "09"."""
    return ask("gonogo_runway_number", ident=ident)


def _flown(runways: list[dict], found: dict | None) -> dict | None:
    if found is None:
        return None
    runway = runways[found["runway"]]
    return {"runway": runway, "end": runway["runway_ends"][found["end"]], "by_wind": found["by_wind"]}


def runway_in_use(runways: list[dict]) -> dict | None:
    """The runway end a pilot would take off from and land on (lib/pattern
    runwayInUse): most nearly into the wind (AC 90-66C 11.5), else the
    most used runway's first end."""
    return _flown(runways, ask("gonogo_runway_in_use", runways=runways))


def runway_flown(runways: list[dict], picked: str | None) -> dict | None:
    """The runway end flown at a field (lib/pattern runwayFlown): the
    pilot's pick where they made one, else runway_in_use."""
    return _flown(runways, ask("gonogo_runway_flown", runways=runways, picked=picked))


def picked_end(picks: dict | None, ident: str, kind: str, departure: bool) -> str | None:
    """The end the pilot picked at `ident` for a "takeoff" or a "landing",
    by the field's ICAO or FAA ident alike (lib/pattern pickedEnd, with
    lib/procedures sameField's matching): `picks["pattern"]` holds the
    departure's runway out and every other field's runway in,
    `picks["takeoff"]` a stop's runway out."""
    return ask("gonogo_picked_end", picks=picks or None, ident=ident, kind=kind, departure=bool(departure))


def runway_checks(aircraft: dict | None, briefing: dict | None, fields: list[dict] | None,
                  takeoff_lb: float | None, landing_lb: float | None, picks: dict | None = None) -> list[dict]:
    """Every airport the flight takes off from or lands at, the distances
    it needs there: the takeoff from the departure, the landing at the
    destination, both at a stop. `fields` are the route's airports in
    order, each its `ident` and `elevation_ft`, a waypoint left out.
    Empty without the POH's tables or the briefing's runways."""
    aircraft = aircraft or {}
    # A briefing not yet in is null to the web; one with nothing in it is
    # still a briefing.
    if briefing is None or not fields or not aircraft.get("takeoff") or not aircraft.get("landing"):
        return []
    idents = {f["ident"] for f in fields}
    airports = briefing.get("airports") or {}
    checks = ask("gonogo_runway_checks", aircraft={k: aircraft.get(k) for k in ("takeoff", "landing", "crosswind")},
                 fields=[{"ident": f["ident"], "elevation_ft": f.get("elevation_ft")} for f in fields],
                 metars={i: m for i, m in (briefing.get("metars") or {}).items() if i in idents},
                 airports={i: a for i, a in airports.items() if i in idents}, takeoff_lb=takeoff_lb, landing_lb=landing_lb,
                 picks=picks or None)
    for c in checks:
        field = fields[c["field"]]
        runways = (airports.get(field["ident"]) or {}).get("runways") or []
        c["field"] = field
        c["runway"] = None if c["runway"] is None else runways[c["runway"]]
        for d in c["distances"]:
            d["runway"] = None if d["runway"] is None else runways[d["runway"]]
    return checks
