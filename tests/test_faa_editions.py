"""vfr.faa_data.refresh_editions: the planner's FAA files fetched again
when the FAA has a newer edition, a zip's files together, and a file on
disk of the current cycle left alone."""
from pathlib import Path

import pytest
from vfr import faa_data

CYCLE_PAGE = "https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/2026-10-01"


def _csv(path: Path, eff_date: str) -> None:
    path.write_text(f'"EFF_DATE","X"\n"{eff_date}","{path.name}"\n')


@pytest.fixture
def faa(monkeypatch, tmp_path):
    """The FAA's pages and zips, as files written into the staging folder;
    the zips fetched, in order, and which ones fail."""
    fetched: list[str] = []
    failing: set[str] = set()
    monkeypatch.setattr(faa_data, "find_current_cycle_page", lambda index: CYCLE_PAGE)

    def link(page, pattern):
        name = {"NAV_CSV": "NAV_CSV", "APT_CSV": "APT_CSV", "FIX_CSV": "FIX_CSV", "class_airspace": "class_airspace_shape_files",
                "DOF_": "DOF_261001"}
        key = next(k for k in name if k in pattern)
        return f"https://faa.example/01_Oct_2026_{name[key]}.zip"

    def download(url, dest, retries=3, only=None):
        fetched.append(url.rsplit("/", 1)[-1])
        if any(f in url for f in failing):
            raise RuntimeError("the FAA's site did not answer")
        for name in only:
            target = dest / ("Shape_Files" if name.startswith("Class_Airspace") else "") / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if name.endswith(".csv"):
                _csv(target, "2026/10/01")
            else:
                target.write_text(f"new {name}")

    monkeypatch.setattr(faa_data, "find_download_link", link)
    monkeypatch.setattr(faa_data, "download_and_extract", download)
    return tmp_path, fetched, failing


def test_a_file_of_the_current_cycle_is_left_and_an_old_one_fetched_with_its_zip(faa):
    folder, fetched, _ = faa
    _csv(folder / "NAV_BASE.csv", "2026/10/01")
    _csv(folder / "FIX_BASE.csv", "2026/10/01")
    # The airports a cycle behind, its remarks current: one zip, fetched whole.
    _csv(folder / "APT_BASE.csv", "2026/09/03")
    _csv(folder / "APT_RMK.csv", "2026/10/01")

    refreshed = faa_data.refresh_editions(folder)

    assert "01_Oct_2026_NAV_CSV.zip" not in fetched and "01_Oct_2026_FIX_CSV.zip" not in fetched
    assert {"APT_BASE.csv", "APT_RMK.csv", "APT_RWY_END.csv"} <= set(refreshed)
    assert faa_data._effective_date(folder / "APT_BASE.csv") == "2026/10/01"
    # No record of the shapes' or the obstacles' edition: fetched once.
    assert (folder / "Shape_Files" / "Class_Airspace.shp").read_text() == "new Class_Airspace.shp"
    assert (folder / "DOF.DAT").read_text() == "new DOF.DAT"
    # And not again while the FAA's are the same.
    fetched.clear()
    assert faa_data.refresh_editions(folder) == [] and fetched == []


def test_one_edition_failing_leaves_the_rest_to_refresh_and_itself_for_next_time(faa):
    folder, fetched, failing = faa
    failing.add("DOF")
    (folder / "DOF.DAT").write_text("old")

    refreshed = faa_data.refresh_editions(folder)

    assert "DOF.DAT" not in refreshed and (folder / "DOF.DAT").read_text() == "old"
    assert "NAV_BASE.csv" in refreshed
    failing.clear()
    fetched.clear()
    assert faa_data.refresh_editions(folder) == ["DOF.DAT"] and fetched == ["01_Oct_2026_DOF_261001.zip"]
