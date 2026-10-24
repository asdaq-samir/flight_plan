"""A route with no legal altitude flown anyway, with what it breaks said
(app.planning.altitude_anyway, own_altitude_caution), at the owner's "I
don't want to put hard limits on anything" (2026-10-23)."""
from app.planning import altitude_anyway, own_altitude_caution, prohibited_caution

# The Rockies on Los Angeles to Hartford's line, eastbound, for an airplane
# whose ceiling is 10,950 ft.
ROCKIES = {"floor_ft": 13600.0, "service_ceiling_ft": 10950.0, "course_magnetic_deg": 80.0, "eastbound": True,
           "hemispheric_rule_from_ft": 9000.0, "airspace_ceiling_ft": None, "cloud_ceiling_ft": None, "candidates_ft": []}


def test_over_the_high_ground_above_the_ceiling_with_its_warning():
    selection = {"course_magnetic_deg": 80.0, "segments": [ROCKIES]}
    # Eastbound odd thousands plus 500 over 13,600 ft (14 CFR 91.159).
    assert altitude_anyway(selection) == 15500.0
    caution = own_altitude_caution(selection, [{"altitude_ft": 15500.0}], ("KLAX", "KBDL"))
    assert caution["reasons"] == [
        "Over the aircraft's 10,950 ft service ceiling",
        "Over 15,000 ft MSL: oxygen for the crew the whole time there and for every occupant (14 CFR 91.211(a)(2), (3))",
    ]
    # Carrying oxygen, the ceiling alone.
    with_oxygen = own_altitude_caution(selection, [{"altitude_ft": 15500.0}], ("KLAX", "KBDL"), {"supplemental_oxygen": True})
    assert with_oxygen["reasons"] == ["Over the aircraft's 10,950 ft service ceiling"]


def test_oxygen_by_91_211s_three_heights():
    from app.planning import oxygen_caution
    # Each side of 12,500, 14,000 and 15,000 ft MSL (14 CFR 91.211(a)).
    assert oxygen_caution(12500.0, None) == []
    assert "(a)(1)" in oxygen_caution(13500.0, None)[0]
    assert "(a)(1)" in oxygen_caution(14000.0, None)[0]
    assert oxygen_caution(14500.0, None)[0].endswith("(14 CFR 91.211(a)(2))")
    assert oxygen_caution(15000.0, None)[0].endswith("(14 CFR 91.211(a)(2))")
    assert "(3)" in oxygen_caution(15500.0, None)[0]
    assert oxygen_caution(15500.0, {"pressurized": True}) == []


def test_class_a_is_a_warning_too():
    # 14 CFR 71.33(a): from 18,000 ft MSL; 91.135: IFR there.
    flat = {"course_magnetic_deg": 80.0, "segments": [{**ROCKIES, "floor_ft": 3000.0, "service_ceiling_ft": 25000.0}]}
    under = own_altitude_caution(flat, [{"altitude_ft": 17500.0}], ("A", "B"), {"supplemental_oxygen": True})
    over = own_altitude_caution(flat, [{"altitude_ft": 18500.0}], ("A", "B"), {"supplemental_oxygen": True})
    assert under is None
    assert over["reasons"][-1].startswith("At or over 18,000 ft MSL: Class A")


def test_low_ground_takes_any_500_and_ifr_its_thousands():
    low = {**ROCKIES, "floor_ft": 2200.0, "hemispheric_rule_from_ft": 3800.0}
    assert altitude_anyway({"course_magnetic_deg": 80.0, "segments": [low]}) == 2500.0
    # Under IFR eastbound flies odd thousands (14 CFR 91.179(b)).
    assert altitude_anyway({"rules": "ifr", "course_magnetic_deg": 80.0, "segments": [ROCKIES]}) == 15000.0
    assert altitude_anyway({"segments": []}) is None


def test_prohibited_airspace_is_a_warning():
    selection = {"special_use": [{"name": "P-56A", "type": "P"}, {"name": "R-4001", "type": "R"}]}
    assert prohibited_caution(selection) == ["Through P-56A, prohibited airspace (14 CFR 73.83)"]
