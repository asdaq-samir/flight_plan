"""Live weather constraints on VFR altitude selection: freezing level
(icing avoidance), forecast ceiling/visibility along the route, and
SIGMET/AIRMET hazard advisories -- all from aviationweather.gov's public
JSON/text APIs.

Unlike the FAA NASR/DOF data in vfr.faa_data, none of this is cached to
disk: it's live/current-conditions data (a forecast issued hours ago is
stale, not "the current cycle"), so every call re-fetches.
"""
import re

import requests

HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
WINDTEMP_URL = "https://aviationweather.gov/api/data/windtemp"
TAF_URL = "https://aviationweather.gov/api/data/taf"
AIRSIGMET_URL = "https://aviationweather.gov/api/data/airsigmet"


# --- Freezing level, from the winds/temps-aloft ("FD") text product ---


def _fetch_fd_text(fcst_hr: str = "06") -> str:
    resp = requests.get(
        WINDTEMP_URL, params={"region": "us", "level": "low", "fcst": fcst_hr}, headers=HEADERS, timeout=30
    )
    resp.raise_for_status()
    return resp.text


def _parse_fd_station_row(row: str, alt_positions: list) -> tuple:
    """A station's wind/temp groups aren't fixed-width at the byte level
    -- a group for an altitude below the station's own elevation is
    omitted entirely (not blank-padded), which shifts every later token
    left. So tokens are matched to altitude columns by nearest character
    position to the header's own column position, not by slice or
    token-count -- verified against real FD output including rows with
    skipped low-altitude columns (e.g. a high-elevation station with no
    3000ft/6000ft groups at all).
    """
    station_id = row[0:3].strip()
    groups = {}
    for m in re.finditer(r"\S+", row[3:]):
        pos = m.start() + 3
        nearest_alt = min(alt_positions, key=lambda ap: abs(ap[0] - pos))[1]
        groups[nearest_alt] = m.group()
    return station_id, groups


def _decode_temp_c(group: str) -> float | None:
    """Extract the temperature from a wind/temp group. The 3000ft column
    is wind-only (4 chars, e.g. "3220") when the station itself is near
    that altitude -- no temp to extract. 6000-24000ft groups are 7 chars
    with an explicit sign (e.g. "3028+18"). 30000ft+ groups are 6 chars,
    unsigned, and always negative (the product's own header states
    "TEMPS NEG ABV 24000" -- the sign is omitted because it's implied).
    """
    if len(group) == 7 and group[4] in "+-":
        return float(group[4:7])
    if len(group) == 6 and group[4:6].isdigit():
        return -float(group[4:6])
    return None


def parse_fd_text(text: str) -> dict:
    """{station_id: {altitude_ft: temp_c}} for every station in the FD text."""
    lines = text.splitlines()
    header_idx = next(i for i, line in enumerate(lines) if line.startswith("FT "))
    alt_positions = [(m.start(), int(m.group())) for m in re.finditer(r"\d+", lines[header_idx])]

    stations = {}
    for line in lines[header_idx + 1 :]:
        if not line.strip():
            continue
        station_id, groups = _parse_fd_station_row(line, alt_positions)
        if not station_id:
            continue
        temps = {alt: t for alt, g in groups.items() if (t := _decode_temp_c(g)) is not None}
        if temps:
            stations[station_id] = temps
    return stations


def _nearest_station(lat: float, lon: float, station_ids, airports_df) -> str | None:
    from .geo import distance_nm

    # local_code isn't globally unique (e.g. "MSP" also matches airports
    # in Argentina and Colombia by coincidence) -- FD stations are US-only,
    # so restrict the match accordingly.
    candidates = airports_df[airports_df["local_code"].isin(station_ids) & (airports_df["iso_country"] == "US")]
    if candidates.empty:
        return None
    dists = candidates.apply(lambda r: distance_nm(lat, lon, r["latitude_deg"], r["longitude_deg"]), axis=1)
    return candidates.loc[dists.idxmin(), "local_code"]


def freezing_level_ft(lat: float, lon: float, fcst_hr: str = "06") -> float | None:
    """Altitude (ft) where the nearest station's forecast temperature
    profile crosses 0degC, by linear interpolation between the two
    bracketing reported altitudes. Returns None if the whole reported
    profile stays above freezing (no icing concern in range) -- callers
    should treat None as "no altitude constraint from icing," not
    "unknown."  If the profile is already below freezing at the lowest
    reported altitude, returns that altitude as a conservative estimate.
    """
    from . import airports

    stations = parse_fd_text(_fetch_fd_text(fcst_hr))
    airports_df = airports.load_airports()
    station_id = _nearest_station(lat, lon, set(stations.keys()), airports_df)
    if station_id is None:
        return None

    profile = sorted(stations[station_id].items())
    if profile[0][1] <= 0:
        return profile[0][0]

    for (alt1, t1), (alt2, t2) in zip(profile, profile[1:]):
        if t1 > 0 and t2 <= 0:
            frac = t1 / (t1 - t2)
            return alt1 + frac * (alt2 - alt1)
    return None


# --- Ceiling/visibility, from the TAF JSON API ---


def _current_forecast_period(fcsts: list, now_unix: float) -> dict | None:
    for period in fcsts:
        if period["timeFrom"] <= now_unix < period["timeTo"]:
            return period
    return fcsts[0] if fcsts else None


def _ceiling_ft(period: dict) -> float | None:
    """Lowest BKN/OVC cloud base -- FEW/SCT don't count as a ceiling by
    the FAA's own definition (broken or overcast only).
    """
    bases = [c["base"] for c in period.get("clouds", []) if c.get("cover") in ("BKN", "OVC") and c.get("base") is not None]
    return min(bases) if bases else None


def _visibility_sm(period: dict) -> float | None:
    visib = period.get("visib")
    if visib is None:
        return None
    try:
        return float(str(visib).rstrip("+"))
    except ValueError:
        return None


def ceiling_visibility_along_route(route_start: tuple, route_end: tuple, corridor_buffer_nm: float = 10.0) -> dict:
    """Lowest forecast ceiling/visibility among TAF stations near the
    route, for each station's current forecast period. TAFs are only
    issued for towered/larger airports, so this searches a wider
    corridor (corridor_buffer_nm) than the tight pilotage corridor used
    elsewhere in this project -- a small departure/destination field
    often has no TAF of its own at all.

    Returns {"min_ceiling_ft", "min_visibility_sm", "stations"} -- the
    first two are the worst (most restrictive) values found nearby, for
    a conservative go/no-go read; "stations" is the per-station detail.
    This is about *whether* conditions support VFR flight at all, not
    *what altitude* to fly at -- kept separate from the altitude-band
    constraints (terrain/airspace/aircraft/freezing-level) for that reason.
    """
    import time

    from .geo import corridor_bbox

    min_lat, min_lon, max_lat, max_lon = corridor_bbox(route_start, route_end, corridor_buffer_nm)
    resp = requests.get(
        TAF_URL,
        params={"bbox": f"{min_lat},{min_lon},{max_lat},{max_lon}", "format": "json"},
        headers=HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    stations = resp.json()

    now = time.time()
    per_station, ceilings, visibilities = [], [], []
    for station in stations:
        period = _current_forecast_period(station.get("fcsts", []), now)
        if period is None:
            continue
        ceiling = _ceiling_ft(period)
        visibility = _visibility_sm(period)
        per_station.append({"icaoId": station["icaoId"], "ceiling_ft": ceiling, "visibility_sm": visibility})
        if ceiling is not None:
            ceilings.append(ceiling)
        if visibility is not None:
            visibilities.append(visibility)

    return {
        "min_ceiling_ft": min(ceilings) if ceilings else None,
        "min_visibility_sm": min(visibilities) if visibilities else None,
        "stations": per_station,
    }


# --- SIGMET/AIRMET hazards, from the airsigmet JSON API ---


def hazards_along_route(route_start: tuple, route_end: tuple, corridor_buffer_nm: float = 25.0) -> list:
    """SIGMETs/AIRMETs whose hazard polygon the route line actually
    crosses. corridor_buffer_nm is wider still than the TAF search --
    these are large-area advisories (convective SIGMETs commonly span
    multiple states), so the bbox is just a coarse server-side prefilter,
    and the real filter is the route/polygon intersection below.
    """
    from shapely.geometry import LineString, Polygon

    from .geo import corridor_bbox

    min_lat, min_lon, max_lat, max_lon = corridor_bbox(route_start, route_end, corridor_buffer_nm)
    resp = requests.get(
        AIRSIGMET_URL,
        params={"bbox": f"{min_lat},{min_lon},{max_lat},{max_lon}", "format": "json"},
        headers=HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    advisories = resp.json()

    route_line = LineString([(route_start[1], route_start[0]), (route_end[1], route_end[0])])
    hits = []
    for advisory in advisories:
        coords = advisory.get("coords")
        if not coords or len(coords) < 3:
            continue
        polygon = Polygon([(c["lon"], c["lat"]) for c in coords])
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if route_line.intersects(polygon):
            hits.append(
                {
                    "hazard": advisory.get("hazard"),
                    "type": advisory.get("airSigmetType"),
                    "altitude_low_ft": advisory.get("altitudeLow1"),
                    "altitude_high_ft": advisory.get("altitudeHi1"),
                    "raw": advisory.get("rawAirSigmet"),
                }
            )
    return hits
