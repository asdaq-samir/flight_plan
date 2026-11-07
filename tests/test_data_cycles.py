"""wingtip.data_cycles: whether each FAA data set the planner uses is
still in its cycle. The rule is the engine's (`data_cycle`), held here to
the shared fixture the engine and the web are held to
(web/src/lib/fixtures/dataCycles.json, its dates from the FAA's 28 and 56
Day Product Schedule, the NASR subscription page and the DOF page); the
module finds each edition on disk and says when one is out of date."""
import json
import logging
from datetime import date, datetime
from pathlib import Path

import pytest

from wingtip import charts, data_cycles, pack, procedures, publications, terrain

FIXTURE = json.loads((Path(__file__).parents[1] / "web/src/lib/fixtures/dataCycles.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: f"{c['kind']}-{c['effective']}@{c['on']}")
def test_the_engines_answer_is_the_fixtures(case):
    effective = date.fromisoformat(case["effective"]) if case["effective"] else None
    got = data_cycles.cycle(case["kind"], effective, date.fromisoformat(case["on"]))
    for key, want in case["expected"].items():
        assert got[key] == want, (key, case["why"])


def test_the_editions_are_read_off_their_names():
    assert data_cycles.chart_effective("10-29-2026") == date(2026, 10, 29)
    assert data_cycles.nasr_effective("2026/10/29") == date(2026, 10, 29)
    assert data_cycles.cifp_effective("261029") == date(2026, 10, 29)
    assert data_cycles.dof_effective("https://aeronav.faa.gov/Obst_Data/DOF_260927.zip") == date(2026, 9, 27)
    assert data_cycles.chart_effective(None) is None and data_cycles.dof_effective("DOF.zip") is None


def test_the_publications_and_procedures_ask_the_engine_for_the_cycle_in_force():
    # The d-TPP's folder for 6 Nov 2026 is AIRAC 2611 (29 Oct 2026); the
    # Chart Supplement's and the charts' edition is 29 Oct 2026's.
    assert publications.dtpp_cycle(date(2026, 11, 6)) == "2611"
    assert publications.dcs_edition(date(2026, 11, 6)) == "29Oct2026"
    assert charts.cycle_from_anchor(date(2026, 11, 6)) == "10-29-2026"
    assert procedures.cifp_start(date(2026, 11, 26)) == date(2026, 11, 26)
    assert procedures.cifp_stale(Path("/x/261001/FAACIFP18"), date(2026, 11, 6))
    assert not procedures.cifp_stale(Path("/x/261029/FAACIFP18"), date(2026, 11, 6))


@pytest.fixture
def on_disk(monkeypatch, tmp_path):
    """A planner's FAA files: NASR of 1 Oct 2026 (one cycle behind on 6 Nov),
    the charts of 29 Oct, the CIFP of 29 Oct, the DOF of 27 Sep and the
    phones' packs of 1 Oct."""
    faa = tmp_path / "faa_nasr"
    faa.mkdir()
    for name, eff in (("APT_BASE.csv", "2026/10/29"), ("FRQ.csv", "2026/10/01")):
        (faa / name).write_text(f'"EFF_DATE","X"\n"{eff}","{name}"\n')
    (faa / "DOF.DAT").write_text("")
    (faa / "editions.json").write_text(json.dumps({"DOF": "https://aeronav.faa.gov/Obst_Data/DOF_260927.zip"}))
    cifp = tmp_path / "cifp" / "261029"
    cifp.mkdir(parents=True)
    (cifp / procedures.CIFP_FILE).write_text("")
    monkeypatch.setattr(terrain, "DEFAULT_FAA_CACHE_DIR", faa)
    monkeypatch.setattr(procedures, "CIFP_DIR", tmp_path / "cifp")
    # The charts row reads the newest complete sectional pyramid on disk.
    monkeypatch.setattr(data_cycles, "_charts_edition", lambda _charts: "10-29-2026")
    monkeypatch.setattr(pack, "phone_index", lambda: {"cycle": "2026-10-01"})
    return tmp_path


def test_status_names_each_data_set_and_the_ones_out_of_date(on_disk):
    found = {e["key"]: e for e in data_cycles.status(date(2026, 11, 6))}
    assert set(found) == {"nasr", "charts", "cifp", "dof", "packs"}
    # NASR is as old as its oldest file: the frequencies are a cycle behind.
    assert found["nasr"]["edition"] == "2026-10-01" and found["nasr"]["state"] == "expired"
    assert found["nasr"]["expires"] == "2026-10-29" and found["nasr"]["behind"] == 1
    assert found["charts"]["state"] == "in_force" and found["charts"]["expires"] == "2026-12-24"
    assert found["cifp"]["state"] == "in_force"
    assert found["dof"]["effective"] == "2026-09-29" and found["dof"]["state"] == "in_force"
    assert found["packs"]["state"] == "expired"
    assert [e["key"] for e in data_cycles.out_of_date(list(found.values()))] == ["nasr", "packs"]


def test_the_owner_is_told_in_the_log_once_a_day(on_disk, caplog, monkeypatch):
    monkeypatch.setattr(data_cycles, "_warned", {"at": 0.0, "said": ""})
    entries = data_cycles.status(date(2026, 11, 6))
    with caplog.at_level(logging.WARNING, logger="wingtip.data_cycles"):
        assert [e["key"] for e in data_cycles.warn_if_out_of_date(entries)] == ["nasr", "packs"]
        data_cycles.warn_if_out_of_date(entries)
    said = [r.getMessage() for r in caplog.records if "past its cycle" in r.getMessage()]
    assert len(said) == 1 and "Airports, frequencies and navaids (2026-10-01, ended 2026-10-29" in said[0]


def test_an_edition_is_chosen_by_the_0901z_it_takes_effect_at(monkeypatch):
    """The engine counts a cycle from 0000Z (safe for a warning); the
    d-TPP, Chart Supplement and CIFP chosen to use wait for 0901Z."""
    class At(datetime):
        hour, minute = 8, 0

        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 29, cls.hour, cls.minute, tzinfo=tz)

    monkeypatch.setattr(data_cycles, "datetime", At)
    assert publications.dtpp_cycle() == "2610"
    assert publications.dcs_edition() == "03Sep2026"
    assert procedures.cifp_start() == date(2026, 10, 1)
    At.hour, At.minute = 9, 2
    assert publications.dtpp_cycle() == "2611"
    assert procedures.cifp_start() == date(2026, 10, 29)
