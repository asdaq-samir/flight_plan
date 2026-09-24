"""The obstacle table's Parquet cache beside DOF.DAT: a fresh process
reads it back instead of re-parsing the national text file, and a new
data cycle rebuilds it."""
import os

import pandas as pd
import pytest

from vfr import faa_data


def _dof_line(city: str, agl: int = 350) -> str:
    """One fixed-column DOF.DAT record, laid out by _DOF_COLUMNS."""
    line = [" "] * 130
    fields = {
        "city": city,
        "lat_deg": "41", "lat_min": "30", "lat_sec": "00.00", "lat_hem": "N",
        "lon_deg": "093", "lon_min": "40", "lon_sec": "00.00", "lon_hem": "W",
        "type": "TOWER", "agl": f"{agl:05d}", "amsl": f"{agl + 1100:05d}", "lt": "R",
    }
    for name, text in fields.items():
        start, end = faa_data._DOF_COLUMNS[name]
        line[start:end] = list(text[: end - start].ljust(end - start))
    return "".join(line) + "\n"


def _write_dof(path, cities) -> None:
    path.write_text("".join(_dof_line(city) for city in cities), encoding="latin-1")


def test_obstacles_round_trip_through_the_parquet_cache(tmp_path, monkeypatch):
    dof = tmp_path / "DOF.DAT"
    _write_dof(dof, ["DES MOINES", "AMES"])
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})

    parsed = faa_data._load_all_obstacles(dof)

    assert list(parsed["city"]) == ["DES MOINES", "AMES"]
    assert parsed["lat"].iloc[0] == pytest.approx(41.5) and parsed["lon"].iloc[0] == pytest.approx(-93.6667, abs=1e-4)
    assert faa_data._obstacle_cache_path(dof).exists()

    # A fresh process: nothing in memory, the Parquet copy answers, and
    # the text file is not walked again.
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})
    monkeypatch.setattr(faa_data, "_parse_dof", lambda path: pytest.fail("parsed instead of reading the cache"))
    cached = faa_data._load_all_obstacles(dof)

    pd.testing.assert_frame_equal(cached, parsed, check_dtype=False)


def test_a_new_dof_cycle_rebuilds_the_cache(tmp_path, monkeypatch):
    dof = tmp_path / "DOF.DAT"
    _write_dof(dof, ["DES MOINES"])
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})
    faa_data._load_all_obstacles(dof)

    # The next cycle: a re-downloaded file with different content.
    _write_dof(dof, ["DES MOINES", "OMAHA"])
    later = os.stat(dof).st_mtime + 100
    os.utime(dof, (later, later))
    parses = []
    real_parse = faa_data._parse_dof
    monkeypatch.setattr(faa_data, "_parse_dof", lambda path: parses.append(path) or real_parse(path))
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})

    rebuilt = faa_data._load_all_obstacles(dof)

    assert parses == [dof]
    assert list(rebuilt["city"]) == ["DES MOINES", "OMAHA"]


# --- each NASR file on its own ---

def test_a_file_already_there_costs_no_download(tmp_path, monkeypatch):
    (tmp_path / "DOF.DAT").write_text("x")
    monkeypatch.setattr(faa_data, "find_current_cycle_page", lambda url: pytest.fail("scraped the NASR index"))
    monkeypatch.setattr(faa_data, "download_and_extract", lambda url, dest: pytest.fail("downloaded"))

    assert faa_data.ensure_nasr_file("DOF.DAT", tmp_path) == tmp_path / "DOF.DAT"


def test_an_evicted_airport_file_fails_only_the_airports(tmp_path, monkeypatch):
    """The three were ensured together: an evicted APT_BASE.csv failed the
    terrain floor, which reads only DOF.DAT."""
    (tmp_path / "DOF.DAT").write_text("x")
    (tmp_path / ".APT_BASE.csv.icloud").write_text("placeholder")
    monkeypatch.setattr(faa_data, "find_current_cycle_page", lambda url: "page")
    monkeypatch.setattr(faa_data, "find_download_link", lambda page, pattern: "https://example/APT_CSV.zip")
    monkeypatch.setattr(faa_data, "download_and_extract", lambda url, dest: None)   # iCloud takes it straight back

    with pytest.raises(RuntimeError, match="iCloud evicted APT_BASE.csv"):
        faa_data.ensure_nasr_file("APT_BASE.csv", tmp_path)
    assert faa_data.ensure_nasr_file("DOF.DAT", tmp_path) == tmp_path / "DOF.DAT"


def test_the_three_together_keep_their_order(tmp_path):
    for name in ("NAV_BASE.csv", "APT_BASE.csv", "DOF.DAT"):
        (tmp_path / name).write_text("x")
    assert faa_data.ensure_nasr_data(tmp_path) == (
        tmp_path / "NAV_BASE.csv", tmp_path / "APT_BASE.csv", tmp_path / "DOF.DAT",
    )
