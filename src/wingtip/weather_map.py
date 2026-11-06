"""The weather drawn on the map, at the owner's pick (the canvas's map
weather, layers button A, 2026-10-20): the SIGMETs and G-AIRMETs as
areas, the pilot reports where they were made, and the forecast winds
aloft at one altitude at the FD stations -- within the part of the chart
in sight. From the same aviationweather.gov products the briefing reads
(wingtip.weather's held copies), so the map and the Brief never disagree.
The radar and the satellite picture are tiles the browser draws itself
(the Iowa Environmental Mesonet's NEXRAD and GOES mosaics); `radar_valid`
says when the radar was made.
"""
from __future__ import annotations

import math
import time

import requests

from . import weather

#: A SIGMET is a flight's for as long as it is valid; a G-AIRMET is a
#: snapshot valid at its time, three hours apart (wingtip.weather): the one
#: nearest the time asked for is drawn, within this.
GAIRMET_NEAREST_S = 90 * 60

#: The radar mosaic's own record of when it was made (IEM's n0q JSON).
RADAR_META_URL = "https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json"
_RADAR_TTL_S = 120
_radar: dict = {"at": 0.0, "valid": None}


def _in_box(coords: list, box: tuple) -> bool:
    south, west, north, east = box
    lats, lons = [lat for lat, _ in coords], [lon for _, lon in coords]
    return not (max(lats) < south or min(lats) > north or max(lons) < west or min(lons) > east)


def advisories_in(box: tuple, at: float) -> list[dict]:
    """The SIGMETs (convective among them) valid at `at`, UNIX seconds, and
    the G-AIRMET snapshot of each hazard nearest `at` -- each whose area
    reaches into `box` (south, west, north, east) -- as areas to draw:
    {"id", "kind", "hazard", "severity", "low_ft", "high_ft",
    "from_freezing_level", "valid_from", "valid_to", "raw", "coords"}.
    A product that cannot be had leaves its own out, not the others."""
    out: list[dict] = []
    try:
        sigmets = weather._dataset("airsigmets")
    except weather.WeatherServiceError:
        sigmets = []
    for i, a in enumerate(sigmets):
        if len(a["coords"]) < 3 or not _in_box(a["coords"], box):
            continue
        if (a["valid_from"] is not None and a["valid_from"] > at) or (a["valid_to"] is not None and a["valid_to"] <= at):
            continue
        kind = (a["type"] or "SIGMET").upper()
        out.append({
            "id": f"sigmet-{i}", "kind": "convective" if "CONVECTIVE" in (a["hazard"] or "") or "CONVECTIVE" in kind else (
                "airmet" if "AIRMET" in kind else "sigmet"),
            "hazard": a["hazard"], "severity": None, "low_ft": a["altitude_low_ft"], "high_ft": a["altitude_high_ft"],
            "from_freezing_level": False, "valid_from": a["valid_from"], "valid_to": a["valid_to"], "raw": a["raw"],
            "coords": [list(c) for c in a["coords"]],
        })
    try:
        gairmets = weather._dataset("gairmets")
    except weather.WeatherServiceError:
        gairmets = []
    nearest: dict[str, float] = {}
    for a in gairmets:
        if a["valid"] is not None and abs(a["valid"] - at) <= GAIRMET_NEAREST_S:
            nearest[a["hazard"]] = min(nearest.get(a["hazard"], 1e18), abs(a["valid"] - at))
    for i, a in enumerate(gairmets):
        if a["valid"] is None or nearest.get(a["hazard"]) != abs(a["valid"] - at):
            continue
        if len(a["coords"]) < 3 or not _in_box(a["coords"], box):
            continue
        out.append({
            "id": f"gairmet-{i}", "kind": "gairmet", "hazard": a["hazard"], "severity": a["severity"],
            "low_ft": a["altitude_low_ft"], "high_ft": a["altitude_high_ft"], "from_freezing_level": a["from_freezing_level"],
            "valid_from": a["valid"], "valid_to": None, "raw": a["due_to"], "coords": [list(c) for c in a["coords"]],
        })
    return out


def pireps_in(box: tuple, now: float | None = None) -> list[dict]:
    """The pilot reports of the last PIREP_MAX_AGE_S made in `box`, at or
    under PIREP_MAX_ALT_FT -- a light airplane's sky (wingtip.weather) --
    urgent ones last, so they are drawn on top."""
    now = time.time() if now is None else now
    south, west, north, east = box
    try:
        reports = weather._dataset("pireps")
    except weather.WeatherServiceError:
        return []
    found = [
        {k: v for k, v in r.items() if k != "observed"}
        for r in reports
        if r["observed"] is not None and now - r["observed"] <= weather.PIREP_MAX_AGE_S
        and (r["altitude_ft"] is None or r["altitude_ft"] <= weather.PIREP_MAX_ALT_FT)
        and south <= r["lat"] <= north and west <= r["lon"] <= east
    ]
    return sorted(found, key=lambda r: r["urgent"])


def winds_in(box: tuple, altitude_ft: float, fcst_hr: str) -> dict | None:
    """The FD stations' forecast wind and temperature at `altitude_ft` in
    `box`, each where the station is (wingtip.weather.wind_at_altitude's own
    interpolation between the altitudes the product gives), and the
    period the product is for; None where it cannot be had."""
    from . import airports

    try:
        stations = weather._fd_stations(fcst_hr)
    except weather.WeatherServiceError:
        return None
    codes, lats, lons = weather._station_rows(set(stations), airports.load_airports())
    south, west, north, east = box
    out = []
    for code, lat_r, lon_r in zip(codes, lats, lons):
        lat, lon = math.degrees(lat_r), math.degrees(lon_r)
        if not (south <= lat <= north and west <= lon <= east):
            continue
        wind = weather.wind_at_altitude(lat, lon, altitude_ft, fcst_hr)
        if wind is None:
            continue
        temp = weather.temperature_at(weather.temperatures_aloft(lat, lon, fcst_hr), altitude_ft)
        out.append({
            "ident": str(code), "lat": round(lat, 4), "lon": round(lon, 4),
            "dir_true_deg": round(wind["wind_dir_true_deg"]), "speed_kt": round(wind["wind_speed_kt"]),
            "temp_c": None if temp is None else round(temp),
        })
    return {"altitude_ft": altitude_ft, "period": getattr(stations, "period", None), "stations": out}


def radar_valid() -> str | None:
    """When the radar mosaic the map draws was made, ISO UTC, held two
    minutes; None where IEM does not answer (the tiles may still draw)."""
    now = time.time()
    if now - _radar["at"] < _RADAR_TTL_S:
        return _radar["valid"]
    try:
        resp = requests.get(RADAR_META_URL, timeout=5)
        resp.raise_for_status()
        valid = resp.json().get("meta", {}).get("valid")
    except (requests.RequestException, ValueError):
        valid = _radar["valid"]
    _radar.update(at=now, valid=valid)
    return valid
