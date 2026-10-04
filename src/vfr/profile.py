"""A route's side view: the ground under it and the controlled airspace
over it, along the whole route through its stops -- for the page to draw
the plan's altitudes over, as an EFB's profile view does.

The ground is the same samples the terrain floor reads (vfr.terrain,
every 2 nm along each hop's straight line, from the USGS's elevations,
held on disk), so a route already planned asks nothing new of the USGS.
The airspace is each Class B, C and D the hops' lines pass through: where
along the route it begins and ends, its floor and its ceiling.
"""
from itertools import pairwise

from shapely.geometry import LineString

from . import elevation, geo
from .airspace import load_controlled_airspace
from .terrain import M_TO_FT, SAMPLE_INTERVAL_NM, _route_sample_points


def _along(point: tuple, start: tuple, end: tuple, length_nm: float) -> float:
    return min(max(geo.along_track_distance_nm(point[1], point[0], start, end), 0.0), length_nm)


def route_profile(path: list, shp_path) -> dict:
    """The ground and the airspace along a route through `path` [(lat,
    lon)], its airports in order: {"length_nm", "terrain": [{"along_nm",
    "ground_ft"}], "airspace": [{"name", "class", "from_nm", "to_nm",
    "floor_ft", "ceiling_ft"}]}, distances from the departure, hop after
    hop, the airspace in the order it is reached."""
    terrain, airspace, offset = [], [], 0.0
    for start, end in pairwise(path):
        length = geo.distance_nm(*start, *end)
        points = _route_sample_points(start, end, SAMPLE_INTERVAL_NM)
        elevations = elevation.get_elevations_m(points)
        spacing = length / (len(points) - 1)
        terrain.extend(
            {"along_nm": round(offset + i * spacing, 2), "ground_ft": round(elevations[p] * M_TO_FT)}
            for i, p in enumerate(points)
            if not (terrain and i == 0)        # a stop's sample once, not twice
        )
        line = LineString([(start[1], start[0]), (end[1], end[0])])
        for polygon in load_controlled_airspace(shp_path, geo.corridor_bbox(start, end, buffer_nm=2.0)):
            crossing = line.intersection(polygon["geometry"])
            for part in getattr(crossing, "geoms", [crossing]):
                if part.is_empty or part.geom_type != "LineString":
                    continue
                ends = sorted(_along(c, start, end, length) for c in (part.coords[0], part.coords[-1]))
                if ends[1] - ends[0] < 0.05:
                    continue
                airspace.append({
                    "name": polygon["name"], "class": polygon["class"],
                    "from_nm": round(offset + ends[0], 2), "to_nm": round(offset + ends[1], 2),
                    "floor_ft": polygon["floor_ft_msl"], "ceiling_ft": polygon.get("ceiling_ft_msl"),
                })
        offset += length
    return {
        "length_nm": round(offset, 1),
        "terrain": terrain,
        "airspace": sorted(airspace, key=lambda a: (a["from_nm"], a["floor_ft"])),
    }
