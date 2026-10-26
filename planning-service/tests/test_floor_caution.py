"""A pilot's own altitude under 14 CFR 91.119's minimum safe altitudes,
flown with a caution naming the rule, what the floor rests on and how far
under it (app.planning.floor_caution), never refused -- at the owner's
"make the pilot aware but not restrict them". The figures are the rule's
own: 1,000 ft above the highest obstacle within 2,000 ft over a congested
area (91.119(b)), 500 ft above the surface or any structure elsewhere
(91.119(c))."""
from app.planning import floor_caution, own_altitude_caution

# A leg over a town with a 1,500 ft tower; one over fields with ground at
# 1,200 ft. Floors as vfr.terrain rounds them.
TOWN = {"floor_ft": 2500.0, "highest_ft": 1500.0, "highest_is_obstacle": True, "obstacle_type": "TOWER",
        "obstacle_clearance_ft": 1000.0, "congested": True, "hemispheric_rule_from_ft": 4000.0, "eastbound": True}
FIELDS = {"floor_ft": 1700.0, "highest_ft": 1200.0, "highest_is_obstacle": False, "obstacle_type": None,
          "obstacle_clearance_ft": 500.0, "congested": False, "hemispheric_rule_from_ft": 4000.0, "eastbound": True}


def test_over_a_congested_area_999_ft_is_a_caution_and_1000_is_not():
    assert floor_caution(TOWN, 2500.0) is None
    assert floor_caution(TOWN, 2499.0) == (
        "1 ft under the 2,500 ft 14 CFR 91.119(b) asks over a congested area: "
        "1,000 ft over the highest obstacle within 2,000 ft, here a 1,500 ft tower")


def test_elsewhere_499_ft_is_a_caution_and_500_is_not():
    assert floor_caution(FIELDS, 1700.0) is None
    assert floor_caution(FIELDS, 1699.0) == (
        "1 ft under the 1,700 ft 14 CFR 91.119(c) asks: 500 ft over the ground at 1,200 ft")


def test_an_obstacle_away_from_towns_takes_500_ft_from_it():
    tower = {**FIELDS, "highest_ft": 1480.0, "highest_is_obstacle": True, "obstacle_type": "T-L TWR", "floor_ft": 2000.0}
    # 1,980 ft keeps 91.119(c) though under the floor rounded up to 2,000.
    assert floor_caution(tower, 1980.0) is None
    assert floor_caution(tower, 1500.0) == (
        "480 ft under the 1,980 ft 14 CFR 91.119(c) asks: 500 ft over a 1,480 ft transmission line tower")


def test_where_the_towns_were_not_read_it_says_a_town_was_not_ruled_out():
    unknown = {**TOWN, "congested": None, "obstacle_type": "ANTENNA", "highest_ft": 800.0, "floor_ft": 1800.0}
    assert floor_caution(unknown, 1500.0) == (
        "300 ft under the 1,800 ft 14 CFR 91.119(b) asks where a congested area could not be ruled out: "
        "1,000 ft over the highest obstacle within 2,000 ft, here an 800 ft antenna")


def test_a_planner_without_the_floors_source_says_the_floor_alone():
    assert floor_caution({"floor_ft": 3200.0}, 3000.0) == "Under the 3,200 ft the terrain and obstacles need (14 CFR 91.119)"
    assert floor_caution({"floor_ft": 3200.0}, 3200.0) is None


def test_the_pilots_own_altitude_is_flown_with_the_caution():
    selection = {"segments": [FIELDS, TOWN]}
    legs = [{"altitude_ft": 2000.0}, {"altitude_ft": 2000.0}]
    caution = own_altitude_caution(selection, legs, ("KRZL", "KLAF"))
    assert caution["altitude_ft"] == 2000.0
    assert caution["reasons"] == [
        "500 ft under the 2,500 ft 14 CFR 91.119(b) asks over a congested area: "
        "1,000 ft over the highest obstacle within 2,000 ft, here a 1,500 ft tower"]
