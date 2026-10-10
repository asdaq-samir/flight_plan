"""What airspace is over a point the pilot holds a finger on (the map's
Airspace card): the classes from the ground up, the Mode C veil, the
special-use areas and the TFRs there; and what is ahead of own ship in
the air (the map's alerts)."""
import logging
from concurrent.futures import ThreadPoolExecutor

import requests
from fastapi import APIRouter, Query
from vfr import airports, airspace, airspace_at, alerts, altitude, classb, elevation, sua, tfr

from ..schemas import AirspaceAt, AlertsAhead

log = logging.getLogger(__name__)

router = APIRouter()

#: Feet in a metre, for the ground's height.
_FT_PER_M = 3.28084


def _ground_ft(lat: float, lon: float) -> float | None:
    """The ground's height at the point, to the nearest ten feet: from
    the terrain tiles, else the nearest field's elevation, else None."""
    try:
        return round(elevation.ground_m(lat, lon) * _FT_PER_M, -1)
    except (requests.RequestException, OSError, ValueError) as err:
        log.warning("terrain tile for (%s, %s) not read: %s", lat, lon, err)
    try:
        nearest = airports.nearest(lat, lon, limit=1)
    except (OSError, ValueError):
        return None
    return float(nearest[0]["elevation_ft"]) if nearest and nearest[0].get("elevation_ft") is not None else None


@router.get("/api/airspace/at", response_model=AirspaceAt, response_model_by_alias=True)
def airspace_at_point(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
) -> AirspaceAt:
    """The airspace over a point, from the ground to FL600, in bands
    (vfr.airspace_at): each class's floor and ceiling in feet MSL, its
    VFR weather minimums by day and by night (91.155), what it takes to
    enter and what the aeroplane must carry -- with the Class B Mode C
    veil the point is in, and the special-use areas and TFRs over it.
    The ground, the shapefile and the two feeds are read at once."""
    shp_path = airspace.ensure_class_airspace_shapefile(altitude.DEFAULT_FAA_CACHE_DIR)
    with ThreadPoolExecutor(max_workers=4) as pool:
        volumes = pool.submit(airspace_at.volumes_at, lat, lon, shp_path)
        ground = pool.submit(_ground_ft, lat, lon)
        areas = pool.submit(sua.at_point, lat, lon)
        restrictions = pool.submit(tfr.at_point, lat, lon)
        ground_ft = ground.result()
        veil = airspace_at.mode_c_veil(lat, lon, classb.class_b_airports(shp_path))
        bands = airspace_at.column(lat, lon, ground_ft or 0.0, volumes.result(), in_veil=veil is not None)
        try:
            special_use, special_use_unavailable = areas.result(), False
        except sua.SpecialUseUnavailable as err:
            log.warning("special-use airspace at (%s, %s): %s", lat, lon, err)
            special_use, special_use_unavailable = [], True
        try:
            tfrs, tfrs_unavailable = restrictions.result(), False
        except tfr.TfrUnavailable as err:
            log.warning("TFRs at (%s, %s): %s", lat, lon, err)
            tfrs, tfrs_unavailable = [], True
    return AirspaceAt(
        lat=lat, lon=lon, ground_ft=ground_ft, bands=bands, mode_c_veil=veil,
        special_use=special_use, special_use_unavailable=special_use_unavailable,
        tfrs=tfrs, tfrs_unavailable=tfrs_unavailable,
    )


@router.get("/api/airspace/ahead", response_model=AlertsAhead, response_model_by_alias=True)
def airspace_ahead(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
    track: float = Query(ge=0, le=360, description="True track over the ground, degrees"),
    gs: float = Query(ge=0, le=1000, description="Ground speed, knots"),
    alt: float | None = Query(default=None, ge=-2000, le=60000, description="GPS altitude, feet MSL"),
    vs: float = Query(default=0.0, ge=-10000, le=10000, description="Vertical speed, feet a minute"),
) -> AlertsAhead:
    """What is ahead of own ship in the air (vfr.alerts): the Class B, C
    and D, special-use areas and TFRs its track goes into in the next five
    minutes, and the ground or an obstacle it comes within 500 ft of in
    the next minute. Nothing under 40 kt, on the ground. Advisory, from
    the phone's GPS: not a TAWS."""
    found = alerts.ahead(
        lat, lon, track % 360, gs, alt, vs,
        shp_path=airspace.ensure_class_airspace_shapefile(altitude.DEFAULT_FAA_CACHE_DIR),
        faa_cache_dir=altitude.DEFAULT_FAA_CACHE_DIR,
    )
    return AlertsAhead(**found)
