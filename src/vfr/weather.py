"""Live weather for VFR altitude selection and dead-reckoning nav-log math:
winds/temps aloft (freezing level for icing avoidance, and wind_at_altitude
for wind-correction-angle math), forecast ceiling/visibility along the
route, and SIGMET/AIRMET hazard advisories -- all from aviationweather.gov's
public JSON/text APIs.

Unlike the FAA NASR/DOF data in vfr.faa_data, none of this is cached to
disk: it's live/current-conditions data (a forecast issued hours ago is
stale, not "the current cycle"), so every call re-fetches.
"""
import re

import time

import requests

HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
WINDTEMP_URL = "https://aviationweather.gov/api/data/windtemp"
TAF_URL = "https://aviationweather.gov/api/data/taf"
AIRSIGMET_URL = "https://aviationweather.gov/api/data/airsigmet"
METAR_URL = "https://aviationweather.gov/api/data/metar"


class WeatherServiceError(RuntimeError):
    """aviationweather.gov didn't respond, timed out, or returned an
    error status. Every function in this module that calls it raises
    this instead of letting requests' own exception (ConnectionError,
    Timeout, HTTPError -- a wide, transport-specific family) propagate
    raw, so callers (planning-service's route handlers, nav-log-agent)
    have one exception type to catch regardless of which call failed or
    why.
    """


def _get(url: str, params: dict) -> requests.Response:
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise WeatherServiceError(f"aviationweather.gov request to {url} failed: {e}") from e
    return resp


# --- Freezing level, from the winds/temps-aloft ("FD") text product ---


# The FD product is a forecast issued a few times a day, so refetching it
# per nav-log leg was 22 identical HTTP round trips for one route -- most
# of the 1.2 seconds each leg cost. Held briefly rather than forever, so a
# long-running server still picks up a new issue.
_FD_CACHE: dict = {}
_FD_TTL_S = 900


def _fetch_fd_text(fcst_hr: str = "06") -> str:
    cached = _FD_CACHE.get(fcst_hr)
    if cached and time.time() - cached[0] < _FD_TTL_S:
        return cached[1]
    text = _fetch_fd_text_uncached(fcst_hr)
    _FD_CACHE[fcst_hr] = (time.time(), text)
    return text


def _fetch_fd_text_uncached(fcst_hr: str = "06") -> str:
    resp = _get(WINDTEMP_URL, params={"region": "us", "level": "low", "fcst": fcst_hr})
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


def _decode_wind(group: str) -> tuple[float | None, float | None] | None:
    """(wind_dir_true_deg, wind_speed_kt) from a group's first 4 chars
    (DDFF -- direction in tens of degrees true, speed in knots); None if
    the group's too short to contain a wind code at all. "9900" is the
    product's own light-and-variable convention -- direction isn't
    meaningful, so it's returned as None rather than guessed, with speed
    treated as calm (0kt). Wind >=100kt is encoded by adding 50 to the
    direction code and subtracting 100 from the speed code -- both undone
    here (e.g. "7520" -> 250 deg / 120kt).
    """
    if len(group) < 4 or not group[:4].isdigit():
        return None
    wind_part = group[:4]
    if wind_part == "9900":
        return None, 0.0
    dir_code, speed_code = int(wind_part[:2]), int(wind_part[2:4])
    if dir_code >= 51:
        return float((dir_code - 50) * 10), float(speed_code + 100)
    return float(dir_code * 10), float(speed_code)


def parse_fd_text(text: str) -> dict:
    """{station_id: {altitude_ft: {"wind_dir_true_deg", "wind_speed_kt", "temp_c"}}}
    for every station/altitude group in the FD text with a decodable wind
    (temp_c is None for wind-only groups, e.g. the 3000ft column near a
    station's own elevation).
    """
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
        decoded = {}
        for alt, g in groups.items():
            wind = _decode_wind(g)
            if wind is None:
                continue
            wind_dir, wind_speed = wind
            decoded[alt] = {"wind_dir_true_deg": wind_dir, "wind_speed_kt": wind_speed, "temp_c": _decode_temp_c(g)}
        if decoded:
            stations[station_id] = decoded
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

    profile = sorted((alt, v["temp_c"]) for alt, v in stations[station_id].items() if v["temp_c"] is not None)
    if not profile:
        return None
    if profile[0][1] <= 0:
        return profile[0][0]

    for (alt1, t1), (alt2, t2) in zip(profile, profile[1:]):
        if t1 > 0 and t2 <= 0:
            frac = t1 / (t1 - t2)
            return alt1 + frac * (alt2 - alt1)
    return None


def _interp_circular_deg(d1: float, d2: float, frac: float) -> float:
    """Interpolate a compass direction between d1 and d2 the short way
    around the circle (e.g. 350deg -> 010deg goes through 000, not back
    through 180) -- a plain linear interpolation would get that wrong.
    """
    diff = ((d2 - d1 + 180) % 360) - 180
    return (d1 + frac * diff) % 360


def wind_at_altitude(lat: float, lon: float, altitude_ft: float, fcst_hr: str = "06") -> dict | None:
    """Wind (true direction/speed) at altitude_ft, from the nearest FD
    station's reported profile -- linearly interpolated between the two
    bracketing reported altitudes, or clamped to the nearest end if
    altitude_ft falls outside the reported range. "Light and variable"
    (direction not meaningful) reports are excluded from the profile
    rather than guessed; if that leaves no usable profile, or no station
    is found nearby, returns None -- callers should treat that as "no
    wind data available," not "calm."
    """
    from . import airports

    stations = parse_fd_text(_fetch_fd_text(fcst_hr))
    airports_df = airports.load_airports()
    station_id = _nearest_station(lat, lon, set(stations.keys()), airports_df)
    if station_id is None:
        return None

    profile = sorted(
        (alt, v["wind_dir_true_deg"], v["wind_speed_kt"])
        for alt, v in stations[station_id].items()
        if v["wind_dir_true_deg"] is not None
    )
    if not profile:
        return None

    if altitude_ft <= profile[0][0]:
        _, d, s = profile[0]
        return {"wind_dir_true_deg": d, "wind_speed_kt": s}
    if altitude_ft >= profile[-1][0]:
        _, d, s = profile[-1]
        return {"wind_dir_true_deg": d, "wind_speed_kt": s}

    for (alt1, d1, s1), (alt2, d2, s2) in zip(profile, profile[1:]):
        if alt1 <= altitude_ft <= alt2:
            frac = (altitude_ft - alt1) / (alt2 - alt1) if alt2 != alt1 else 0.0
            return {
                "wind_dir_true_deg": _interp_circular_deg(d1, d2, frac),
                "wind_speed_kt": s1 + frac * (s2 - s1),
            }
    return None


# --- METAR, from the metar JSON API ---


def metar_for_idents(idents: list) -> dict:
    """{ident: {...}} for the latest METAR at each ident, or {ident: None}
    for one aviationweather.gov has nothing current for (a small field
    with no reporting station). One request for the whole list -- the
    API accepts a comma-joined ids param -- not one per airport.

    `_ceiling_ft`/`_visibility_sm` (below, written for the TAF response)
    are reused as-is: a METAR object's own `clouds`/`visib` fields are
    the same shape as one TAF forecast period's, so there's no separate
    METAR-specific parsing to write.
    """
    resp = _get(METAR_URL, params={"ids": ",".join(idents), "format": "json"})
    by_ident = {m["icaoId"]: m for m in resp.json() if m.get("icaoId")}

    result = {}
    for ident in idents:
        m = by_ident.get(ident)
        if m is None:
            result[ident] = None
            continue
        result[ident] = {
            "raw": m.get("rawOb"),
            "flight_category": m.get("fltCat"),
            "ceiling_ft": _ceiling_ft(m),
            "visibility_sm": _visibility_sm(m),
            "wind_dir_true_deg": m.get("wdir") if isinstance(m.get("wdir"), (int, float)) else None,
            "wind_speed_kt": m.get("wspd"),
            "temp_c": m.get("temp"),
            "dewpoint_c": m.get("dewp"),
        }
    return result


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
    resp = _get(TAF_URL, params={"bbox": f"{min_lat},{min_lon},{max_lat},{max_lon}", "format": "json"})
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
    resp = _get(AIRSIGMET_URL, params={"bbox": f"{min_lat},{min_lon},{max_lat},{max_lon}", "format": "json"})
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
