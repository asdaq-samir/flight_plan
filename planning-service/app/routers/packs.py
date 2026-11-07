"""The phones' cycle packs (wingtip.pack's write_phone): the airspace, the
special-use areas and the places of one region, for the phone to answer
with no network. The same for every pilot for the whole cycle, which a
pack's address names. And the map's FAA overlays as vector tiles of the
same cycle (wingtip.vector_tiles), one PMTiles archive read in byte ranges."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from wingtip import pack as cycle_pack
from wingtip import vector_tiles

from ..common import DIAGRAM_CACHE, SHARED_CACHE
from ..schemas import CyclePacks, OverlayTiles

router = APIRouter()


@router.get("/api/cycle-packs", response_model=CyclePacks)
def cycle_packs() -> JSONResponse:
    """The regions there are packs of, for the cycle the planner holds.
    404 until the planner has built them (after its warm-up, once a
    cycle). Kept as the airport search is: the next cycle's reaches a
    phone within the hour."""
    index = cycle_pack.phone_index()
    if index is None:
        raise HTTPException(404, "no phone packs yet: the planner builds them after its warm-up")
    return JSONResponse(CyclePacks(**index).model_dump(), headers={"Cache-Control": SHARED_CACHE})


@router.get("/api/cycle-pack/{cycle}/{region}.pack",
            responses={200: {"content": {"application/octet-stream": {}}}})
def cycle_pack_file(cycle: str, region: str) -> FileResponse:
    """One region's pack of a cycle, by its name in /api/cycle-packs. Its
    cycle is in its address, so it is kept as an airport diagram is: the
    whole cycle, and never asked for again in between."""
    path = cycle_pack.phone_pack_path(cycle, region)
    if path is None:
        raise HTTPException(404, f"no pack of {region} for {cycle}")
    return FileResponse(path, media_type="application/octet-stream", headers={"Cache-Control": DIAGRAM_CACHE})


@router.get("/api/overlay-tiles", response_model=OverlayTiles)
def overlay_tiles() -> JSONResponse:
    """The overlay tiles' archive of the cycle the planner holds: its name,
    which its address takes, its zooms and layers. 404 until the planner
    has built it (after the cycle pack, once a cycle). Kept as the airport
    search is: the next cycle's reaches the map within the hour."""
    index = vector_tiles.tiles_index()
    if index is None:
        raise HTTPException(404, "no overlay tiles yet: the planner builds them after the cycle pack")
    return JSONResponse(OverlayTiles(**index).model_dump(), headers={"Cache-Control": SHARED_CACHE})


@router.get("/api/overlay-tiles/{name}.pmtiles",
            responses={200: {"content": {"application/octet-stream": {}}},
                       206: {"description": "The byte range asked for (Range: bytes=a-b)",
                             "content": {"application/octet-stream": {}}}})
def overlay_tiles_file(name: str) -> FileResponse:
    """The archive by its name in /api/overlay-tiles, whole or -- as a map
    reads it, a tile at a time -- the byte ranges asked for (206, with
    Accept-Ranges and Content-Range: Starlette's FileResponse). Its name
    changes with every build, so it is kept as an airport diagram is."""
    path = vector_tiles.tiles_path(name)
    if path is None:
        raise HTTPException(404, f"no overlay tiles {name}")
    return FileResponse(path, media_type="application/octet-stream", headers={"Cache-Control": DIAGRAM_CACHE})
