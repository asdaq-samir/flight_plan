"""Overpass API query + parsing for candidate visual landmarks.

Candidate categories are things a VFR pilot can plausibly pick out from
altitude: water bodies, water towers, stadiums, quarries, and
towns/cities, all via CANDIDATE_SPECS below -- plus rivers, railroads,
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
import time

import pandas as pd
import requests

from .geo import cluster_points, cross_track_distance_nm, distance_nm

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Overpass rejects requests without an identifiable User-Agent (406 Not Acceptable).
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}

# category -> (Overpass tag filter clause, predicate on the element's tags dict)
# Query building and categorization both come from this single spec, so they
# can't drift out of sync with each other.
CANDIDATE_SPECS = {
    # intermittent!=yes excludes seasonal/dry water bodies -- not a
    # reliable visual checkpoint if it might be empty when you fly over.
    "lake_or_pond": (
        '["natural"="water"]["intermittent"!="yes"]',
        lambda t: t.get("natural") == "water" and t.get("intermittent") != "yes",
    ),
    "reservoir": (
        '["water"="reservoir"]["intermittent"!="yes"]',
        lambda t: t.get("water") == "reservoir" and t.get("intermittent") != "yes",
    ),
    "water_tower": ('["man_made"="water_tower"]', lambda t: t.get("man_made") == "water_tower"),
    "stadium": ('["leisure"="stadium"]', lambda t: t.get("leisure") == "stadium"),
    "quarry": ('["landuse"="quarry"]', lambda t: t.get("landuse") == "quarry"),
    "town": ('["place"~"^(city|town)$"]', lambda t: t.get("place") in ("city", "town")),
    # "tower" and "vor" are deliberately absent -- both now come from
    # vfr.faa_data (FAA DOF obstacles / NASR navaids) instead of OSM tags.
}


def build_overpass_query(bbox: tuple, specs: dict = CANDIDATE_SPECS, timeout_s: int = 60) -> str:
    """bbox = (min_lat, min_lon, max_lat, max_lon).

    Uses `out bb;` rather than `out center;` so ways/relations come back
    with a bounding box we can use to estimate footprint size (a lake
    polygon's true area needs full geometry, but the bbox is enough to
    tell a farm pond from a real lake).
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    clauses = []
    for filt, _match in specs.values():
        clauses.append(f"node{filt}({bbox_str});")
        clauses.append(f"way{filt}({bbox_str});")
        clauses.append(f"relation{filt}({bbox_str});")
    body = "\n".join(clauses)
    return f"[out:json][timeout:{timeout_s}];\n(\n{body}\n);\nout bb;"


def _post_overpass_query(query: str, retries: int = 3) -> dict:
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.post(
                OVERPASS_URL, data={"data": query}, headers=REQUEST_HEADERS, timeout=90
            )
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as err:
            last_err = err
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Overpass query failed after {retries} attempts") from last_err


def query_overpass(bbox: tuple, specs: dict = CANDIDATE_SPECS, retries: int = 3) -> dict:
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


def parse_overpass_response(response: dict, specs: dict = CANDIDATE_SPECS) -> pd.DataFrame:
    rows = []
    for el in response.get("elements", []):
        tags = el.get("tags", {})
        bounds = el.get("bounds")
        if el["type"] == "node":
            lat, lon = el.get("lat"), el.get("lon")
            bbox_area_m2 = 0.0
        elif bounds:
            lat = (bounds["minlat"] + bounds["maxlat"]) / 2
            lon = (bounds["minlon"] + bounds["maxlon"]) / 2
            bbox_area_m2 = _bbox_area_m2(bounds)
        else:
            continue
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


def find_line_crossings(ways: list, route_start: tuple, route_end: tuple) -> pd.DataFrame:
    """Resolve each way's crossing point(s) with the route's great-circle
    line: walk the way's vertices, and wherever cross_track_distance_nm
    (already used to enforce the route corridor everywhere else) flips
    sign between two consecutive vertices, the route crosses between
    them -- linearly interpolate the crossing point there. A winding
    river/track can cross more than once, so this can emit multiple rows
    per way. `category` is left for the caller to assign, since this is
    shared by rivers and railroads.
    """
    rows = []
    for way in ways:
        geometry = way.get("geometry")
        if not geometry:
            continue
        tags = way.get("tags", {})
        cross_tracks = [
            cross_track_distance_nm(pt["lat"], pt["lon"], route_start, route_end) for pt in geometry
        ]
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
            rows.append(
                {
                    "osm_id": way["id"],
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
