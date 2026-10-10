"""What lies ahead of the airplane in the air, from its own position: the
Class B, C and D airspace, special-use areas and TFRs its track goes into
in the next few minutes, and the ground or an obstacle it comes too near
in the next minute -- the alerts an EFB gives over own ship.

The track is projected straight on from the GPS's position, track and
ground speed, and its altitude on at the vertical speed the phone has
seen; what the projection meets is said with how long until it does.
Advisory only, from a phone's GPS and the FAA's published data: it is not
a terrain awareness and warning system (TSO-C151) or a substitute for
the chart, the pilot's own planning (91.103) or looking outside.
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np
import requests
import shapely
from shapely.geometry import shape

from . import airports, airspace, elevation, faa_data, geo, sua, terrain, tfr

#: How far ahead the airspace is looked at: the minutes it takes to find
#: the frequency, call and be answered before a Class C or D, or to be
#: cleared into a Class B or turn away. A design choice, not a rule.
LOOK_AHEAD_S = 5 * 60
#: How often along the look-ahead the track is tested, in seconds: about
#: 0.2 nm at 120 kt, finer than any Class D surface area.
AIRSPACE_STEP_S = 5
#: Within this much of a volume's floor or ceiling counts as going in: a
#: phone's GPS altitude is good to some tens of feet, and an airplane
#: drifts. The figure Garmin's own airspace alerts default to; a design
#: choice, not a rule.
ALTITUDE_BUFFER_FT = 200.0

#: The ground and obstacles are looked at a minute ahead, a warning given
#: at half a minute: the caution and the warning of an EGPWS's forward
#: look, about 60 and 30 seconds before the ground (NBAA's summary of
#: TAWS and GPWS).
TERRAIN_LOOK_AHEAD_S = 60
TERRAIN_WARNING_S = 30
TERRAIN_STEP_S = 2
#: 14 CFR 91.119(c): 500 ft above the surface away from congested areas,
#: and no closer than 500 ft to any structure. That is a rule about how
#: close one may operate, not a TAWS alert threshold (TSO-C151's required
#: terrain clearance differs, and is not read here); 500 ft is a design
#: choice borrowed from it, so that the alert comes before the rule is
#: broken.
TERRAIN_CLEARANCE_FT = 500.0
#: A warning: the ground or an obstacle's top within this of the
#: projected altitude, which the terrain tiles' 38 m cells and a phone's
#: altitude cannot tell from the ground itself. A design choice.
WARNING_CLEARANCE_FT = 100.0
#: Either side of the track the ground and obstacles are looked at, for
#: a track that wanders a few degrees: 0.25 nm is some 1,500 ft, and 0.15
#: nm more for the web app's position, asked rounded to 0.005 degree
#: (up to 0.15 nm off), so a structure at the swath's edge is not missed.
SWATH_NM = 0.4
#: 91.119's minimums hold "except when necessary for takeoff or landing":
#: within this of a field, and no higher than NEAR_FIELD_AGL_FT over it,
#: the ground is not alerted (obstacles still are). The exception is for
#: the airplane's own takeoff or landing, not for passing a field: a
#: ridge ahead of an airplane well above the field is still alerted.
#: A 3-degree approach is about 950 ft above the field at 3 nm.
NEAR_FIELD_NM = 3.0
NEAR_FIELD_AGL_FT = 1000.0
#: Slower than this the airplane is on the ground (lib/map/glide's
#: AIRBORNE_KT): nothing is alerted.
AIRBORNE_KT = 40.0

_FT_PER_M = 3.28084
_NM_PER_DEG_LAT = 60.0

#: What each class takes to enter, VFR.
_CLASS_NEEDS = {
    "B": ("warning", "An ATC clearance before entering (91.131(a)(1))."),
    "C": ("caution", "Two-way radio contact with ATC before entering (91.130(c)(1))."),
    "D": ("caution", "Two-way radio contact with the tower before entering (91.129(c)(1))."),
}

#: What each kind of special-use area asks.
_SPECIAL_USE_NEEDS = {
    "P": ("warning", "No flight without the using agency's permission (91.133(a))."),
    "R": ("caution", "No flight into it while in use without the controlling agency's permission (91.133(a)); "
                     "ask ATC or Flight Service whether it is (AIM 3-4-3)."),
    "MOA": ("caution", "Military training may be under way: ask ATC or Flight Service whether it is active "
                       "(AIM 3-4-5)."),
    "W": ("caution", "Hazardous military activity may be under way (AIM 3-4-4)."),
    "A": ("caution", "Heavy pilot training or unusual flying: keep a lookout (AIM 3-4-6)."),
}


class _Track:
    """The projected track: positions and altitudes at `times` seconds."""

    def __init__(self, lat: float, lon: float, track_deg: float, gs_kt: float,
                 alt_ft: float | None, vs_fpm: float, seconds: float, step: float):
        self.times = np.arange(0.0, seconds + step / 2, step)
        self.along_nm = gs_kt * self.times / 3600.0
        n = len(self.times)
        lats, lons = geo.destination_point(np.full(n, lat), np.full(n, lon), np.full(n, track_deg), self.along_nm)
        self.lats, self.lons = np.asarray(lats, dtype=float), np.asarray(lons, dtype=float)
        self.alts = None if alt_ft is None else alt_ft + vs_fpm * self.times / 60.0
        self.track_deg = track_deg
        self.gs_kt = gs_kt

    def bbox(self, pad_nm: float) -> tuple:
        """(min_lat, min_lon, max_lat, max_lon) round the track."""
        pad_lat = pad_nm / _NM_PER_DEG_LAT
        pad_lon = pad_lat / max(0.2, math.cos(math.radians(float(self.lats.mean()))))
        return (float(self.lats.min()) - pad_lat, float(self.lons.min()) - pad_lon,
                float(self.lats.max()) + pad_lat, float(self.lons.max()) + pad_lon)


def _entry(track: _Track, geometry, floor_ft: float, ceiling_ft: float) -> tuple[bool, int | None]:
    """(inside now, the first sample in it or within the buffer of it):
    laterally in the shape and, where the altitude is known, between its
    floor and ceiling."""
    lateral = shapely.contains_xy(geometry, track.lons, track.lats)
    if track.alts is None:
        inside, near = bool(lateral[0]), lateral
    else:
        inside = bool(lateral[0] and floor_ft <= track.alts[0] <= ceiling_ft)
        near = lateral & (track.alts >= floor_ft - ALTITUDE_BUFFER_FT) & (track.alts <= ceiling_ft + ALTITUDE_BUFFER_FT)
    hits = np.flatnonzero(near)
    return inside, (int(hits[0]) if hits.size else None)


def _alert(track: _Track, index: int, **fields) -> dict:
    return {
        "seconds": float(track.times[index]),
        "distance_nm": round(float(track.along_nm[index]), 1),
        "lat": round(float(track.lats[index]), 5),
        "lon": round(float(track.lons[index]), 5),
        "inside": False, "floor_ft": None, "ceiling_ft": None, "top_ft": None, "class": None,
        **fields,
    }


def _classes(track: _Track, shp_path) -> list[dict]:
    """The Class B, C and D the track goes into, one per named volume at
    its first shelf entered. Not once inside: a pilot in a Class D has
    talked to its tower, and one under a Class B shelf is below it."""
    found: dict = {}
    inside_of: set = set()
    for volume in airspace.load_controlled_airspace(shp_path, track.bbox(1.0)):
        klass = volume["class"]
        if klass not in _CLASS_NEEDS:
            continue
        # No ceiling given: up to Class A (71.33), as vfr.airspace_at reads it.
        ceiling = volume["ceiling_ft_msl"] if volume["ceiling_ft_msl"] is not None else 18000.0
        inside, index = _entry(track, volume["geometry"], volume["floor_ft_msl"], ceiling)
        key = (volume["name"], klass)
        if inside:
            inside_of.add(key)
            continue
        held = found.get(key)
        if index is None or (held is not None and held["seconds"] <= track.times[index]):
            continue
        level, need = _CLASS_NEEDS[klass]
        found[key] = _alert(
            track, index, id=f"airspace:{klass}:{volume['name']}", kind="airspace", level=level,
            name=volume["name"], need=need, floor_ft=volume["floor_ft_msl"], ceiling_ft=volume["ceiling_ft_msl"],
            **{"class": klass},
        )
    return [alert for key, alert in found.items() if key not in inside_of]


def _height_msl(value: float | None, ref: str | None, ground_ft: float | None, missing: float) -> float:
    """A floor or ceiling in feet MSL: an AGL one over `ground_ft`, the
    ground under the area; `missing` where there is none. Where the
    ground is not known an AGL height is taken the cautious way: a floor
    as low as it can be (the value as MSL), a ceiling as high (`missing`,
    which for a ceiling is no limit)."""
    if value is None:
        return missing
    if ref == "AGL":
        if ground_ft is not None:
            return value + ground_ft
        return value if missing <= 0 else missing
    return value


def _ground_under(geometry, fallback_ft: float | None) -> float | None:
    """The ground at a point within an area, for its AGL heights: the
    airplane's own ground is miles from a ridge or valley the area may
    lie over. One point per area; `fallback_ft` where it cannot be read."""
    point = geometry.representative_point()
    found = _ground_ft(point.y, point.x)
    return fallback_ft if found is None else found


def _special_use(track: _Track, ground_ft: float | None) -> list[dict]:
    """The special-use areas the track goes into, or is in: one per name."""
    found: dict = {}
    for area, geometry in sua.areas_in(track.bbox(1.0)):
        if area["type"] not in _SPECIAL_USE_NEEDS:
            continue
        under = (_ground_under(geometry, ground_ft) if "AGL" in (area["floor_ref"], area["ceiling_ref"])
                 else ground_ft)
        floor = _height_msl(area["floor_ft"], area["floor_ref"], under, 0.0)
        ceiling = _height_msl(area["ceiling_ft"], area["ceiling_ref"], under, math.inf)
        inside, index = _entry(track, geometry, floor, ceiling)
        if index is None:
            continue
        held = found.get(area["name"])
        if held is not None and held["seconds"] <= track.times[index]:
            continue
        level, need = _SPECIAL_USE_NEEDS[area["type"]]
        found[area["name"]] = _alert(
            track, index, id=f"special_use:{area['name']}", kind="special_use", level=level,
            name=area["name"], need=need, inside=inside and index == 0,
            floor_ft=area["floor_ft"] if area["floor_ref"] != "AGL" else floor,
            ceiling_ft=area["ceiling_ft"] if area["ceiling_ref"] != "AGL" else ceiling,
            times_of_use=area["times_of_use"], **{"class": area["type"]},
        )
    return list(found.values())


def _tfrs(track: _Track, ground_ft: float | None, now: datetime) -> list[dict]:
    """The TFRs in force over the look-ahead that the track goes into, or
    is in: entry only as the NOTAM allows (91.137 to 91.145, 99.7)."""
    until = now + timedelta(seconds=float(track.times[-1]))
    found = []
    for restriction in tfr.all_tfrs():
        if not tfr.in_force(restriction, now, until):
            continue
        try:
            geometry = shape(restriction["geometry"])
        except (KeyError, TypeError, ValueError):
            continue
        refs = (restriction.get("floor_ref"), restriction.get("ceiling_ref"))
        under = _ground_under(geometry, ground_ft) if "AGL" in refs else ground_ft
        floor = _height_msl(restriction.get("floor_ft"), restriction.get("floor_ref"), under, 0.0)
        ceiling = _height_msl(restriction.get("ceiling_ft"), restriction.get("ceiling_ref"), under, math.inf)
        inside, index = _entry(track, geometry, floor, ceiling)
        if index is None:
            continue
        rule = restriction.get("rule")
        found.append(_alert(
            track, index, id=f"tfr:{restriction['notam_id']}", kind="tfr", level="warning",
            name=restriction.get("title") or f"TFR {restriction['notam_id']}",
            need=f"In force: no flight in it but as NOTAM {restriction['notam_id']} allows"
                 + (f" ({rule})." if rule else "."),
            inside=inside and index == 0, floor_ft=floor if restriction.get("floor_ft") is not None else None,
            ceiling_ft=ceiling if math.isfinite(ceiling) else None, notam_id=restriction["notam_id"],
        ))
    return found


def _swath(track: _Track) -> tuple[np.ndarray, np.ndarray]:
    """The terrain look-ahead's points: the track and a line either side
    of it, (lats, lons), three rows of the track's length."""
    rows_lat, rows_lon = [track.lats], [track.lons]
    n = len(track.lats)
    for side in (-90.0, 90.0):
        lats, lons = geo.destination_point(track.lats, track.lons, np.full(n, track.track_deg + side), np.full(n, SWATH_NM))
        rows_lat.append(np.asarray(lats, dtype=float))
        rows_lon.append(np.asarray(lons, dtype=float))
    return np.vstack(rows_lat), np.vstack(rows_lon)


def _clearance_level(seconds: float, clearance_ft: float) -> str | None:
    if seconds <= TERRAIN_WARNING_S and clearance_ft < WARNING_CLEARANCE_FT:
        return "warning"
    if clearance_ft < TERRAIN_CLEARANCE_FT:
        return "caution"
    return None


_TERRAIN_NEEDS = {
    "warning": "At or near the airplane's altitude: climb or turn now.",
    "caution": "Within 500 ft of the airplane's altitude: climb or turn (91.119(c)).",
}


def _terrain(track: _Track) -> list[dict]:
    """The ground the next minute's track comes within 500 ft of, at the
    least clearance: one alert, where it is least. Raises what the
    terrain tiles raise where they cannot be read."""
    lats, lons = _swath(track)
    ground = np.vectorize(elevation.ground_m)(lats, lons) * _FT_PER_M
    highest = ground.max(axis=0)
    clearance = track.alts - highest
    # The worst of them: a warning before a caution, then the least
    # clearance.
    found = [(level, i) for i in range(len(track.times))
             if (level := _clearance_level(float(track.times[i]), float(clearance[i]))) is not None]
    if not found:
        return []
    level, i = min(found, key=lambda f: (f[0] != "warning", clearance[f[1]]))
    row = int(ground[:, i].argmax())
    return [{
        **_alert(track, i, id="terrain", kind="terrain", level=level, name="Terrain", need=_TERRAIN_NEEDS[level],
                 top_ft=round(float(highest[i]), -1), clearance_ft=round(float(clearance[i]), -1)),
        "lat": round(float(lats[row, i]), 5), "lon": round(float(lons[row, i]), 5),
    }]


def _obstacles(track: _Track, faa_cache_dir) -> list[dict]:
    """The registered obstacles (the FAA's Digital Obstacle File) within
    the swath of the next minute's track whose tops come within 500 ft of
    its altitude: the nearest few, by when the airplane reaches them."""
    end = (float(track.lats[-1]), float(track.lons[-1]))
    start = (float(track.lats[0]), float(track.lons[0]))
    found = faa_data.load_obstacles(
        faa_data.ensure_nasr_file("DOF.DAT", faa_cache_dir), track.bbox(SWATH_NM + 0.5), min_agl_ft=0,
    )
    if not len(found) or track.along_nm[-1] <= 0:
        return []
    cross, along = geo.track_distances_nm(
        found["lat"].to_numpy(dtype=float), found["lon"].to_numpy(dtype=float), start, end,
    )
    alerts = []
    for j in np.flatnonzero((np.abs(cross) <= SWATH_NM) & (along >= 0) & (along <= track.along_nm[-1])):
        seconds = float(along[j]) / track.gs_kt * 3600.0
        alt_then = float(np.interp(seconds, track.times, track.alts))
        top = float(found["amsl_ft"].iloc[j])
        level = _clearance_level(seconds, alt_then - top)
        if level is None:
            continue
        kind = (found["type"].iloc[j] or "obstacle").strip()
        alerts.append({
            "id": f"obstacle:{found['lat'].iloc[j]:.4f},{found['lon'].iloc[j]:.4f}", "kind": "obstacle",
            "level": level, "name": kind, "need": _TERRAIN_NEEDS[level], "inside": False,
            "seconds": round(seconds, 1), "distance_nm": round(float(along[j]), 1),
            "lat": round(float(found["lat"].iloc[j]), 5), "lon": round(float(found["lon"].iloc[j]), 5),
            "floor_ft": None, "ceiling_ft": None, "class": None,
            "top_ft": top, "clearance_ft": round(alt_then - top, -1),
        })
    return sorted(alerts, key=lambda a: a["seconds"])[:3]


def _near_field(lat: float, lon: float, alt_ft: float) -> bool:
    """Whether the airplane is within NEAR_FIELD_NM of a landing field
    and low enough over it (NEAR_FIELD_AGL_FT) to be taking off or
    landing there. A field with no elevation on file counts as low."""
    try:
        nearest = airports.nearest(lat, lon, limit=1)
    except (OSError, ValueError):
        return False
    if not nearest or nearest[0]["distance_nm"] > NEAR_FIELD_NM:
        return False
    field_ft = nearest[0].get("elevation_ft")
    return field_ft is None or alt_ft <= field_ft + NEAR_FIELD_AGL_FT


def _ground_ft(lat: float, lon: float) -> float | None:
    try:
        return elevation.ground_m(lat, lon) * _FT_PER_M
    except (requests.RequestException, OSError, ValueError):
        return None


def ahead(lat: float, lon: float, track_deg: float, gs_kt: float, alt_ft: float | None = None,
          vs_fpm: float = 0.0, shp_path=None, faa_cache_dir=None, now: datetime | None = None) -> dict:
    """The alerts ahead of an airplane at (lat, lon) on `track_deg` true
    at `gs_kt`, at `alt_ft` MSL (the GPS's; None where it gives none, and
    then the airspace is looked at laterally alone and the ground not at
    all), climbing or descending at `vs_fpm`: {"alerts": [...], the
    soonest first and warnings before cautions, "unavailable": [what
    could not be read]}. Nothing on the ground (under AIRBORNE_KT)."""
    if gs_kt < AIRBORNE_KT:
        return {"alerts": [], "unavailable": []}
    now = now or datetime.now(timezone.utc)
    shp_path = shp_path or airspace.ensure_class_airspace_shapefile(faa_cache_dir or terrain.DEFAULT_FAA_CACHE_DIR)
    track = _Track(lat, lon, track_deg, gs_kt, alt_ft, vs_fpm, LOOK_AHEAD_S, AIRSPACE_STEP_S)
    near = _Track(lat, lon, track_deg, gs_kt, alt_ft, vs_fpm, TERRAIN_LOOK_AHEAD_S, TERRAIN_STEP_S)
    alerts, unavailable = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        ground = pool.submit(_ground_ft, lat, lon)
        tfrs_future = pool.submit(lambda: _tfrs(track, ground.result(), now))
        sua_future = pool.submit(lambda: _special_use(track, ground.result()))
        alerts += _classes(track, shp_path)
        try:
            alerts += sua_future.result()
        except sua.SpecialUseUnavailable:
            unavailable.append("special-use airspace")
        try:
            alerts += tfrs_future.result()
        except tfr.TfrUnavailable:
            unavailable.append("TFRs")
    if alt_ft is not None:
        if not _near_field(lat, lon, alt_ft):
            try:
                alerts += _terrain(near)
            except (requests.RequestException, OSError, ValueError):
                unavailable.append("terrain")
        try:
            alerts += _obstacles(near, faa_cache_dir or terrain.DEFAULT_FAA_CACHE_DIR)
        except (requests.RequestException, OSError, ValueError):
            unavailable.append("obstacles")
    else:
        # Said rather than left to read as a clear sky.
        unavailable.append("terrain and obstacles, with no GPS altitude")
    alerts.sort(key=lambda a: (a["level"] != "warning", a["seconds"]))
    return {"alerts": alerts, "unavailable": unavailable}
