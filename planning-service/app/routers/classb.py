"""The Class B airports, with what the weather is doing at each and
which terminal chart covers it.

One call rather than thirty. The map draws a marker per Class B and a
pilot hovers one to see whether they could get in today, so the
alternative would be a request per airport on hover -- thirty round
trips for a map that has not moved. Everything here is already in
memory on this side: the airspace shapefile is parsed once at startup,
and the METAR and TAF national caches are held by vfr.weather for
minutes at a time. Assembling all thirty costs about as much as
assembling one.
"""
import logging
import time

from fastapi import APIRouter
from vfr import airspace, altitude, charts, classb, weather

from ..schemas import ClassBAirport, ClassBResponse

log = logging.getLogger(__name__)

router = APIRouter()


def _tac_sheet(lat: float, lon: float) -> str | None:
    """The terminal area chart covering a point, by the label the map
    shows. A Class B almost always has one -- that is what a TAC is for
    -- but not always, so this may be None."""
    for name, (west, south, east, north) in charts.sheets(charts.TAC):
        if south <= lat <= north and west <= lon <= east:
            return charts.sheet_label(charts.TAC, name)
    return None


@router.get("/api/class-b", response_model=ClassBResponse)
def class_b_airports() -> ClassBResponse:
    """Every Class B airport: where it is, what the weather is doing
    there now and what it is forecast to do, and which terminal area
    chart covers it.

    `flight_category` is the METAR's own (VFR, MVFR, IFR, LIFR), not
    this project's arithmetic -- it is what the reporting station
    published, and a pilot already reads it that way. None where the
    field has no current report.
    """
    # Timed per stage rather than as one total: class_b_airports() has its
    # own on-disk pickle cache (vfr.classb), warm in well under a second
    # and a genuine ~15s shapefile reparse when that cache is missing or
    # stale -- exactly what happened 2026-09-23, when an iCloud sync
    # conflict silently renamed the pickle out from under it and this
    # endpoint went from ~1s to timing out with nothing in the logs to
    # say why. A single "N.Ns total" line would have shown the request
    # was slow; this shows which of the two calls it was slow *in*.
    started = time.time()
    shp_path = airspace.ensure_class_airspace_shapefile(altitude.DEFAULT_FAA_CACHE_DIR)
    found = classb.class_b_airports(shp_path)
    log.info("class_b_airports: %d airports in %.2fs", len(found), time.time() - started)
    idents = [a["ident"] for a in found]
    started = time.time()
    metars = weather.metar_for_idents(idents)
    tafs = weather.taf_for_idents(idents)
    log.info("class-b weather: %d idents in %.2fs", len(idents), time.time() - started)

    airports = []
    for a in found:
        metar = metars.get(a["ident"]) or {}
        taf = tafs.get(a["ident"]) or {}
        airports.append(
            ClassBAirport(
                ident=a["ident"],
                name=a["name"],
                lat=a["lat"],
                lon=a["lon"],
                floor_ft_msl=a["floor_ft_msl"],
                shelves=a["shelves"],
                tac=_tac_sheet(a["lat"], a["lon"]),
                flight_category=metar.get("flight_category"),
                metar=metar.get("raw"),
                ceiling_ft=metar.get("ceiling_ft"),
                visibility_sm=metar.get("visibility_sm"),
                wind_dir_true_deg=metar.get("wind_dir_true_deg"),
                wind_speed_kt=metar.get("wind_speed_kt"),
                taf=taf.get("raw"),
                taf_ceiling_ft=taf.get("ceiling_ft"),
                taf_visibility_sm=taf.get("visibility_sm"),
            )
        )
    return ClassBResponse(airports=airports)
