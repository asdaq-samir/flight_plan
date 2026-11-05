"""wingtip.spoken finds the places a clearance said aloud: navaids by name,
fixes by their five letters said as a word, airports by name, SIDs and
STARs by name and number."""
from wingtip import spoken

# Round KMSP and KDLH, as NASR and the CIFP name them.
PLACES = [
    {"ident": "GEP", "name": "Gopher", "what": "navaid", "lat": 45.15, "lon": -93.37},
    {"ident": "DLH", "name": "Duluth", "what": "navaid", "lat": 46.80, "lon": -92.20},
    {"ident": "FSD", "name": "Sioux Falls", "what": "navaid", "lat": 43.65, "lon": -96.78},
    {"ident": "PYKLA", "what": "fix", "lat": 46.83, "lon": -91.85},
    {"ident": "KVUSI", "what": "fix", "lat": 45.8, "lon": -92.9},
    {"ident": "BUNYN", "what": "fix", "lat": 45.3, "lon": -93.1},
    {"ident": "KDLH", "name": "Duluth International Airport", "what": "airport", "lat": 46.84, "lon": -92.19},
]


def test_a_sound_is_its_consonants_so_a_fix_said_as_a_word_is_its_letters():
    assert spoken.sound("pickla") == spoken.sound("PYKLA") == "PKL"
    assert spoken.sound("bunyan") == spoken.sound("BUNYN")
    assert spoken.sound("snows") == spoken.sound("SNOWZ")
    assert spoken.sound("ohana") == spoken.sound("OANNA")


def test_an_ident_or_a_name_said_is_found_outright():
    assert spoken.point("GEP", PLACES)["ident"] == "GEP"
    assert spoken.point("the Gopher VOR", PLACES) == {
        "said": "the Gopher VOR", "ident": "GEP", "name": "Gopher", "kind": "navaid", "lat": 45.15, "lon": -93.37, "sure": True,
    }
    assert spoken.point("Sioux Falls", PLACES)["ident"] == "FSD"


def test_a_fix_said_as_a_word_is_found_by_its_sound_and_offered_unsure():
    found = spoken.point("pickla", PLACES)
    assert (found["ident"], found["sure"]) == ("PYKLA", False)
    # Of two fixes with its consonants, the one with its vowels too.
    assert spoken.point("pickla", [{"ident": "PCKLE", "what": "fix"}, *PLACES])["ident"] == "PYKLA"
    # Nothing near sounds like it: none, rather than a guess.
    assert spoken.point("zebra", PLACES) is None


def test_airport_after_a_name_is_the_field_and_not_its_navaid():
    # AIM 4-4-3 a: an airport and its navaid often share a name, and the
    # word "airport" says which the clearance limit is.
    duluth = {"ident": "KDLH", "name": "Duluth International Airport", "lat": 46.84, "lon": -92.19}
    assert spoken.point("the Duluth airport", PLACES, duluth)["ident"] == "KDLH"
    assert spoken.point("Duluth", PLACES)["ident"] == "DLH"


def test_a_route_said_with_no_commas_is_its_places_in_order_the_longest_names_first():
    found = spoken.points("Gopher Sioux Falls pickla wibble", PLACES)
    assert [p["ident"] for p in found] == ["GEP", "FSD", "PYKLA", None]
    assert found[-1]["said"] == "wibble"


LISTED = [
    {"kind": "departure", "id": "BUNYN1", "transitions": ["DLH", "KVUSI"]},
    {"kind": "departure", "id": "SNOWZ1", "transitions": ["DABOY"]},
    {"kind": "arrival", "id": "GEP1", "transitions": ["AXN", "FAR"]},
]


def test_a_sid_or_star_is_found_by_its_name_and_number_and_its_transition_by_its_fix():
    names = {"GEP": "Gopher", "DLH": "Duluth"}
    assert spoken.procedure("bunyan", "1", "departure", LISTED, names)["id"] == "BUNYN1"
    assert spoken.procedure("Gopher", "1", "arrival", LISTED, names) == {"id": "GEP1", "sure": True, "transitions": ["AXN", "FAR"]}
    # The number said is the procedure's: Bunyan Two is not published.
    assert spoken.procedure("bunyan", "2", "departure", LISTED, names) is None
    assert spoken.transition("Duluth", ["DLH", "KVUSI"], PLACES) == "DLH"
    assert spoken.transition("kavusi", ["DLH", "KVUSI"], PLACES) == "KVUSI"


def test_a_navaids_name_comes_before_a_fix_spelled_as_the_word():
    places = [
        {"ident": "FLINT", "what": "fix", "lat": 43.0, "lon": -83.7},
        {"ident": "FNT", "name": "Flint", "what": "navaid", "lat": 42.97, "lon": -83.74},
        {"ident": "LVZ", "name": "Wilkes-Barre", "what": "navaid", "lat": 41.27, "lon": -75.69},
    ]
    assert spoken.point("Flint", places)["ident"] == "FNT"
    # Said as the fix's letters, it is the fix.
    assert spoken.point("flint intersection", places)["ident"] == "FLINT"
    assert [p["ident"] for p in spoken.points("Wilkes Barre Flint", places)] == ["LVZ", "FNT"]
