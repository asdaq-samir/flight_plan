"""FAA NASR navaid data and Digital Obstacle File (DOF) data -- more
authoritative sources than OSM tags for VOR navaids and towers/obstacles,
since the FAA is the ground truth for both (and this project already
treats the FAA sectional chart, not OSM/satellite imagery, as the
reference for what a pilot would see -- see vfr.chartvision).

Both are published as a full national dump (not queryable by bbox
server-side, unlike Overpass) -- NASR on a 28-day cycle, the obstacles
every 56 days -- so they're downloaded and cached under data/raw/ rather
than re-fetched every notebook run: ensure_nasr_file() downloads a file
that is missing, and refresh_editions() a newer edition of one there.
"""
import csv
import io
import json
import logging
import os
import re
import tempfile
import threading
import zipfile
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import urljoin

import numpy as np
import pandas as pd
import requests

# FAA's site 403s a bare python-requests User-Agent.
from .config import FAA_HEADERS
from .retry import with_retries
from .once import once

log = logging.getLogger(__name__)

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


def download_and_extract(url: str, dest_dir: Path, retries: int = 3, only: Iterable[str] | None = None) -> None:
    """Downloads the zip at url and extracts it into dest_dir, retrying
    on transient failures -- the FAA's NASR/DOF archives are large enough
    that a single flaky connection isn't unusual.

    With `only`, just the members of those names: the DOF archive carries
    a file per state beside the whole country's DOF.DAT, and the NASR
    ones a dozen tables and their layouts the planner never reads -- 190
    MB of the 950 under data/raw/faa_nasr, extracted for nothing."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only) if only is not None else None

    def attempt() -> None:
        resp = requests.get(url, headers=FAA_HEADERS, timeout=180)
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            members = zf.namelist() if wanted is None else [m for m in zf.namelist() if Path(m).name in wanted]
            zf.extractall(dest_dir, members=members)

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
    # In the same zip as APT_BASE: every airport's remarks, the Chart
    # Supplement's own text (vfr.remarks).
    "APT_RMK.csv": lambda: find_download_link(find_current_cycle_page(NASR_INDEX_URL), r'href="([^"]*APT_CSV\.zip)"'),
    # And each runway end's: which way its traffic pattern is flown
    # (vfr.pattern).
    "APT_RWY_END.csv": lambda: find_download_link(find_current_cycle_page(NASR_INDEX_URL), r'href="([^"]*APT_CSV\.zip)"'),
    # And each field's contacts: its manager's and its owner's office
    # address and phone, what an airport's card calls and finds in Maps.
    "APT_CON.csv": lambda: find_download_link(find_current_cycle_page(NASR_INDEX_URL), r'href="([^"]*APT_CSV\.zip)"'),
    "DOF.DAT": lambda: find_download_link(DOF_INDEX_URL, r'href="(https://aeronav\.faa\.gov/Obst_Data/DOF_\d+\.zip)"'),
    # Every named fix: the RNAV (GPS) waypoints, the reporting points and
    # the VFR waypoints charted on the sectionals (VPBNG) -- what a route
    # may fly through on the way (vfr.fixes).
    "FIX_BASE.csv": lambda: find_download_link(find_current_cycle_page(NASR_INDEX_URL), r'href="([^"]*FIX_CSV\.zip)"'),
    # Every facility's frequencies, by the field each serves: the CTAF,
    # UNICOM, tower, ground, ATIS and approach the Chart Supplement lists
    # (airport_frequencies).
    "FRQ.csv": lambda: find_download_link(find_current_cycle_page(NASR_INDEX_URL), r'href="([^"]*FRQ_CSV\.zip)"'),
    # Every airway segment, Victor and T routes among them, in order, each
    # with its MEA, MOCA and MAA (vfr.airways).
    "AWY_SEG_ALT.csv": lambda: find_download_link(find_current_cycle_page(NASR_INDEX_URL), r'href="([^"]*AWY_CSV\.zip)"'),
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
        download_and_extract(_NASR_FILES[name](), cache_dir, only=_NASR_FILES)
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


# The zips the files above come in, for a new edition of each (refresh):
# its files, the page its link is on (None: the current NASR cycle's), and
# the link. A zip's files are refreshed together -- APT_BASE was a cycle
# behind APT_RMK and APT_RWY_END from the same zip, each fetched when it
# went missing (2026-10-07).
_EDITIONS = {
    "NAV_CSV": (("NAV_BASE.csv",), None, r'href="([^"]*NAV_CSV\.zip)"'),
    "APT_CSV": (("APT_BASE.csv", "APT_RMK.csv", "APT_RWY_END.csv", "APT_CON.csv"), None, r'href="([^"]*APT_CSV\.zip)"'),
    "FIX_CSV": (("FIX_BASE.csv",), None, r'href="([^"]*FIX_CSV\.zip)"'),
    "FRQ_CSV": (("FRQ.csv",), None, r'href="([^"]*FRQ_CSV\.zip)"'),
    "AWY_CSV": (("AWY_SEG_ALT.csv",), None, r'href="([^"]*AWY_CSV\.zip)"'),
    # The Class B, C and D shapes (vfr.airspace), from the same cycle.
    "Class_Airspace": (
        # The .shp last, which vfr.airspace keys its parse on: its
        # companions are in place before it.
        ("Shape_Files/Class_Airspace.shx", "Shape_Files/Class_Airspace.dbf", "Shape_Files/Class_Airspace.shp"),
        None, r'href="([^"]*class_airspace_shape_files\.zip)"',
    ),
    # The obstacles, on their own 56-day edition and page.
    "DOF": (("DOF.DAT",), DOF_INDEX_URL, r'href="(https://aeronav\.faa\.gov/Obst_Data/DOF_\d+\.zip)"'),
}
# Which edition each file on disk is, by the link it came from (the
# FAA's links name their cycle: ".../01_Oct_2026_NAV_CSV.zip").
_EDITIONS_FILE = "editions.json"


def _editions_on_disk(cache_dir: Path) -> dict:
    try:
        return json.loads((cache_dir / _EDITIONS_FILE).read_text())
    except (OSError, ValueError):
        return {}


def _effective_date(path: Path) -> str | None:
    """A NASR CSV's own cycle, its first row's EFF_DATE ("2026/10/01")."""
    try:
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            return next(csv.DictReader(f)).get("EFF_DATE")
    except (OSError, StopIteration):
        return None


def refresh_editions(cache_dir) -> list[str]:
    """Each of the planner's FAA zips fetched again where the FAA has a
    newer edition than the one on disk -- a NASR cycle every 28 days, the
    obstacle file every 56 -- its files put in place whole, one by one,
    and the names refreshed. They were fetched only when missing, and
    went on being read cycles old: the navaids two cycles, the airports
    one (2026-10-07). Every reader of them keys its cache by the file's
    mtime (vfr.fixes, vfr.airspace, vfr.remarks, vfr.pattern and this
    module's), so a refreshed file is read again where it is next asked
    for. A zip whose download fails is left as it was, for the next
    check. A file on disk with no record of its edition is taken as the
    current one where its own EFF_DATE says so, rather than fetched again."""
    cache_dir = Path(cache_dir)
    on_disk = _editions_on_disk(cache_dir)
    cycle_page = find_current_cycle_page(NASR_INDEX_URL)
    cycle = cycle_page.rstrip("/").rsplit("/", 1)[-1].replace("-", "/")
    refreshed = []
    for key, (names, page, pattern) in _EDITIONS.items():
        try:
            url = find_download_link(page or cycle_page, pattern)
            paths = [cache_dir / name for name in names]
            if on_disk.get(key) == url and all(p.exists() for p in paths):
                continue
            if page is None and key != "Class_Airspace" and all(_effective_date(p) == cycle for p in paths):
                on_disk[key] = url
                continue
            with tempfile.TemporaryDirectory(dir=cache_dir, prefix=".edition-") as staging:
                download_and_extract(url, Path(staging), only={Path(name).name for name in names})
                for name in names:
                    fresh = next(Path(staging).rglob(Path(name).name), None)
                    if fresh is None:
                        raise RuntimeError(f"{name} is not in {url}")
                    (cache_dir / name).parent.mkdir(parents=True, exist_ok=True)
                    os.replace(fresh, cache_dir / name)
            on_disk[key] = url
            refreshed.extend(names)
            log.info("FAA %s refreshed from %s", key, url)
        except Exception:  # noqa: BLE001 -- one edition failing leaves the rest to refresh, and itself to the next check
            log.warning("FAA %s not refreshed", key, exc_info=True)
    (cache_dir / _EDITIONS_FILE).write_text(json.dumps(on_disk, indent=1, sort_keys=True))
    return refreshed


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


@once(maxsize=2)
def _read_apt_base_cached(path: str, _mtime: float) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, low_memory=False)


def _read_apt_base(apt_csv_path) -> pd.DataFrame:
    """APT_BASE.csv, parsed once per file version, like NAV_BASE below.

    It is a large national table and a route request only ever wants a
    bounding box out of it, so re-reading it per call was 2.1 s of pure
    waste -- and on a streamed route that was the whole time-to-first
    result, since airports are the cheap thing shown first. Keyed by
    mtime too, so a new NASR cycle is read without a restart; two
    entries, so the one it replaces is dropped rather than held.
    """
    return _read_apt_base_cached(str(apt_csv_path), Path(apt_csv_path).stat().st_mtime)


#: A field's traffic pattern above it where the FAA publishes none: AC
#: 90-66C's 1,000 ft for a propeller aeroplane (1,500 for a large or
#: turbine one, which no profile here is).
PATTERN_AGL_FT = 1000.0


@once(maxsize=2)
def _patterns_of(path: str, _mtime: float) -> dict:
    df = _read_apt_base_cached(path, _mtime)
    df = df[df["TPA"].notna() & (df["TPA"].str.strip() != "")]
    by_ident = {}
    for arpt_id, icao_id, tpa in zip(df["ARPT_ID"], df["ICAO_ID"], df["TPA"]):
        for ident in (arpt_id, icao_id):
            if isinstance(ident, str) and ident.strip():
                by_ident[ident.strip().upper()] = float(tpa)
    return by_ident


def published_pattern_agl_ft(ident: str, cache_dir) -> float | None:
    """APT_BASE's TPA, in feet above the field, where the FAA publishes
    one (about one field in twenty-five, often 800 ft under a Class B
    shelf), by its FAA or ICAO identifier; None where it does not -- and
    where the file cannot be had, since a nav log's top of descent is no
    reason to fail it."""
    try:
        path = ensure_nasr_file("APT_BASE.csv", cache_dir)
        patterns = _patterns_of(str(path), path.stat().st_mtime)
    except Exception:
        log.warning("No APT_BASE.csv for pattern altitudes; %s gets none published", ident, exc_info=True)
        return None
    return patterns.get(ident.strip().upper())


#: APT_BASE's OWNERSHIP_TYPE_CODE for a field the armed services own: the
#: Air Force's (MA), the Navy's (MN), the Army's (MR) and the Coast
#: Guard's (CG).
MILITARY_OWNERS = frozenset({"MA", "MN", "MR", "CG"})


@once(maxsize=2)
def _military_of(path: str, _mtime: float) -> dict:
    df = _read_apt_base_cached(path, _mtime)
    df = df[df["OWNERSHIP_TYPE_CODE"].isin(MILITARY_OWNERS)]
    by_ident = {}
    for arpt_id, icao_id, use in zip(df["ARPT_ID"], df["ICAO_ID"], df["FACILITY_USE_CODE"]):
        # Open to the public as well (FACILITY_USE_CODE PU): a joint-use
        # field, a civil airport on a military one (Libby AAF and Sierra
        # Vista Municipal), where a civil pilot may land.
        kind = "joint" if use == "PU" else "military"
        for ident in (arpt_id, icao_id):
            if isinstance(ident, str) and ident.strip():
                by_ident[ident.strip().upper()] = kind
    return by_ident


def military_fields(cache_dir) -> dict:
    """Every field the armed services own (APT_BASE's OWNERSHIP_TYPE_CODE,
    MILITARY_OWNERS), by its FAA and ICAO identifiers: "military" where it
    is not open to the public -- a civil airplane lands there only with
    the service's permission, for the Air Force a Civil Aircraft Landing
    Permit (32 CFR part 855) -- and "joint" where it is (FACILITY_USE_CODE
    PU). Empty where the file cannot be had: the map then marks none."""
    try:
        path = ensure_nasr_file("APT_BASE.csv", cache_dir)
        return _military_of(str(path), path.stat().st_mtime)
    except Exception:
        log.warning("No APT_BASE.csv for military fields; none marked", exc_info=True)
        return {}


@once(maxsize=2)
def _private_of(path: str, _mtime: float) -> frozenset:
    df = _read_apt_base_cached(path, _mtime)
    df = df[(df["FACILITY_USE_CODE"] == "PR") & ~df["OWNERSHIP_TYPE_CODE"].isin(MILITARY_OWNERS)]
    return frozenset(
        ident.strip().upper() for ident in [*df["ARPT_ID"], *df["ICAO_ID"]] if isinstance(ident, str) and ident.strip()
    )


def private_fields(cache_dir) -> frozenset:
    """Every field closed to the public (APT_BASE's FACILITY_USE_CODE PR),
    by its FAA and ICAO identifiers -- the sectional's R in a circle, a
    field to land at only with its owner's permission -- but for those the
    armed services own, which are military_fields'. Empty where the file
    cannot be had: the map then marks none."""
    try:
        path = ensure_nasr_file("APT_BASE.csv", cache_dir)
        return _private_of(str(path), path.stat().st_mtime)
    except Exception:
        log.warning("No APT_BASE.csv for private fields; none marked", exc_info=True)
        return frozenset()


#: A box number, not a street a pilot can be driven to.
_PO_BOX = re.compile(r"^\s*P\.?\s*O\.?\s*BOX\b", re.IGNORECASE)


def _street_case(text: str) -> str:
    """The FAA's capitals set as an address is written: "2627 HOLLYWOOD
    WAY" as "2627 Hollywood Way", its compass points (NE) and ordinals
    (1st) as they are written."""
    words = text.strip().title()
    words = re.sub(r"\b(Ne|Nw|Se|Sw)\b", lambda m: m.group(1).upper(), words)
    return re.sub(r"(\d)(St|Nd|Rd|Th)\b", lambda m: m.group(1) + m.group(2).lower(), words)


def _address_of(row) -> str | None:
    """One line a map can find: the street (not a box number), the town,
    the state and the ZIP code -- None where it has no street."""
    street = next((a for a in (row["ADDRESS1"], row["ADDRESS2"]) if a.strip() and not _PO_BOX.match(a)), None)
    if not street:
        return None
    town = _street_case(row["TITLE_CITY"]) if row["TITLE_CITY"].strip() else None
    place = " ".join(p for p in (row["STATE"].strip(), row["ZIP_CODE"].strip()) if p)
    return ", ".join(p for p in (_street_case(street), town, place) if p)


@once(maxsize=2)
def _contacts_of(path: str, _mtime: float, base: str, _base_mtime: float) -> dict:
    try:
        con = pd.read_csv(path, dtype=str, low_memory=False, keep_default_na=False)
    except UnicodeDecodeError:
        # The 2026-10-29 edition has a byte that is no UTF-8 (0xA0, a
        # no-break space in Windows' code page): read as UTF-8 alone, the
        # whole file failed and every card lost its phone and address.
        con = pd.read_csv(path, dtype=str, low_memory=False, keep_default_na=False, encoding="cp1252")
    # The manager's first, the airport's own office as a rule, and the
    # owner's where there is no manager -- a county's or a company's.
    rank = {"MANAGER": 0, "OWNER": 1}
    con = con[con["TITLE"].isin(rank)].assign(rank=lambda d: d["TITLE"].map(rank)).sort_values("rank", kind="stable")
    by_id: dict = {}
    for row in con.to_dict("records"):
        mine = by_id.setdefault(row["ARPT_ID"].strip().upper(), {"phone": None, "address": None})
        if mine["phone"] is None and row["PHONE_NO"].strip():
            mine["phone"] = row["PHONE_NO"].strip()
        if mine["address"] is None:
            mine["address"] = _address_of(row)
    # And by the ICAO identifier pilots use (KBUR for BUR), from APT_BASE.
    apt = _read_apt_base_cached(base, _base_mtime)
    for arpt_id, icao_id in zip(apt["ARPT_ID"], apt["ICAO_ID"]):
        if isinstance(icao_id, str) and icao_id.strip() and isinstance(arpt_id, str) and arpt_id.strip().upper() in by_id:
            by_id.setdefault(icao_id.strip().upper(), by_id[arpt_id.strip().upper()])
    return by_id


def airport_contact(ident: str, cache_dir) -> dict:
    """How to reach a field on the ground, from the FAA's own airport file
    (NASR's APT_CON, the contacts the Chart Supplement is made from): a
    phone and a one-line street address, the manager's first and the
    owner's where there is none, by its FAA or ICAO identifier -- no
    names. Each None where the FAA lists none (a box number is no
    address), and both where the file cannot be had: a card without them,
    not a card that failed."""
    try:
        path = ensure_nasr_file("APT_CON.csv", cache_dir)
        base = ensure_nasr_file("APT_BASE.csv", cache_dir)
        contacts = _contacts_of(str(path), path.stat().st_mtime, str(base), base.stat().st_mtime)
    except Exception:
        log.warning("No APT_CON.csv for airport contacts; %s gets none", ident, exc_info=True)
        return {"phone": None, "address": None}
    return contacts.get(ident.strip().upper(), {"phone": None, "address": None})


#: NASR's repair codes a pilot reads as service: "NONE" and blank are none.
_REPAIRS = {"MAJOR": "major", "MINOR": "minor"}
NO_SERVICES = {"fuel_types": [], "landing_fee": None, "tie_down": False, "hangar": False,
               "airframe_repair": None, "powerplant_repair": None, "oxygen": False}


@once(maxsize=2)
def _services_of(base: str, _mtime: float) -> dict:
    apt = _read_apt_base_cached(base, _mtime).fillna("")
    by_id: dict = {}
    for row in apt.to_dict("records"):
        flag = row["LNDG_FEE_FLAG"].strip()
        services = {
            "fuel_types": [t.strip() for t in row["FUEL_TYPES"].split(",") if t.strip()],
            "landing_fee": True if flag == "Y" else False if flag == "N" else None,
            "tie_down": row["TRNS_STRG_TIE_FLAG"].strip() == "Y",
            "hangar": row["TRNS_STRG_HGR_FLAG"].strip() == "Y",
            "airframe_repair": _REPAIRS.get(row["AIRFRAME_REPAIR_SER_CODE"].strip()),
            "powerplant_repair": _REPAIRS.get(row["PWR_PLANT_REPAIR_SER"].strip()),
            "oxygen": any(row[c].strip() not in ("", "NONE") for c in ("BOTTLED_OXY_TYPE", "BULK_OXY_TYPE")),
        }
        by_id[row["ARPT_ID"].strip().upper()] = services
        if row["ICAO_ID"].strip():
            by_id.setdefault(row["ICAO_ID"].strip().upper(), services)
    return by_id


def airport_services(ident: str, cache_dir) -> dict:
    """What a field offers on the ground, as its Chart Supplement entry
    lists it (NASR's APT_BASE): the fuel it sells, whether it charges a
    landing fee (None where the FAA does not say), tie-downs and hangars
    for a transient, airframe and engine repair ("major", "minor" or
    None) and oxygen, by its FAA or ICAO identifier. Nothing where the
    file cannot be had: a card without them, not a card that failed."""
    try:
        base = ensure_nasr_file("APT_BASE.csv", cache_dir)
        services = _services_of(str(base), base.stat().st_mtime)
    except Exception:
        log.warning("No APT_BASE.csv for airport services; %s gets none", ident, exc_info=True)
        return dict(NO_SERVICES)
    return services.get(ident.strip().upper(), dict(NO_SERVICES))


# NASR's FREQ_USE for what a VFR pilot calls on, as the card's types
# (lib/frequencies) name them; the rest -- emergency, military command
# posts, operations, dispatch, the navaids' own -- are left off.
_FREQUENCY_USES = {
    "CTAF": "CTAF", "UNICOM": "UNICOM",
    "LCL/P": "TWR", "LCL/S": "TWR",
    "GND/P": "GND", "GND/S": "GND",
    "CD/P": "CLD", "CD/S": "CLD", "CD": "CLD",
    "ATIS": "ATIS", "D-ATIS": "ATIS",
    "APCH/P DEP/P": "A/D", "APCH/S DEP/S": "A/D", "APCH/P DEP/P IC": "A/D",
    "APCH/P": "APP", "APCH/S": "APP", "APCH/P IC": "APP",
    "DEP/P": "DEP", "DEP/S": "DEP",
    # Who to call before a Class B, C or a TRSA, and its sector.
    "CLASS B": "APP", "CLASS C": "APP", "TRSA": "APP",
}
#: The civil aviation VHF band, MHz: what a light airplane's radio tunes.
_VHF = (118.0, 137.0)


def _name_case(text: str) -> str:
    """A facility's name in the FAA's capitals as a name is written:
    "CHICAGO" as "Chicago", "DULUTH RCO" as "Duluth RCO"."""
    return " ".join(w if w in ("RCO", "TWR") else w.capitalize() for w in text.split())


def _sector_case(text: str, idents: frozenset = frozenset()) -> str:
    """A sector as the Chart Supplement gives it, its words in lower case
    and its codes kept -- bearings ("360-179"), runways ("RWY 04R/22L"),
    idents of three letters ("VNY 280-BUR 050, north") and an airport's
    own ICAO ident ("KBUR 050"), which `idents` names."""
    return re.sub(r"[A-Z]{4,}", lambda m: m.group(0) if m.group(0) in idents else m.group(0).lower(), text.strip())


@once(maxsize=2)
def _frequencies_of(path: str, _mtime: float, base: str, _base_mtime: float) -> tuple[dict, frozenset]:
    """FRQ.csv's frequencies by the field they serve, by its FAA and its
    ICAO identifier: [{"type", "description", "frequency_mhz"}]; and the
    FAA identifiers of the fields that have no ICAO identifier of their
    own, the only ones a "K" is OurAirports' addition to."""
    frq = pd.read_csv(path, dtype=str, low_memory=False, keep_default_na=False)
    apt = _read_apt_base_cached(base, _base_mtime)
    idents = frozenset(i.strip().upper() for i in apt["ICAO_ID"] if isinstance(i, str) and i.strip())
    by_id: dict = {}
    for row in frq.to_dict("records"):
        use = row["FREQ_USE"].strip().upper()
        kind = _FREQUENCY_USES.get(use)
        if kind is None and use.endswith(" RCO"):
            # A Flight Service remote outlet near the field, named for it.
            kind = "RCO"
        try:
            mhz = float(row["FREQ"])
        except ValueError:
            continue
        if kind is None or not _VHF[0] <= mhz < _VHF[1]:
            continue
        # Who answers and the sector, as the Chart Supplement sets them:
        # the approach control's name for an approach ("CHICAGO 360-179"),
        # the tower's for the tower, ground and clearance ("O HARE"). A
        # Class B's or C's own words where it is one.
        approach = kind in ("APP", "DEP", "A/D")
        call = (row["PRIMARY_APPROACH_RADIO_CALL"] if approach else row["TOWER_OR_COMM_CALL"]).strip()
        words = " ".join(w for w in (
            {"CLASS B": "Class B", "CLASS C": "Class C", "TRSA": "TRSA"}.get(use, ""),
            _name_case(use) if kind == "RCO" else "",
            _name_case(call) if kind in ("APP", "DEP", "A/D", "TWR", "GND", "CLD") else "",
            _sector_case(row["SECTORIZATION"], idents),
        ) if w)
        entries = by_id.setdefault(row["SERVICED_FACILITY"].strip().upper(), [])
        entry = {"type": kind, "description": words or None, "frequency_mhz": mhz}
        if entry not in entries:
            entries.append(entry)
    # A CTAF and a UNICOM on one frequency are one row, as the Chart
    # Supplement writes them: "CTAF/UNICOM 123.0"; and a Class B's or C's
    # frequency that is also the approach's sector is that sector's row
    # alone (Madison's 120.1, both "MADISON EAST" and "CLASS C").
    for entries in by_id.values():
        ctaf = {e["frequency_mhz"] for e in entries if e["type"] == "CTAF"}
        approach = {e["frequency_mhz"] for e in entries if e["type"] in ("A/D", "DEP") or (
            e["type"] == "APP" and not (e["description"] or "").startswith(("Class", "TRSA")))}
        for e in entries:
            if e["type"] == "CTAF" and any(u["type"] == "UNICOM" and u["frequency_mhz"] == e["frequency_mhz"] for u in entries):
                e["description"] = "CTAF/UNICOM"
        entries[:] = [e for e in entries if not (
            (e["type"] == "UNICOM" and e["frequency_mhz"] in ctaf)
            or ((e["description"] or "").startswith(("Class", "TRSA")) and e["frequency_mhz"] in approach))]
    for arpt_id, icao_id in zip(apt["ARPT_ID"], apt["ICAO_ID"]):
        if isinstance(icao_id, str) and icao_id.strip() and isinstance(arpt_id, str) and arpt_id.strip().upper() in by_id:
            by_id.setdefault(icao_id.strip().upper(), by_id[arpt_id.strip().upper()])
    no_icao = frozenset(
        a.strip().upper() for a, i in zip(apt["ARPT_ID"], apt["ICAO_ID"])
        if isinstance(a, str) and not (isinstance(i, str) and i.strip()))
    return by_id, no_icao


def _frequency_table(cache_dir) -> tuple[dict, frozenset] | None:
    """FRQ.csv's frequencies by field (_frequencies_of), or None where the
    file cannot be had, for the caller's own fallback."""
    try:
        path = ensure_nasr_file("FRQ.csv", cache_dir)
        base = ensure_nasr_file("APT_BASE.csv", cache_dir)
        return _frequencies_of(str(path), path.stat().st_mtime, str(base), base.stat().st_mtime)
    except Exception:  # noqa: BLE001 -- the FAA out or the file damaged: the caller's own list instead
        log.warning("No FRQ.csv for frequencies; the fallback is used", exc_info=True)
        return None


def _listed(table: tuple[dict, frozenset], ident: str) -> list[dict] | None:
    """A field's frequencies by the ident asked for, or by its FAA one
    under a "K" OurAirports puts before it: the card asks for Campbell
    Airport as KC81, which the FAA files as C81 and gives no ICAO ident.
    Only a field with no ICAO ident of its own is taken that way, so a
    real ICAO ident the file lacks (KXYZ, no frequencies) never reads
    another airport's list, the one filed as XYZ."""
    by_id, no_icao = table
    ident = ident.strip().upper()
    found = by_id.get(ident)
    if not found and len(ident) == 4 and ident.startswith("K") and ident[1:] in no_icao:
        found = by_id.get(ident[1:])
    return found


def airport_frequencies_for(idents, cache_dir) -> dict[str, list[dict]]:
    """airport_frequencies for several fields from one look at the file
    (one fetch, one warning where it cannot be had), by ident as given,
    upper-cased; the fields the file lists nothing for are left out."""
    table = _frequency_table(cache_dir)
    if table is None:
        return {}
    wanted = {i.strip().upper() for i in idents}
    found = {i: _listed(table, i) for i in wanted}
    return {i: [dict(f) for f in listed] for i, listed in found.items() if listed}


def airport_frequencies(ident: str, cache_dir) -> list[dict] | None:
    """A field's frequencies from the FAA's own file (NASR's FRQ, what
    the Chart Supplement and the sectional's airport data are made from),
    by its FAA or ICAO identifier: its CTAF and UNICOM, tower, ground,
    clearance, ATIS, the approach and departure that serve it (with their
    sectors) and the Flight Service outlets named for it, each a VHF
    frequency, as [{"type", "description", "frequency_mhz"}]. OurAirports'
    copy, which the card read, had none for Salem (I83), whose 123.0 is on
    the chart. None where the file cannot be had or lists nothing for the
    field, for the caller's own fallback."""
    table = _frequency_table(cache_dir)
    found = _listed(table, ident) if table else None
    return [dict(f) for f in found] if found else None


def pattern_agl_ft(ident: str, cache_dir) -> float:
    """How high above the field its traffic pattern is flown: the TPA
    the FAA publishes (published_pattern_agl_ft), else PATTERN_AGL_FT."""
    published = published_pattern_agl_ft(ident, cache_dir)
    return PATTERN_AGL_FT if published is None else published


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
    fields, lat, lon, ident, icao = _charted_open_airports(str(apt_csv_path), Path(apt_csv_path).stat().st_mtime)
    min_lat, min_lon, max_lat, max_lon = bbox
    inside = (lat >= min_lat) & (lat <= max_lat) & (lon >= min_lon) & (lon <= max_lon)

    excluded = {i.strip().upper() for i in exclude_idents}
    if excluded:
        at = np.flatnonzero(inside)
        inside[at[[a in excluded or c in excluded for a, c in zip(ident[at], icao[at])]]] = False

    found = fields[inside].reset_index(drop=True)
    # Each its own tags, as when they were made for each call: a caller
    # may add to a candidate's.
    return found.assign(tags=[dict(t) for t in found["tags"]])


@once(maxsize=2)
def _charted_open_airports(path: str, _mtime: float) -> tuple:
    """APT_BASE's charted, open fields as load_route_airports gives them,
    with their positions and upper-cased identifiers to pick them by, once
    per file version as the table itself is (`_read_apt_base`): made again
    on every route's checkpoints -- the type mapped, matched and the
    status compared over all 19,400 rows, two columns turned to numbers
    and each name title-cased -- it was a second of the planner's time
    each call while other threads held the interpreter, where only the box
    and the route's own two fields are the route's (py-spy on the live
    planner, 2026-10-28)."""
    df = _read_apt_base_cached(path, _mtime)
    df = df[
        df["SITE_TYPE_CODE"].map(_SITE_TYPE_NAMES).isin(CHARTED_FACILITY_TYPES)
        & (df["ARPT_STATUS"] == "O")
    ]
    lat = df["LAT_DECIMAL"].astype(float)
    lon = df["LONG_DECIMAL"].astype(float)
    fields = pd.DataFrame(
        {
            "osm_id": df["ARPT_ID"],
            "osm_type": "faa_airport",
            "category": "airport",
            # The chart labels a field by name and identifier, so the
            # candidate carries both -- that is what you read off it.
            "name": df["ARPT_NAME"].str.title() + " (" + df["ARPT_ID"] + ")",
            "lat": lat,
            "lon": lon,
            "bbox_area_m2": 0.0,
            "tags": [
                {"arpt_id": a, "city": c if isinstance(c, str) else "", "use": u}
                for a, c, u in zip(df["ARPT_ID"], df["CITY"], df["FACILITY_USE_CODE"])
            ],
        }
    )
    return (fields, lat.to_numpy(), lon.to_numpy(), df["ARPT_ID"].str.upper().to_numpy(dtype=object),
            df["ICAO_ID"].fillna("").str.upper().to_numpy(dtype=object))


# APT_BASE encodes the facility type as a single letter.
_SITE_TYPE_NAMES = {
    "A": "AIRPORT",
    "B": "BALLOONPORT",
    "C": "SEAPLANE BASE",
    "G": "GLIDERPORT",
    "H": "HELIPORT",
    "U": "ULTRALIGHT",
}


def _in_bbox(lat: pd.Series, lon: pd.Series, bbox: tuple) -> pd.Series:
    min_lat, min_lon, max_lat, max_lon = bbox
    return lat.between(min_lat, max_lat) & lon.between(min_lon, max_lon)


@once(maxsize=4)
def _read_nav_base_cached(path: str, _mtime: float) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str)


def _read_nav_base(nav_csv_path) -> pd.DataFrame:
    return _read_nav_base_cached(str(nav_csv_path), Path(nav_csv_path).stat().st_mtime)


def load_vor_navaids(nav_csv_path, bbox: tuple) -> pd.DataFrame:
    """VOR/VOR-DME/VORTAC navaids from the NASR NAV_BASE.csv extract,
    within bbox and currently operational. Replaces the old OSM
    navigationaid-tag-based approach -- the FAA is definitionally the
    authority on its own navaid network.

    Same once-per-file-version read as this file's own airport table
    (`_read_apt_base`) -- collecting more than one route in the
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
