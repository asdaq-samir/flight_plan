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
    assert caution["reasons"] == ["Over the aircraft's 10,950 ft service ceiling"]


def test_low_ground_takes_any_500_and_ifr_its_thousands():
    low = {**ROCKIES, "floor_ft": 2200.0, "hemispheric_rule_from_ft": 3800.0}
    assert altitude_anyway({"course_magnetic_deg": 80.0, "segments": [low]}) == 2500.0
    # Under IFR eastbound flies odd thousands (14 CFR 91.179(b)).
    assert altitude_anyway({"rules": "ifr", "course_magnetic_deg": 80.0, "segments": [ROCKIES]}) == 15000.0
    assert altitude_anyway({"segments": []}) is None


def test_prohibited_airspace_is_a_warning():
    selection = {"special_use": [{"name": "P-56A", "type": "P"}, {"name": "R-4001", "type": "R"}]}
    assert prohibited_caution(selection) == ["Through P-56A, prohibited airspace (14 CFR 73.83)"]
