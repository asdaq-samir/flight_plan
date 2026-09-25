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
import json
import re
import threading
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


@lru_cache(maxsize=8)\ndef _read_apt_base_cached(path: str, mtime: float) -> pd.DataFrame:\n    return pd.read_csv(path, dtype=str, low_memory=False)\n\n\ndef _read_apt_base(apt_csv_path) -> pd.DataFrame:
    """APT_BASE.csv, parsed once per file version per process."""
    path = Path(apt_csv_path)
    return _read_apt_base_cached(str(path), path.stat().st_mtime)

