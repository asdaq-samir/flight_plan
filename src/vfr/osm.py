"""Overpass API query + parsing for candidate visual landmarks.

Candidate categories are things a VFR pilot can plausibly pick out from
altitude: water bodies, stadiums, and towns/cities, all via
CANDIDATE_SPECS below -- plus rivers, railroads,
major-highway intersections, and wind farms, which aren't single-point
OSM features and need their own resolvers (see query_line_features/
find_line_crossings, query_major_highways/find_intersections, and
query_wind_turbines/find_wind_farms).

VOR navaids and generic towers/obstacles are NOT sourced from OSM at all
-- see vfr.faa_data, which pulls both from the FAA's own NASR/Digital
Obstacle File data. The FAA is definitionally the authority on its own
navaid network, and DOF obstacle height/lighting data lets "tower"
candidates be filtered to ones actually significant enough to matter
from the air, rather than every generic man_made=tower OSM tag.
"""
import numpy as np
import pandas as pd
import requests

from .geo import cluster_points, cross_track_distance_nm, distance_nm
from .retry import with_retries

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# The public Overpass instances, tried in turn: the main one answers
# 504 Gateway Timeout for minutes at a time under load (a retrain's
# collect step died that way three attempts running on 2026-09-21),
# and the same query on a mirror usually goes through.
OVERPASS_URLS = (
    OVERPASS_URL,
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
)
# Overpass rejects requests without an identifiable User-Agent (406 Not Acceptable).
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}

# category -> (Overpass tag filter clause, predicate on the element's tags dict)
# Query building and categorization both come from this single spec, so they
# can't drift out of sync with each other.
# natural=water covers rivers too, as polygons -- and those are already
# handled properly by query_line_features/find_line_crossings, which
# resolve a river to the point where the route actually crosses it (the
# only sensible checkpoint for a linear feature). Left in, they arrived
# as enormous "lakes" placed at the centre of their bounding box: the
# worst offender was a 665 km2 unnamed water=river multipolygon whose
# marker landed nowhere near any water.
_RIVERINE_WATER = ("river", "stream", "canal", "ditch")

CANDIDATE_SPECS = {
    # intermittent!=yes excludes seasonal/dry water bodies -- not a
    # reliable visual checkpoint if it might be empty when you fly over.
    "lake_or_pond": (
        '["natural"="water"]["intermittent"!="yes"]'
        '["water"!~"^(river|stream|canal|ditch)$"]',
        lambda t: (
            t.get("natural") == "water"
            and t.get("intermittent") != "yes"
            and t.get("water") not in _RIVERINE_WATER
        ),
    ),
    "reservoir": (
        '["water"="reservoir"]["intermittent"!="yes"]',
        lambda t: t.get("water") == "reservoir" and t.get("intermittent") != "yes",
    ),
    "stadium": ('["leisure"="stadium"]', lambda t: t.get("leisure") == "stadium"),
    "town": ('["place"~"^(city|town)$"]', lambda t: t.get("place") in ("city", "town")),
    # "tower", "vor", "water_tower" and "quarry" are deliberately absent.
    #
    # tower/vor come from vfr.faa_data (FAA DOF obstacles / NASR navaids)
    # instead of OSM tags -- the FAA is the authority on its own network,
    # and DOF height/lighting data filters obstacles down to ones actually
    # significant from the air.
    #
    # water_tower was dropped because a sectional draws every obstacle
    # with the same symbol -- there is no water-tower symbol -- so from
    # the chart alone you cannot tell one from any other tower, and the
    # label is defined as a chart judgment. Checking the 17 this used to
    # produce: 16 were not charted at all (nearest FAA obstacle 0.23 to
    # 30 nm away), so they were unratable rather than merely ambiguous;
    # the 1 that was charted duplicated a DOF entry 0.0014 nm away. The
    # FAA already carries genuinely charted water towers as TANK
    # obstacles, so nothing is lost.
    #
    # quarry went for the same reason one step further along: a sectional
    # marks a mine or quarry with a crossed-pick symbol only where one is
    # large and isolated enough to be a landmark, so most OSM
    # landuse=quarry polygons -- gravel pits beside a county road -- have
    # nothing drawn at all, and from the air a working pit reads as a
    # bare patch indistinguishable from a field being cleared.
}


def build_overpass_query(bbox: tuple, specs: dict = CANDIDATE_SPECS, timeout_s: int = 60) -> str:
    """bbox = (min_lat, min_lon, max_lat, max_lon).

    Uses `out geom;` so ways/relations come back with full vertex
    geometry. `out bb;` (and `out center;`, which is the same thing) only
    gives a bounding box, and its centre is not a point on the feature --
    for anything non-convex, a crescent lake or a bay, the marker lands
    off the water entirely. See _representative_point.

    The bounds Overpass still returns alongside the geometry are what
    _bbox_area_m2 uses to tell a farm pond from a real lake; the true
    polygon area isn't needed for that.
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    clauses = []
    for filt, _match in specs.values():
        clauses.append(f"node{filt}({bbox_str});")
        clauses.append(f"way{filt}({bbox_str});")
        clauses.append(f"relation{filt}({bbox_str});")
    body = "\n".join(clauses)
    return f"[out:json][timeout:{timeout_s}];\n(\n{body}\n);\nout geom;"


def _post_overpass_query(query: str, retries: int = 3) -> dict:
    attempts = {"n": 0}

    def attempt() -> dict:
        # Each retry moves to the next instance, so three attempts are
        # three servers rather than the same overloaded one three times.
        url = OVERPASS_URLS[attempts["n"] % len(OVERPASS_URLS)]
        attempts["n"] += 1
        resp = requests.post(url, data={"data": query}, headers=REQUEST_HEADERS, timeout=90)
        resp.raise_for_status()
        return resp.json()

    return with_retries(
        attempt, describe="Overpass query", retries=retries, backoff_s=5.0,
        transient=(requests.RequestException, ValueError),
    )


def query_overpass(bbox: tuple, specs: dict = CANDIDATE_SPECS, retries: int = 3) -> dict:
    """Raw Overpass API response for every candidate-category feature
    (see specs) inside bbox -- pass to parse_overpass_response to get a
    usable DataFrame out of it."""
    query = build_overpass_query(bbox, specs)
    return _post_overpass_query(query, retries)


def _category_for_tags(tags: dict, specs: dict = CANDIDATE_SPECS) -> str:
    for category, (_filt, match) in specs.items():
        if match(tags):
            return category
    return "other"


def _bbox_area_m2(bounds: dict) -> float:
    """Rough rectangular footprint area from an Overpass `bounds` block —
    an overestimate of the true polygon area, but fine for telling a real
    lake apart from a farm pond.
    """
    width_nm = distance_nm(bounds["minlat"], bounds["minlon"], bounds["minlat"], bounds["maxlon"])
    height_nm = distance_nm(bounds["minlat"], bounds["minlon"], bounds["maxlat"], bounds["minlon"])
    return (width_nm * 1852.0) * (height_nm * 1852.0)


def _representative_point(el: dict) -> tuple | None:
    """A (lat, lon) that actually lies on the feature, or None if the
    element's geometry can't be assembled into one.

    shapely's representative_point() is the point of this: unlike
    centroid(), it is guaranteed to fall *inside* the polygon, which is
    exactly the property a map marker needs. A centroid is fine for a
    blob and wrong for a crescent-shaped lake.

    Relations are multipolygons whose outer ring is often split across
    several member ways, so the members are stitched back together with
    polygonize() rather than assumed to be one closed loop. Where a
    relation yields several polygons (a lake with islands, a chain of
    pools), the largest is the one worth flying to.
    """
    from shapely.geometry import LineString, Polygon
    from shapely.ops import polygonize, unary_union

    def _coords(geometry):
        return [(p["lon"], p["lat"]) for p in geometry if p.get("lat") is not None]

    shapes = []
    if el["type"] == "way" and el.get("geometry"):
        coords = _coords(el["geometry"])
        if len(coords) >= 4 and coords[0] == coords[-1]:
            shapes.append(Polygon(coords))
        elif len(coords) >= 2:
            shapes.append(LineString(coords))
    elif el["type"] == "relation":
        lines = [
            LineString(_coords(m["geometry"]))
            for m in el.get("members", [])
            if m.get("role") in (None, "", "outer") and len(_coords(m.get("geometry") or [])) >= 2
        ]
        polys = list(polygonize(lines))
        shapes.extend(polys or lines)

    shapes = [s for s in shapes if not s.is_empty]
    if not shapes:
        return None

    areas = [s.area for s in shapes]
    shape = shapes[areas.index(max(areas))] if max(areas) > 0 else unary_union(shapes)
    point = shape.representative_point()
    return (point.y, point.x)


def _bounds_from_geometry(el: dict) -> dict | None:
    """Fall back to deriving bounds from the geometry, for the rare
    element Overpass returns without a bounds block."""
    points = list(el.get("geometry") or [])
    for member in el.get("members", []):
        points.extend(member.get("geometry") or [])
    lats = [p["lat"] for p in points if p.get("lat") is not None]
    lons = [p["lon"] for p in points if p.get("lon") is not None]
    if not lats or not lons:
        return None
    return {"minlat": min(lats), "maxlat": max(lats), "minlon": min(lons), "maxlon": max(lons)}


def parse_overpass_response(response: dict, specs: dict = CANDIDATE_SPECS) -> pd.DataFrame:
    """Flattens query_overpass's raw response into one row per candidate
    feature, categorized (see _category_for_tags) and with a bbox_area_m2
    computed for way/relation elements."""
    rows = []
    for el in response.get("elements", []):
        tags = el.get("tags", {})
        bounds = el.get("bounds")
        if el["type"] == "node":
            lat, lon = el.get("lat"), el.get("lon")
            bbox_area_m2 = 0.0
        else:
            bounds = bounds or _bounds_from_geometry(el)
            if not bounds:
                continue
            bbox_area_m2 = _bbox_area_m2(bounds)
            point = _representative_point(el)
            if point is not None:
                lat, lon = point
            else:
                # Geometry that won't assemble into a shape at all: the
                # bbox centre is wrong for anything non-convex, but it's
                # better than dropping the candidate outright.
                lat = (bounds["minlat"] + bounds["maxlat"]) / 2
                lon = (bounds["minlon"] + bounds["maxlon"]) / 2
        if lat is None or lon is None:
            continue
        rows.append(
            {
                "osm_id": el["id"],
                "osm_type": el["type"],
                "category": _category_for_tags(tags, specs),
                "name": tags.get("name"),
                "lat": lat,
                "lon": lon,
                "bbox_area_m2": bbox_area_m2,
                "tags": tags,
            }
        )
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.drop_duplicates(subset=["osm_id", "osm_type"]).reset_index(drop=True)
    return df


# --- Rivers + railroads: linear features resolved to their route-crossing point ---
#
# Neither is a single-point OSM feature, and a pilotage checkpoint for either
# is naturally "the point where the route crosses it" -- so both share one
# resolver rather than getting entries in CANDIDATE_SPECS.


def query_line_features(bbox: tuple, tag_filter: str, retries: int = 3, timeout_s: int = 60) -> list:
    """Overpass query for line-shaped ways with full vertex geometry --
    `out geom;` rather than the `out bb;` used everywhere else in this
    module, since resolving a crossing point needs the actual polyline,
    not just a bounding box.

    Returns the raw list of way elements, each with a `geometry` array of
    {lat, lon} vertices.
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    query = f'[out:json][timeout:{timeout_s}];\nway{tag_filter}({bbox_str});\nout geom;'
    return _post_overpass_query(query, retries).get("elements", [])


def _lerp_point(p1: tuple, p2: tuple, t: float) -> tuple:
    """Point a fraction t of the way from p1 to p2, in (lat, lon). Planar
    interpolation -- fine at the scale of two adjacent vertices on an OSM
    way (a few hundred meters to a couple nm apart at most), where
    great-circle vs. straight-line error is negligible.
    """
    lat1, lon1 = p1
    lat2, lon2 = p2
    return lat1 + t * (lat2 - lat1), lon1 + t * (lon2 - lon1)


_LINE_CROSSING_COLUMNS = ["osm_id", "osm_type", "name", "lat", "lon", "bbox_area_m2", "tags"]

# Crossings closer together than this are the same checkpoint as far as a
# pilot is concerned -- a meandering river can weave back over the course
# line three times inside 100 m, and at 120 kt that's a couple of seconds.
# Collapsing them stops the same feature being offered for labeling
# repeatedly, and stops one label being joined onto several training rows.
MIN_CROSSING_SEPARATION_NM = 0.5


def find_line_crossings(ways: list, route_start: tuple, route_end: tuple) -> pd.DataFrame:
    """Resolve each way's crossing point(s) with the route's great-circle
    line: walk the way's vertices, and wherever cross_track_distance_nm
    (already used to enforce the route corridor everywhere else) flips
    sign between two consecutive vertices, the route crosses between
    them -- linearly interpolate the crossing point there. A winding
    river/track can cross more than once, so this can emit multiple rows
    per way. `category` is left for the caller to assign, since this is
    shared by rivers and railroads.

    Crossings within MIN_CROSSING_SEPARATION_NM of one already kept are
    dropped as the same checkpoint. Those that survive get distinct ids
    ("<way id>#2", "#3", ...) because osm_id is what labels join on: left
    identical, a single rating would be joined onto every crossing of that
    river and silently counted several times over. The first crossing
    keeps the bare way id so existing labels still match.
    """
    rows = []
    for way in ways:
        geometry = way.get("geometry")
        if not geometry:
            continue
        tags = way.get("tags", {})
        # Every vertex of the way in one call. A long river runs to
        # hundreds of vertices and a corridor to hundreds of ways, so
        # asking per vertex was most of what this function cost.
        cross_tracks = cross_track_distance_nm(
            np.array([pt["lat"] for pt in geometry], dtype=float),
            np.array([pt["lon"] for pt in geometry], dtype=float),
            route_start,
            route_end,
        )

        crossings = []
        for i in range(len(geometry) - 1):
            ct1, ct2 = cross_tracks[i], cross_tracks[i + 1]
            if (ct1 < 0) == (ct2 < 0):
                continue
            t = abs(ct1) / (abs(ct1) + abs(ct2))
            lat, lon = _lerp_point(
                (geometry[i]["lat"], geometry[i]["lon"]),
                (geometry[i + 1]["lat"], geometry[i + 1]["lon"]),
                t,
            )
            if any(
                distance_nm(lat, lon, kept_lat, kept_lon) < MIN_CROSSING_SEPARATION_NM
                for kept_lat, kept_lon in crossings
            ):
                continue
            crossings.append((lat, lon))

        for n, (lat, lon) in enumerate(crossings):
            rows.append(
                {
                    "osm_id": way["id"] if n == 0 else f"{way['id']}#{n + 1}",
                    "osm_type": "way",
                    "name": tags.get("name"),
                    "lat": lat,
                    "lon": lon,
                    "bbox_area_m2": 0.0,
                    "tags": tags,
                }
            )
    return pd.DataFrame(rows, columns=_LINE_CROSSING_COLUMNS)


# --- Highway intersections: a node shared by 2+ distinct major-highway ways ---


def query_major_highways(bbox: tuple, retries: int = 3, timeout_s: int = 60) -> tuple:
    """Overpass query for major highway ways plus every node they
    reference (`out body; >; out skel qt;`): a road intersection isn't a
    taggable OSM feature on its own, it's a node shared by 2+ distinct
    ways, so this needs each way's ordered node-id list plus real node
    coordinates rather than the `out bb;` shape used elsewhere.

    Returns (highway_ways, node_coords): highway_ways is the list of way
    elements (each with an ordered "nodes" id list), node_coords is a
    {node_id: (lat, lon)} dict for every node referenced by those ways.
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    query = (
        f'[out:json][timeout:{timeout_s}];\n'
        f'way["highway"~"^(motorway|trunk|primary|secondary)$"]({bbox_str});\n'
        f"out body;\n>;\nout skel qt;"
    )
    elements = _post_overpass_query(query, retries).get("elements", [])
    highway_ways = [el for el in elements if el["type"] == "way"]
    node_coords = {el["id"]: (el["lat"], el["lon"]) for el in elements if el["type"] == "node"}
    return highway_ways, node_coords


_INTERSECTION_COLUMNS = ["osm_id", "osm_type", "category", "name", "lat", "lon", "bbox_area_m2", "tags"]


def find_intersections(highway_ways: list, node_coords: dict) -> pd.DataFrame:
    """A road intersection = a node shared by ways belonging to 2+
    genuinely different *numbered* roads (their `ref` tag, e.g. "US 51").
    Matching on `ref` only (not falling back to `name`) is deliberate:
    OSM splits a single physical road into many short way segments
    (speed limit changes, bridges, ...), and inconsistently re-tags the
    same numbered route's `name` as whatever local street it's currently
    running along (e.g. "US 51 Business" also appears as "Grand Avenue",
    "Merrill Avenue", "Schofield Avenue", ... along its own length) --
    matching on `name` produces overwhelming false-positive
    "intersections" between segments of the *same* road. Requiring `ref`
    on both sides also naturally excludes plain local streets with no
    route number, matching the "avoid small local road intersections"
    guidance this whole feature is scoped around.
    """
    node_to_ways: dict = {}
    for way in highway_ways:
        for node_id in way.get("nodes", []):
            node_to_ways.setdefault(node_id, set()).add(way["id"])

    way_by_id = {way["id"]: way for way in highway_ways}

    def road_ref(way: dict) -> str | None:
        return (way.get("tags", {}).get("ref") or "").strip() or None

    rows = []
    for node_id, way_ids in node_to_ways.items():
        if node_id not in node_coords:
            continue
        lat, lon = node_coords[node_id]
        labels = sorted({road_ref(way_by_id[wid]) for wid in way_ids} - {None})
        if len(labels) < 2:
            continue  # same numbered road (or an unnumbered local street)
        rows.append(
            {
                "osm_id": node_id,
                "osm_type": "node",
                "category": "intersection",
                "name": " & ".join(labels),
                "lat": lat,
                "lon": lon,
                "bbox_area_m2": 0.0,
                "tags": {"intersecting_ways": labels},
            }
        )

    df = pd.DataFrame(rows, columns=_INTERSECTION_COLUMNS)
    if df.empty:
        return df

    # A real interchange is frequently digitized as several nodes a few
    # tens of meters apart (ramps, a divided-highway median, ...) -- each
    # would otherwise show up as its own near-duplicate candidate. Merge
    # ones within 0.03 nm (~55 m) of each other, same trick as
    # find_wind_farms. Deliberately tight: two genuinely separate
    # intersections a couple hundred meters apart (e.g. where a
    # multiplexed route's concurrency starts vs. ends) should stay separate.
    df = df.assign(cluster_id=cluster_points(df["lat"], df["lon"], cluster_distance_nm=0.03))
    merged = []
    for _, group in df.groupby("cluster_id"):
        labels = sorted({label for tags in group["tags"] for label in tags["intersecting_ways"]})
        merged.append(
            {
                "osm_id": group["osm_id"].iloc[0],
                "osm_type": "node",
                "category": "intersection",
                "name": " & ".join(labels),
                "lat": group["lat"].mean(),
                "lon": group["lon"].mean(),
                "bbox_area_m2": 0.0,
                "tags": {"intersecting_ways": labels},
            }
        )
    return pd.DataFrame(merged, columns=_INTERSECTION_COLUMNS)


# --- Wind farms: individually-mapped turbines, clustered into farm-level candidates ---


def query_wind_turbines(bbox: tuple, retries: int = 3, timeout_s: int = 60) -> pd.DataFrame:
    """Overpass query for individual wind-turbine nodes
    (power=generator + generator:source=wind). Each turbine is its own
    OSM node; find_wind_farms clusters them into farm-level candidates.
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    query = (
        f'[out:json][timeout:{timeout_s}];\n'
        f'node["power"="generator"]["generator:source"="wind"]({bbox_str});\n'
        f"out;"
    )
    elements = _post_overpass_query(query, retries).get("elements", [])
    rows = [
        {"osm_id": el["id"], "lat": el["lat"], "lon": el["lon"], "name": el.get("tags", {}).get("name")}
        for el in elements
        if el["type"] == "node"
    ]
    return pd.DataFrame(rows, columns=["osm_id", "lat", "lon", "name"])


_WIND_FARM_COLUMNS = ["osm_id", "osm_type", "category", "name", "lat", "lon", "bbox_area_m2", "tags"]


def find_wind_farms(turbine_df: pd.DataFrame, cluster_distance_nm: float = 1.0) -> pd.DataFrame:
    """Group individual turbines into farm-level candidates -- a pilot
    spots "that field of turbines" as one checkpoint, not each turbine
    separately. Clusters via geo.cluster_points, then represents each
    cluster by its centroid, turbine count, and bounding-box footprint
    (so log_size_feature sees a real size: a 40-turbine farm should read
    as more visible than a 3-turbine cluster).
    """
    if turbine_df.empty:
        return pd.DataFrame(columns=_WIND_FARM_COLUMNS)

    turbine_df = turbine_df.reset_index(drop=True)
    turbine_df = turbine_df.assign(
        cluster_id=cluster_points(turbine_df["lat"], turbine_df["lon"], cluster_distance_nm)
    )

    rows = []
    for _, group in turbine_df.groupby("cluster_id"):
        bounds = {
            "minlat": group["lat"].min(),
            "minlon": group["lon"].min(),
            "maxlat": group["lat"].max(),
            "maxlon": group["lon"].max(),
        }
        names = group["name"].dropna()
        farm_name = names.mode().iloc[0] if not names.empty else f"Wind Farm ({len(group)} turbines)"
        rows.append(
            {
                "osm_id": int(group["osm_id"].min()),
                "osm_type": "cluster",
                "category": "wind_farm",
                "name": farm_name,
                "lat": group["lat"].mean(),
                "lon": group["lon"].mean(),
                "bbox_area_m2": _bbox_area_m2(bounds),
                "tags": {"turbine_count": int(len(group))},
            }
        )
    return pd.DataFrame(rows, columns=_WIND_FARM_COLUMNS)
