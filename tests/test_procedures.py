"""vfr.procedures: an airport's instrument procedures from the FAA's CIFP,
read from KBUR's records of the 1 Oct 2026 cycle (tests/cifp, with the
navaids and enroute fixes they name) -- the ILS Y RWY 08 via LAX a pilot
asked to see drawn as ForeFlight draws it."""
import dataclasses
from datetime import date
from pathlib import Path

import pytest

from vfr import geo, procedures

CIFP = Path(__file__).parent / "cifp" / "FAACIFP18"

LAX = (33.93315, -118.432014)
SILEX = (34.201058, -118.611636)
RW08 = (34.197911, -118.369142)
VTU = (34.115064, -119.0495)


@pytest.fixture(autouse=True)
def _cifp(monkeypatch):
    monkeypatch.setattr(procedures, "cifp_path", lambda on=None: CIFP)


def near(a, b, nm=0.01):
    return geo.distance_nm(*a, *b) < nm


def test_the_cycle_is_the_airac_one_in_force():
    assert procedures.cifp_start(date(2026, 10, 10)) == date(2026, 10, 1)
    assert procedures.cifp_start(date(2026, 10, 29)) == date(2026, 10, 29)
    assert procedures.CIFP_URL.format(start=date(2026, 10, 1)).endswith("/CIFP_261001.zip")


def test_a_fields_procedures_are_listed_approaches_first_by_their_charts_names():
    found = procedures.procedures_at("KBUR")
    assert found["airport"] == "KBUR" and found["cycle"] == f"{procedures.cifp_start():%y%m%d}"
    listed = found["procedures"]
    kinds = [p["kind"] for p in listed]
    assert kinds == sorted(kinds, key=["approach", "arrival", "departure"].index)
    ils = next(p for p in listed if p["id"] == "I08-Y")
    assert ils == {
        "kind": "approach", "id": "I08-Y", "name": "ILS Y RWY 08", "runway": "08",
        "transitions": ["LAX", "MIKEI", "SMO", "TOAKS", "VNY", "VTU"], "runway_transitions": [],
    }
    assert next(p for p in listed if p["id"] == "H08-Y")["name"] == "RNAV (RNP) Y RWY 08"
    janny = next(p for p in listed if p["id"] == "JANNY5")
    assert janny["kind"] == "arrival" and janny["runway_transitions"] == ["RW08"] and "EED" in janny["transitions"]
    # By the FAA's own ident too; none for a field the file does not have.
    assert procedures.procedures_at("BUR")["airport"] == "KBUR"
    assert procedures.procedures_at("KXYZ") is None


@pytest.mark.parametrize(("kind", "ident", "name"), [
    ("approach", "I08-Y", "ILS Y RWY 08"),
    ("approach", "R26LY", "RNAV (GPS) Y RWY 26L"),
    ("approach", "L08", "LOC RWY 08"),
    ("approach", "VDM-A", "VOR/DME-A"),
    ("approach", "RNVA", "RNAV (GPS)-A"),
    ("arrival", "JANNY5", "JANNY5"),
])
def test_a_procedure_is_named_as_its_chart_is_titled(kind, ident, name):
    assert procedures.procedure_name(kind, ident) == name


def test_the_ils_y_08_via_lax_is_its_transition_its_final_and_its_missed_approach():
    drawn = procedures.procedure_drawing("KBUR", "I08-Y", "LAX")
    assert drawn["name"] == "ILS Y RWY 08" and drawn["transition"] == "LAX"
    transition, final, missed = drawn["lines"]
    assert [transition["role"], final["role"], missed["role"]] == ["transition", "final", "missed"]
    # LAX to SILEX; SILEX by BUDDE to the runway; from the runway to VTU.
    assert near(transition["points"][0], LAX) and near(transition["points"][-1], SILEX)
    assert near(final["points"][0], SILEX) and near(final["points"][-1], RW08)
    assert near(missed["points"][0], RW08) and near(missed["points"][-1], VTU)
    fixes = {f["ident"]: f for f in drawn["fixes"]}
    assert fixes["BUDDE"]["roles"] == ["FAF"] and (fixes["BUDDE"]["min_ft"], fixes["BUDDE"]["max_ft"]) == (3000, 3000)
    assert {"IAF", "IF", "hold"} <= set(fixes["SILEX"]["roles"])
    # The final's limit where it starts, at or above 3,700 (code J).
    assert (fixes["SILEX"]["min_ft"], fixes["SILEX"]["max_ft"]) == (3700, None)
    # No altitude at the missed approach point: the chart's is its minimums.
    assert fixes["RW08"]["roles"] == ["MAP"] and fixes["RW08"]["min_ft"] is None
    assert fixes["VTU"]["missed"] and not fixes["SILEX"]["missed"]


def test_a_hold_is_drawn_on_its_true_course_turning_its_way():
    drawn = procedures.procedure_drawing("KBUR", "I08-Y", "LAX")
    silex, vtu = drawn["holds"]
    # 078.9° magnetic inbound, and KBUR's variation 12.0° east: 091° true.
    assert silex["fix"] == "SILEX" and silex["turn"] == "R" and silex["inbound_deg"] == 91 and not silex["missed"]
    assert near(silex["points"][0], SILEX) and near(silex["points"][-1], SILEX)
    # Right turns: the outbound leg lies to the right of the inbound one,
    # south of an eastbound course, two turn radii off.
    farthest = max(silex["points"], key=lambda p: geo.distance_nm(*SILEX, *p))
    assert 150 < geo.bearing_deg(*SILEX, *farthest) < 270
    assert vtu["fix"] == "VTU" and vtu["turn"] == "L" and vtu["missed"]


def test_an_rf_leg_is_an_arc_round_its_centre_fix():
    drawn = procedures.procedure_drawing("KBUR", "H08-Y", "WABBT")
    transition = drawn["lines"][0]
    centre = (34.0 + 14 / 60 + 43.87 / 3600, -(118 + 30 / 60 + 46.04 / 3600))  # CFCDJ
    on_arc = [p for p in transition["points"] if abs(geo.distance_nm(*centre, *p) - 2.74) < 0.05]
    assert len(on_arc) > 10


def test_a_departures_runway_transition_leaves_from_the_runways_far_end():
    drawn = procedures.procedure_drawing("KBUR", "VNY4", "TWINE")
    rw08 = next(line for line in drawn["lines"] if line["role"] == "runway" and line["name"] == "RW08")
    rw26 = (34.0 + 11 / 60 + 51.54 / 3600, -(118 + 20 / 60 + 59.86 / 3600))
    assert near(rw08["points"][0], rw26)
    assert drawn["lines"][-1]["role"] == "transition" and drawn["lines"][-1]["name"] == "TWINE"


def test_an_unknown_procedure_is_none():
    assert procedures.procedure_drawing("KBUR", "I99") is None
    assert procedures.procedure_drawing("KXYZ", "I08-Y") is None


@pytest.mark.parametrize(("code", "first", "second", "limits"), [
    ("+", 4600, None, (4600, None)),
    ("-", 9000, None, (None, 9000)),
    (" ", 3000, None, (3000, 3000)),
    ("B", 13000, 11000, (11000, 13000)),
    ("J", 3700, 3000, (3700, None)),
    ("I", 3000, 2753, (3000, 3000)),
    ("V", 4020, 4020, (4020, None)),
    (" ", None, None, (None, None)),
])
def test_altitude_descriptions_are_read_as_arinc_424_codes_them(code, first, second, limits):
    leg = next(iter(procedures._airport("KBUR", CIFP).legs.values()))[0]
    leg = dataclasses.replace(leg, altitude_code=code, altitude1=first, altitude2=second)
    assert procedures.altitude_limits(leg) == limits
