"""vfr.plates: an approach's plate placed on the map by its own waypoints."""
import math

from vfr import plates

DLH = [
    {"kind": "IAP", "name": "ILS OR LOC RWY 09", "url": "u/IL9"},
    {"kind": "IAP", "name": "ILS RWY 09 (SA CAT I)", "url": "u/I9SAC1"},
    {"kind": "IAP", "name": "ILS RWY 09 (CAT II)", "url": "u/I9C2"},
    {"kind": "IAP", "name": "RNAV (GPS) RWY 3", "url": "u/R3"},
    {"kind": "IAP", "name": "RNAV (GPS) Y RWY 27", "url": "u/RY27"},
    {"kind": "IAP", "name": "RNAV (GPS) Z RWY 27", "url": "u/RZ27"},
    {"kind": "DP", "name": "RNAV (GPS) RWY 3 DEPARTURE", "url": "u/DP"},
]


def test_the_cifps_approach_is_the_plate_of_the_same_runway_means_and_letter():
    # "RWY 03" is the plate's "RWY 3"; an ILS is its "ILS OR LOC" plate,
    # not its CAT II one; a letter picks its own.
    assert plates.plate_for("RNAV (GPS) RWY 03", DLH)["url"] == "u/R3"
    assert plates.plate_for("ILS RWY 09", DLH)["url"] == "u/IL9"
    assert plates.plate_for("RNAV (GPS) Z RWY 27", DLH)["url"] == "u/RZ27"
    assert plates.plate_for("RNAV (GPS) RWY 21", DLH) is None
    assert plates.plate_for("VOR RWY 03", DLH) is None


def test_a_waypoint_is_two_of_its_squares_half_their_size_apart():
    squares = [(100, 200), (105.5, 194.6), (300, 300)]
    assert plates.stars_of(squares) == [(102.75, 197.3)]


FIXES = {"OMARY": (46.680928, -92.326369), "AMLIY": (46.76765, -92.249131), "CLIPH": (47.012236, -92.029669),
         "DEHBU": (46.637406, -92.223211), "PEGHI": (46.724356, -92.429694)}


def _drawn(scale=10.5, x0=200.0, y0=330.0):
    """The fixes' stars as a north-up plan view at `scale` points a nm
    would draw them, each named beside it."""
    lat0 = sum(v[0] for v in FIXES.values()) / len(FIXES)
    lon0 = sum(v[1] for v in FIXES.values()) / len(FIXES)
    k = math.cos(math.radians(lat0))
    stars = {f: (x0 + scale * (lon - lon0) * 60 * k, y0 + scale * (lat - lat0) * 60) for f, (lat, lon) in FIXES.items()}
    words = [(f, (x + 8, y - 20, x + 30, y - 12)) for f, (x, y) in stars.items()]
    return stars, words


def test_the_plan_view_is_placed_where_its_waypoints_agree_with_the_cifp():
    stars, words = _drawn()
    placing = plates.fit(words, list(stars.values()), FIXES)
    assert set(placing["fixes"]) == set(FIXES)
    assert placing["scale"] == __import__("pytest").approx(10.5, rel=1e-6)
    assert abs(placing["turn"]) < 1e-6
    # And back: where a star is drawn is where the fix is.
    lat, lon = plates.ground_of(placing, *stars["CLIPH"])
    assert (lat, lon) == __import__("pytest").approx(FIXES["CLIPH"], abs=1e-6)


def test_a_fix_drawn_out_of_scale_is_left_out_and_too_few_place_nothing():
    stars, words = _drawn()
    # PEGHI drawn in an inset, two miles from where it would be.
    stars["PEGHI"] = (stars["PEGHI"][0] + 21, stars["PEGHI"][1])
    words = [(f, (x + 8, y - 20, x + 30, y - 12)) for f, (x, y) in stars.items()]
    placing = plates.fit(words, list(stars.values()), FIXES)
    assert set(placing["fixes"]) == set(FIXES) - {"PEGHI"}
    # Two fixes alone agree on any placing: none, unless at a plan
    # view's own scale.
    two = {f: FIXES[f] for f in ("OMARY", "AMLIY")}
    assert plates.fit(words, list(stars.values()), two)["fixes"] == ["OMARY", "AMLIY"]
    stars, words = _drawn(scale=12.0)
    assert plates.fit(words, list(stars.values()), two) is None


def test_three_fixes_place_a_plan_view_drawn_larger():
    # KMDW's RNP plates are at 1:250,000, 21 points a nm.
    stars, words = _drawn(scale=21.0)
    placing = plates.fit(words, list(stars.values()), FIXES)
    assert placing["scale"] == __import__("pytest").approx(21.0, rel=1e-6)


def test_the_plan_view_is_the_box_of_long_lines_round_its_waypoints():
    across = [(486.0, 17, 370), (190.0, 17, 370), (540.0, 17, 370)]
    down = [(17.0, 190, 486), (370.0, 190, 486)]
    box = plates.plan_view_box(across, down, [(160, 230), (290, 450)], (387, 594))
    assert box == (17.0, 190.0, 370.0, 486.0)


def test_a_plate_kept_as_not_placed_is_none_until_fit_changes(tmp_path):
    meta = tmp_path / "R03.json"
    meta.write_text('{"cycle": "2610", "name": "RNAV (GPS) RWY 3", "placed": false, "fit": 1}')
    assert plates._kept(meta) is None
    meta.write_text(f'{{"cycle": "2610", "name": "RNAV (GPS) RWY 3", "placed": false, "fit": {plates.FIT_VERSION}}}')
    assert plates._kept(meta)["placed"] is False
    meta.write_text('{"cycle": "2610", "name": "RNAV (GPS) RWY 3", "placed": true, "south": 46.6}')
    assert plates._kept(meta)["south"] == 46.6


def test_two_stars_place_a_plate_only_with_its_runway_inside_the_plan_view():
    stars, words = _drawn()
    two = {f: FIXES[f] for f in ("OMARY", "AMLIY")}
    placing = plates.fit(words, list(stars.values()), two)
    x, y = plates.page_of(placing, *FIXES["DEHBU"])
    runway = {**two, "RW03": FIXES["DEHBU"]}
    assert plates.runway_inside(placing, runway, (x - 50, y - 50, x + 50, y + 50))
    assert not plates.runway_inside(placing, runway, (x + 10, y - 50, x + 50, y + 50))
    # No runway in the CIFP: nothing to check two stars by.
    assert not plates.runway_inside(placing, two, (x - 50, y - 50, x + 50, y + 50))
