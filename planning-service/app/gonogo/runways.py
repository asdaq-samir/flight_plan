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


def density_altitude_ft(pressure_alt_ft: float, temp_c: float) -> float:
    """Density altitude in the engine's standard atmosphere, the one the
    nav log's cruise and climb are flown in (FAA-H-8083-25C, chapter 11)."""
    return ask("gonogo_density_altitude", pressure_alt_ft=pressure_alt_ft, temp_c=temp_c)


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
