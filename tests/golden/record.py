"""Records a route's nav log for tests/test_golden_routes.py: what the
nav log engine (vfr.navlog) was given for it -- the fixes, each leg's
legal altitudes, the aeroplane, the forecast period, the field's
elevation and the pattern altitude at the end -- every wind,
temperature and magnetic variation it asked for, and what it made of
them: the four plans and the flown plan's legs with their tops of climb
and descent.

Run in the planner's container, the stack's live data under it, when a
change to the nav log is meant and the golden files are to follow it:

    docker exec -w /workspace flight_plan-planning-service-1 \\
        python -m tests.golden.record C81-KDLH KUGN-KRFD

then read the diff of tests/golden/*.json before committing it.
"""
import json
import sys
from pathlib import Path

from vfr import navlog

HERE = Path(__file__).resolve().parent


def _key(*parts) -> str:
    return ",".join(f"{p:.5f}" if isinstance(p, float) else str(p) for p in parts)


def record(route: str) -> dict:
    # The planner, only to record: the test replays without it.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "planning-service"))
    from fastapi.testclient import TestClient

    from app import planning
    from app.main import app
    from app.routers import plan as plan_router

    dep, dest = route.split("-")
    winds, temps, variations, given = {}, {}, {}, {}
    real = (navlog.wind_at_altitude, navlog.temperature_at_altitude, navlog.magnetic_variation_deg, navlog.altitude_profiles)

    def wind(lat, lon, alt, fcst_hr="06"):
        value = real[0](lat, lon, alt, fcst_hr)
        winds[_key(lat, lon, alt)] = value
        return value

    def temp(lat, lon, alt, fcst_hr="06"):
        value = real[1](lat, lon, alt, fcst_hr)
        temps[_key(lat, lon, alt)] = value
        return value

    def variation(lat, lon, on=None):
        value = real[2](lat, lon)
        variations[_key(lat, lon)] = value
        return value

    def profiles(fix_list, segments, aircraft_profile, fcst_hr="06", departure_elevation_ft=None):
        given.update(fixes=fix_list, segments=segments, profile=aircraft_profile, fcst_hr=fcst_hr,
                     departure_elevation_ft=departure_elevation_ft)
        return real[3](fix_list, segments, aircraft_profile, fcst_hr, departure_elevation_ft=departure_elevation_ft)

    planning._PLANS_CACHE.clear()
    planning._ALTITUDE_CACHE.clear()
    navlog.wind_at_altitude, navlog.temperature_at_altitude, navlog.magnetic_variation_deg = wind, temp, variation
    navlog.altitude_profiles = profiles
    try:
        body = TestClient(app).get("/api/plan", params={"dep": dep, "dest": dest}).json()
    finally:
        navlog.wind_at_altitude, navlog.temperature_at_altitude, navlog.magnetic_variation_deg, navlog.altitude_profiles = real
    recorded = {
        "route": route,
        "given": {**given, "profile": {k: v for k, v in given["profile"].items() if not isinstance(v, (dict, list))},
                  "pattern_ft": plan_router.pattern_altitude(plan_router.load_route(dep, dest)), "choice": body["altitude_choice"]},
        "lookups": {"winds": winds, "temperatures": temps, "variations": variations},
    }
    # The expected answer from the recorded lookups alone, as the test
    # computes it -- not from the live ones the plan used.
    recorded["expected"] = replay(recorded)
    return json.loads(json.dumps(recorded))


def replay(recorded: dict) -> dict:
    """The engine run on a recorded route, its lookups answered from the
    record: a lookup it did not make then is a KeyError -- the engine
    asks something new."""
    lookups = recorded["lookups"]
    real = (navlog.wind_at_altitude, navlog.temperature_at_altitude, navlog.magnetic_variation_deg)
    navlog.wind_at_altitude = lambda lat, lon, alt, fcst_hr="06": lookups["winds"][_key(lat, lon, alt)]
    navlog.temperature_at_altitude = lambda lat, lon, alt, fcst_hr="06": lookups["temperatures"][_key(lat, lon, alt)]
    navlog.magnetic_variation_deg = lambda lat, lon, on=None: lookups["variations"][_key(lat, lon)]
    try:
        given = recorded["given"]
        return expected(given, given["pattern_ft"], given["choice"])
    finally:
        navlog.wind_at_altitude, navlog.temperature_at_altitude, navlog.magnetic_variation_deg = real


def expected(given: dict, pattern_ft, choice: str) -> dict:
    """What the engine makes of `given` with the recorded lookups: the
    plans' altitudes, times and fuel, and the chosen plan's legs."""
    plans = navlog.altitude_profiles(given["fixes"], given["segments"], given["profile"], given["fcst_hr"],
                                     departure_elevation_ft=given["departure_elevation_ft"])
    legs = navlog.with_descents(plans[choice]["legs"], given["fixes"], pattern_ft)
    return {
        "plans": {kind: {"steps": [s["altitude_ft"] for s in p["steps"]], "ete_min": p["ete_min"], "fuel_gal": p["fuel_gal"]}
                  for kind, p in plans.items()},
        "choice": choice,
        "legs": [summary(leg) for leg in legs],
    }


def summary(leg: dict) -> dict:
    def r(v):
        return None if v is None else round(v, 1)
    return {
        "altitude_ft": leg["altitude_ft"], "distance_nm": r(leg["distance_nm"]), "magnetic_heading_deg": r(leg["magnetic_heading_deg"]),
        "groundspeed_kt": r(leg["groundspeed_kt"]), "ete_min": r(leg["ete_min"]), "fuel_gal": r(leg["fuel_gal"]),
        "climb_min": leg["climb_min"],
        "toc_nm": leg["toc"]["along_nm"] if leg.get("toc") else None,
        "tod_nm": leg["tod"]["along_nm"] if leg.get("tod") else None,
        "tod_fpm": leg["tod"]["fpm"] if leg.get("tod") else None,
    }


if __name__ == "__main__":
    for name in sys.argv[1:]:
        recorded = record(name)
        # The expected answer from the recorded lookups alone, as the
        # test computes it -- not from the live ones the plan used.
        (HERE / f"{name}.json").write_text(json.dumps(recorded, indent=1, sort_keys=True) + "\n")
        print(name, len(recorded["lookups"]["winds"]), "winds,", len(recorded["expected"]["legs"]), "legs")
