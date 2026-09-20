"""The chart-vision path: the sectional's own tiles, what the detector
finds in a corridor, and what a pilot marks on it. Nothing here touches
Overpass, the FAA subscription or the elevation service."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from vfr import chartlabels, chartvision, geo
from vfr.config import VFR_SECTIONAL_MAX_ZOOM, VFR_SECTIONAL_MIN_ZOOM

from ..common import line, load_route, ndjson, route_key
from ..detection import detect_job, faa_airports
from ..schemas import (
    Classification,
    DetectBlock,
    DetectDone,
    Detection,
    DetectStart,
    PickDeleted,
    PickSaved,
    PicksResponse,
)

router = APIRouter()

# One chart cycle, in seconds -- how long a browser (or a CDN in front
# of this app) may keep a tile before asking again. PlannerProxyController
# forwards Cache-Control for this path alone; see its own comment.
_SECTIONAL_TILE_MAX_AGE_S = 28 * 24 * 3600


@router.get("/api/sectional-tile/{z}/{x}/{y}.png")
def sectional_tile(z: int, x: int, y: int) -> Response:
    """The sectional as a {z}/{x}/{y} tile pyramid, built from the TAMU
    dynamic map service one tile-sized export at a time and cached on
    disk (vfr.chartvision's own tile cache -- the same files the
    detector reads, so a corridor planned once has its map tiles ready,
    and a map browsed once has its detection tiles ready).

    This is what makes the map's sectional layer a plain Leaflet tile
    layer: edge-only fetches on a pan, the previous zoom's tiles scaled
    under the zoom animation, a prefetch ring -- everything a tile
    pyramid gets for free that a one-image-per-view dynamic layer
    structurally could not. Outside the chart's own useful zoom range
    there is nothing worth rendering: the tile layer's maxNativeZoom
    keeps the browser from asking, and this keeps anyone else from
    making TAMU render it.
    """
    if not (VFR_SECTIONAL_MIN_ZOOM <= z <= VFR_SECTIONAL_MAX_ZOOM):
        raise HTTPException(404, f"sectional tiles exist for zoom {VFR_SECTIONAL_MIN_ZOOM}-{VFR_SECTIONAL_MAX_ZOOM}")
    png = chartvision.sectional_tile_png(x, y, z)
    if png is None:
        raise HTTPException(404, "no chart coverage for this tile")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": f"public, max-age={_SECTIONAL_TILE_MAX_AGE_S}"},
    )


@router.get("/api/classify")
def classify(lat: float, lon: float) -> Classification:
    """What the chart draws at a point, so a hand-marked checkpoint is
    categorised from the pixels rather than from whatever the dropdown
    happened to be left on."""
    return chartvision.classify_point(lat, lon)


class PickRequest(BaseModel):
    departure_ident: str
    destination_ident: str
    lat: float
    lon: float
    source: str = "detected"   # "detected" (the CV found it) or "added" (it missed it)
    role: str | None = None    # "dr" (fly over it) or "visual" (see it abeam); inferred if omitted
    category: str = "water"
    rating: int | None = None  # 1-5, or 0/None for "detected but I would not use it"
    area_m2: float | None = None
    note: str | None = None


@router.post("/api/picks")
def add_pick(pick: PickRequest) -> PickSaved:
    r = load_route(pick.departure_ident, pick.destination_ident)

    if pick.source not in ("detected", "added"):
        raise HTTPException(422, "source must be 'detected' or 'added'")
    if pick.role is not None and pick.role not in chartlabels.ROLES:
        raise HTTPException(422, f"role must be one of {chartlabels.ROLES}")
    if pick.rating is not None and not (0 <= pick.rating <= 5):
        raise HTTPException(422, "rating must be 0-5, where 0 means 'would not use'")

    route = chartlabels.route_key(r.dep_ident, r.dest_ident)
    cross_track_nm = round(geo.cross_track_distance_nm(pick.lat, pick.lon, r.start, r.end), 3)
    saved = chartlabels.save_pick(
        {
            "route": route,
            "source": pick.source,
            # Inferred from how far off course it sits unless stated: a
            # landmark you do not fly over is not a DR checkpoint.
            "role": pick.role or chartlabels.default_role(cross_track_nm),
            "category": pick.category,
            "lat": pick.lat,
            "lon": pick.lon,
            "along_track_nm": round(geo.along_track_distance_nm(pick.lat, pick.lon, r.start, r.end), 2),
            "cross_track_nm": cross_track_nm,
            "rating": pick.rating,
            "area_m2": pick.area_m2,
            "note": pick.note,
        }
    )
    return PickSaved(ok=True, pick=saved, summary=chartlabels.summarise(route))


@router.delete("/api/picks")
def remove_pick(dep: str, dest: str, lat: float, lon: float) -> PickDeleted:
    route = chartlabels.route_key(*route_key(dep, dest))
    removed = chartlabels.delete_pick(route, lat, lon)
    return PickDeleted(ok=removed, summary=chartlabels.summarise(route))


@router.get("/api/picks")
def list_picks(dep: str, dest: str) -> PicksResponse:
    route = chartlabels.route_key(*route_key(dep, dest))
    return PicksResponse(route=route, picks=chartlabels.load_picks(route), summary=chartlabels.summarise(route))


@router.get("/api/detect/stream")
def detect_stream(dep: str, dest: str, half_width_nm: float = 4.0) -> StreamingResponse:
    """Detections as newline-delimited JSON, one line per block; each
    line is one app.schemas.DetectMessage.

    Blocks advance along the course, so the map fills from the departure
    end and a pilot can start judging the first thirty miles while the
    rest of the corridor is still being read. Airports come first, in
    their own line, because they are a local file lookup and cost
    nothing to produce.

    The landmarks come from the shared per-route job (app.detection);
    only the pick-matching is per-request, because picks change between
    requests and the chart does not.
    """
    r = load_route(dep, dest)
    route = chartlabels.route_key(r.dep_ident, r.dest_ident)

    # Picks are claimed as blocks arrive, each by the nearest landmark it
    # has not already been claimed by. Matching per landmark instead let
    # one pick mark two neighbouring detections as rated, and left picks
    # whose detection has moved out of range with no marker at all.
    unclaimed = {id(p): p for p in chartlabels.load_picks(route)}

    def as_detection(landmark) -> Detection:
        best, best_nm = None, chartlabels.SAME_PLACE_NM
        for key, pick in unclaimed.items():
            gap = geo.distance_nm(pick["lat"], pick["lon"], landmark.lat, landmark.lon)
            if gap < best_nm:
                best, best_nm = key, gap
        pick = unclaimed.pop(best) if best is not None else None
        return Detection(
            lat=landmark.lat,
            lon=landmark.lon,
            category=landmark.category,
            area_m2=round(landmark.area_m2, 1),
            score=landmark.score,
            along_track_nm=round(landmark.extras["along_track_nm"], 2),
            cross_track_nm=round(landmark.extras["cross_track_nm"], 3),
            rating=pick["rating"] if pick else None,
            role=pick.get("role") if pick else None,
            rated=pick is not None and pick["rating"] is not None,
        )

    job = detect_job((route, half_width_nm), r.start, r.end, half_width_nm)

    def lines():
        # The picks cannot be sorted into matched and unmatched until
        # every block has been read, so they arrive at the end rather
        # than the start.
        yield line(DetectStart(route=route))

        airports_found = faa_airports(r.start, r.end, half_width_nm, r.dep_ident, r.dest_ident)
        yield line(DetectBlock(block=-1, blocks=0, detections=[as_detection(a) for a in airports_found]))

        # Follow the shared job's blocks as they land -- instant when the
        # corridor was already read, progressive when this request is the
        # one (or one of the ones) waiting on a fresh read.
        seen, at = 0, 0
        while True:
            with job["cond"]:
                job["cond"].wait_for(lambda: len(job["blocks"]) > at or job["done"])
                fresh_blocks = job["blocks"][at:]
                done, error = job["done"], job["error"]
            at += len(fresh_blocks)
            for block in fresh_blocks:
                seen += len(block["landmarks"])
                yield line(DetectBlock(
                    block=block["block"],
                    blocks=block["blocks"],
                    tiles=block["tiles"],
                    missing=block["missing"],
                    detections=[as_detection(landmark) for landmark in block["landmarks"]],
                ))
            if done and at >= len(job["blocks"]):
                if error is not None:
                    # Same outcome an in-generator exception always had
                    # here: the stream truncates. The job records it so
                    # every follower fails the same way, not just the
                    # request that happened to run the corridor read.
                    raise RuntimeError(f"corridor detection failed: {error}")
                break

        # Whatever no landmark claimed: the detector's misses, plus picks
        # that have drifted apart from the detection they were made
        # against.
        yield line(DetectDone(total=seen, added=list(unclaimed.values()), summary=chartlabels.summarise(route)))

    return ndjson(lines())
