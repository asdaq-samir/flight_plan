"""FAA NASR navaid data and Digital Obstacle File (DOF) data -- more
authoritative sources than OSM tags for VOR navaids and towers/obstacles,
since the FAA is the ground truth for both (and this project already
treats the FAA sectional chart, not OSM/satellite imagery, as the
reference for what a pilot would see -- see vfr.chartvision).

Both are published on a 28-day cycle as a full national dump (not
queryable by bbox server-side, unlike Overpass), so they're downloaded
once and cached under data/raw/ rather than re-fetched every notebook
run -- ensure_nasr_data() only downloads if the cache is empty.
"""
import io
import re
import zipfile
from functools import lru_cache
from pathlib import Path
from urllib.parse import urljoin

import pandas as pd
import requests

from .retry import with_retries

# FAA's site 403s a bare python-requests User-Agent.
FAA_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; vfr-route-learning-project/0.1)"}
NASR_INDEX_URL = "https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/"
DOF_INDEX_URL = "https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dof/"

VOR_NAV_TYPES = {"VOR", "VOR/DME", "VORTAC"}

# Fixed-width column layout for DOF.DAT, reverse-engineered from the raw
# file against the 06 Aug 2026 cycle (verified against all ~18,500 rows
# of the WI state extract with zero parse failures) since the FAA's own
# DOF_README.pdf isn't renderable in this environment. AGL/AMSL start
# columns were cross-checked independently via frequency analysis across
# thousands of rows, and everything else derived from there -- if a
# future FAA cycle shifts this layout, _parse_dof_line will start raising
# ValueError on the int()/float() conversions, which is a loud enough
# failure to notice rather than silently misreading obstacle heights.
_DOF_COLUMNS = {
    "city": (18, 34),
    "lat_deg": (35, 37),
    "lat_min": (38, 40),
    "lat_sec": (41, 46),
    "lat_hem": (46, 47),
    "lon_deg": (48, 51),
    "lon_min": (52, 54),
    "lon_sec": (55, 60),
    "lon_hem": (60, 61),
    "type": (62, 81),
    "agl": (83, 88),
    "amsl": (89, 94),
    "lt": (95, 96),
}


def find_current_cycle_page(index_url: str) -> str:
    """The NASR index page marks the in-effect cycle under an <h2>Current</h2>
    heading (as opposed to "Preview" for an upcoming cycle, or "Archives"
    for past ones) -- pull the first link under that heading.
    """
    resp = requests.get(index_url, headers=FAA_HEADERS, timeout=30)
    resp.raise_for_status()
    m = re.search(r'<h2>Current</h2>\s*<ul>\s*<li><a href="([^"]+)"', resp.text)
    if not m:
        raise RuntimeError(f"Couldn't find the current NASR cycle link on {index_url}")
    return urljoin(index_url, m.group(1))


def find_download_link(page_url: str, href_pattern: str) -> str:
    """The first href on page_url matching href_pattern -- FAA NASR/DOF
    download pages don't have a stable direct URL, it has to be scraped
    off the current listing page each time."""
    resp = requests.get(page_url, headers=FAA_HEADERS, timeout=30)
    resp.raise_for_status()
    m = re.search(href_pattern, resp.text)
    if not m:
        raise RuntimeError(f"Couldn't find a link matching {href_pattern!r} on {page_url}")
    return m.group(1)


def download_and_extract(url: str, dest_dir: Path, retries: int = 3) -> None:
    """Downloads the zip at url and extracts it into dest_dir, retrying
    on transient failures -- the FAA's NASR/DOF archives are large enough
    that a single flaky connection isn't unusual."""
    dest_dir.mkdir(parents=True, exist_ok=True)

    def attempt() -> None:
        resp = requests.get(url, headers=FAA_HEADERS, timeout=180)
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            zf.extractall(dest_dir)

    with_retries(
        attempt, describe=f"Download of {url}", retries=retries,
        transient=(requests.RequestException, zipfile.BadZipFile),
    )


def _is_icloud_evicted(path: Path) -> bool:
    """Whether iCloud has offloaded this file, leaving a placeholder.

    macOS replaces an evicted file with a hidden sibling named
    ".<filename>.icloud" of a couple of hundred bytes, and the real path
    stops existing. An existence check therefore reports "missing"
    correctly, but the reason matters: re-downloading a national dataset
    does not help if the directory is going to offload it again. Seen
    three times in one day on this project -- Class_Airspace.shp, then
    its .dbf, then APT_BASE.csv -- so it is worth naming rather than
    rediscovering.

    A file is only evicted if the real path is gone *and* the placeholder
    is there. Testing for the placeholder alone was wrong: iCloud leaves
    it beside a file it is restoring, so a present, readable 83 MB
    DOF.DAT was reported as evicted and took the whole request down with
    it.
    """
    return not path.exists() and (path.parent / f".{path.name}.icloud").exists()


# Where each file comes from: NAV and APT from the current NASR cycle's
# page, DOF from its own index. Each is its own download, published on its
# own, and read by different callers.
_NASR_FILES = {
    "NAV_BASE.csv": lambda: find_download_link(find_current_cycle_page(NASR_INDEX_URL), r'href="([^"]*NAV_CSV\.zip)"'),
    "APT_BASE.csv": lambda: find_download_link(find_current_cycle_page(NASR_INDEX_URL), r'href="([^"]*APT_CSV\.zip)"'),
    "DOF.DAT": lambda: find_download_link(DOF_INDEX_URL, r'href="(https://aeronav\.faa\.gov/Obst_Data/DOF_\d+\.zip)"'),
}


def ensure_nasr_file(name: str, cache_dir) -> Path:
    """One of the NASR/DOF files -- "NAV_BASE.csv", "APT_BASE.csv" or
    "DOF.DAT" -- downloaded and extracted into cache_dir if it is not
    there, and its path.

    Each file on its own: the three used to be ensured together and any
    one missing failed all of them, so an evicted APT_BASE.csv failed the
    terrain floor, which reads only DOF.DAT, after scraping the NASR index
    and downloading a zip it did not need.
    """
    cache_dir = Path(cache_dir)
    path = cache_dir / name
    if not path.exists():
        download_and_extract(_NASR_FILES[name](), cache_dir)
    if path.exists():
        return path
    if _is_icloud_evicted(path):
        raise RuntimeError(
            f"iCloud evicted {name} from {cache_dir}. Re-downloading "
            "will not hold while this directory syncs to iCloud -- exclude data/raw "
            "from syncing (a parent directory named to end in '.nosync', or keeping "
            "the project outside Desktop/Documents)."
        )
    raise RuntimeError(f"Missing after download: {name} in {cache_dir}.")


def ensure_nasr_data(cache_dir) -> tuple:
    """(nav_csv_path, apt_csv_path, dof_dat_path), each ensured as
    ensure_nasr_file does -- for the pipeline's collect and notebook 01,
    which read all three."""
    return tuple(ensure_nasr_file(name, cache_dir) for name in ("NAV_BASE.csv", "APT_BASE.csv", "DOF.DAT"))


# Facility types the sectional draws as a landable airport. A heliport is
# a rooftop-sized target, a balloonport/ultralight strip is not charted as
# an airport at all, and a seaplane base is an anchor symbol on a lake
# that is already a candidate on its own.
CHARTED_FACILITY_TYPES = {"AIRPORT"}


@lru_cache(maxsize=8)
def _read_apt_base_cached(path: str, mtime: float) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, low_memory=False)


def _read_apt_base(apt_csv_path) -> pd.DataFrame:
    """APT_BASE.csv, parsed once per file version per process."""
    path = Path(apt_csv_path)
    return _read_apt_base_cached(str(path), path.stat().st_mtime)



# APT_BASE encodes the facility type as a single letter.
_SITE_TYPE_NAMES = {
    "A": "AIRPORT", "B": "BALLOONPORT", "C": "SEAPLANE BASE",
    "G": "GLIDERPORT", "H": "HELIPORT", "U": "ULTRALIGHT",
}


def _in_bbox(lat: pd.Series, lon: pd.Series, bbox: tuple) -> pd.Series:
    min_lat, min_lon, max_lat, max_lon = bbox
    return lat.between(min_lat, max_lat) & lon.between(min_lon, max_lon)

def load_route_airports(apt_csv_path, bbox: tuple, exclude_idents: tuple = ()) -> pd.DataFrame:
    """Operational airports from the NASR APT_BASE.csv extract, within
    bbox, in the shared candidate schema.

    FAA rather than OSM or OurAirports for the same reason
    load_vor_navaids is: the FAA is the authority on its own airport
    data. Here that authority is the filter itself -- being listed in
    APT_BASE at all is what tracks with being drawn on the sectional.
    OurAirports was tried first and its "small_airport" type pulled in
    unregistered private strips; checking Barker Strip (35WI) and Rox
    (WS09) against the chart tile found nothing drawn at their
    coordinates, and neither appears in APT_BASE. A candidate the chart
    does not draw cannot be rated, which is why towers, water towers,
    quarries and unnamed lakes were dropped too.

    Private-use fields are kept: the sectional draws a registered private
    airport as a circled magenta "R", verified at Wag-Aero (WI92), so it
    is identifiable on the chart. Whether a grass strip is *easy* to pick
    out is a different question, and that is exactly what the 1-5 rating
    is there to answer.

    exclude_idents drops the departure and destination fields -- both sit
    in the corridor by construction, and neither is a checkpoint: you are
    taking off from one and landing at the other.
    """
    df = _read_apt_base(apt_csv_path)
    df = df[
        df["SITE_TYPE_CODE"].map(_SITE_TYPE_NAMES).isin(CHARTED_FACILITY_TYPES)
        & (df["ARPT_STATUS"] == "O")
    ]
    df["lat"] = df["LAT_DECIMAL"].astype(float)
    df["lon"] = df["LONG_DECIMAL"].astype(float)
    df = df[_in_bbox(df["lat"], df["lon"], bbox)]

    excluded = {i.strip().upper() for i in exclude_idents}
    if excluded:
        keep = ~(
            df["ARPT_ID"].str.upper().isin(excluded)
            | df["ICAO_ID"].fillna("").str.upper().isin(excluded)
        )
        df = df[keep]

    return pd.DataFrame(
        {
            "osm_id": df["ARPT_ID"],
            "osm_type": "faa_airport",
            "category": "airport",
            # The chart labels a field by name and identifier, so the
            # candidate carries both -- that is what you read off it.
            "name": df["ARPT_NAME"].str.title() + " (" + df["ARPT_ID"] + ")",
            "lat": df["lat"],
            "lon": df["lon"],
            "bbox_area_m2": 0.0,
            "tags": [
                {"arpt_id": a, "city": c if isinstance(c, str) else "", "use": u}
                for a, c, u in zip(df["ARPT_ID"], df["CITY"], df["FACILITY_USE_CODE"])
            ],
        }
    ).reset_index(drop=True)

@lru_cache(maxsize=4)
def _read_nav_base_cached(path: str, _mtime: float) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str)


def _read_nav_base(nav_csv_path) -> pd.DataFrame:
    return _read_nav_base_cached(str(nav_csv_path), Path(nav_csv_path).stat().st_mtime)


def load_vor_navaids(nav_csv_path, bbox: tuple) -> pd.DataFrame:
    """VOR/VOR-DME/VORTAC navaids from the NASR NAV_BASE.csv extract,
    within bbox and currently operational. Replaces the old OSM
    navigationaid-tag-based approach -- the FAA is definitionally the
    authority on its own navaid network.

    Same `_read_apt_base`/`_APT_BASE_CACHE` idea as this file's own
    airport table just above -- collecting more than one route in the
    same process used to re-read and re-parse this national file from
    scratch every time.
    """
    df = _read_nav_base(nav_csv_path)
    df = df[df["NAV_TYPE"].isin(VOR_NAV_TYPES) & df["NAV_STATUS"].str.startswith("OPERATIONAL")]
    df["lat"] = df["LAT_DECIMAL"].astype(float)
    df["lon"] = df["LONG_DECIMAL"].astype(float)
    df = df[_in_bbox(df["lat"], df["lon"], bbox)]
    return pd.DataFrame(
        {
            "osm_id": df["NAV_ID"],
            "osm_type": "faa_navaid",
            "category": "vor",
            "name": df["NAME"] + " " + df["NAV_TYPE"],
            "lat": df["lat"],
            "lon": df["lon"],
            "bbox_area_m2": 0.0,
            "tags": [{"nav_type": t, "nav_id": i} for t, i in zip(df["NAV_TYPE"], df["NAV_ID"])],
        }
    ).reset_index(drop=True)


def _dms_to_decimal(deg: str, minute: str, sec: str, hemisphere: str) -> float:
    value = int(deg) + int(minute) / 60 + float(sec) / 3600
    return -value if hemisphere in ("S", "W") else value


def _parse_dof_line(line: str) -> dict | None:
    if len(line) < 96:
        return None
    fields = {name: line[start:end] for name, (start, end) in _DOF_COLUMNS.items()}
    try:
        lat = _dms_to_decimal(fields["lat_deg"], fields["lat_min"], fields["lat_sec"], fields["lat_hem"])
        lon = _dms_to_decimal(fields["lon_deg"], fields["lon_min"], fields["lon_sec"], fields["lon_hem"])
        agl_ft = int(fields["agl"])
        amsl_ft = int(fields["amsl"])
    except ValueError:
        return None
    return {
        "lat": lat,
        "lon": lon,
        "city": fields["city"].strip(),
        "type": fields["type"].strip(),
        "agl_ft": agl_ft,
        "amsl_ft": amsl_ft,
        "lit": fields["lt"].strip() not in ("", "N"),
    }


_OBSTACLES_CACHE: dict = {}
_OBSTACLES_LOCK = threading.Lock()
_OBSTACLE_CACHE_KEY = b"vfr.dof_key"


def _load_all_obstacles(dof_dat_path) -> pd.DataFrame:
    """Every obstacle in the national DOF.DAT extract, parsed once per
    process and held in memory: from memory, else from the Parquet copy
    beside the file, else parsed from the 640,000-line text (about nine
    seconds) and written back as Parquet, which reads in a fraction of a
    second. The two filters (min_agl_ft, bbox) differ per caller, so
    what's cached is the unfiltered rows; filtering that afterward is a
    cheap pandas boolean mask, not a second file read.
    """
    dof_dat_path = Path(dof_dat_path)
    stat = dof_dat_path.stat()
    key = (str(dof_dat_path), stat.st_size, stat.st_mtime)
    with _OBSTACLES_LOCK:
        if key not in _OBSTACLES_CACHE:
            df = _read_obstacle_cache(dof_dat_path, key)
            if df is None:
                df = _parse_dof(dof_dat_path)
                _write_obstacle_cache(dof_dat_path, key, df)
            _OBSTACLES_CACHE[key] = df
        return _OBSTACLES_CACHE[key]


def _parse_dof(dof_dat_path: Path) -> pd.DataFrame:
    rows = []
    with open(dof_dat_path, encoding="latin-1") as f:
        for line in f:
            parsed = _parse_dof_line(line)
            if parsed is not None:
                rows.append(parsed)
    return pd.DataFrame(rows, columns=["lat", "lon", "city", "type", "agl_ft", "amsl_ft", "lit"])


def _obstacle_cache_path(dof_dat_path: Path) -> Path:
    return dof_dat_path.with_suffix(".parquet")


def _read_obstacle_cache(dof_dat_path: Path, key: tuple) -> pd.DataFrame | None:
    path = _obstacle_cache_path(dof_dat_path)
    if not path.exists():
        return None
    try:
        import pyarrow.parquet as pq
        table = pq.read_table(path)
    except Exception:  # noqa: BLE001 -- no pyarrow here, or a damaged file: parse instead
        return None
    stamp = (table.schema.metadata or {}).get(_OBSTACLE_CACHE_KEY, b"null")
    if json.loads(stamp) != list(key):
        return None
    return table.to_pandas()


def _write_obstacle_cache(dof_dat_path: Path, key: tuple, df: pd.DataFrame) -> None:
    path = _obstacle_cache_path(dof_dat_path)
    part = path.with_suffix(".parquet.part")
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
        table = pa.Table.from_pandas(df, preserve_index=False)
        metadata = {**(table.schema.metadata or {}), _OBSTACLE_CACHE_KEY: json.dumps(key).encode()}
        pq.write_table(table.replace_schema_metadata(metadata), part)
        part.replace(path)
    except (ImportError, OSError):
        # Without pyarrow, or on a read-only data directory, only the
        # speed-up is lost: the parse runs again next process.
        part.unlink(missing_ok=True)


def preload_obstacles(cache_dir) -> None:
    """Parses (or reads back) the obstacle table now, so a service can
    pay the cold cost at startup rather than on a pilot's first request."""
    _load_all_obstacles(ensure_nasr_file("DOF.DAT", cache_dir))


def load_obstacles(dof_dat_path, bbox: tuple, min_agl_ft: float = 200) -> pd.DataFrame:
    """Obstacles from the national DOF.DAT extract, within bbox and at
    least min_agl_ft tall. Replaces the old generic OSM man_made=tower
    category -- the boldmethod checkpoint guide flags plain "towers" as
    blending into terrain, and FAA obstacle height/lighting data lets us
    filter to the ones actually significant enough to have been surveyed
    and registered as an aeronautical obstruction (FAA/Part 77 uses 200ft
    AGL as its own general obstruction-notification threshold, hence the
    default here) rather than guessing from an OSM tag alone.

    The DOF's own typed columns -- lat, lon, city, type, agl_ft, amsl_ft,
    lit -- as the cache holds them. It used to rebuild each row into a
    checkpoint-shaped record with a dict of tags, for candidates the
    pipeline had long stopped collecting, and its one caller unpacked the
    height back out of the dict, ten thousand rows at a time.
    """
    all_obstacles = _load_all_obstacles(dof_dat_path)
    wanted = (all_obstacles["agl_ft"] >= min_agl_ft) & _in_bbox(all_obstacles["lat"], all_obstacles["lon"], bbox)
    return all_obstacles[wanted].reset_index(drop=True)

