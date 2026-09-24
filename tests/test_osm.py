"""vfr.osm's candidate rules: the Overpass query they build and the
category each element's tags get. Each category's rule is written twice
(a filter and a predicate), so both are pinned here -- a change to one
that is not made to the other fails one of these."""
from vfr import osm

BBOX = (42.0, -93.0, 47.0, -87.5)

GOLDEN = """[out:json][timeout:60];
(
node["natural"="water"]["intermittent"!="yes"]["water"!~"^(river|stream|canal|ditch)$"](42.0,-93.0,47.0,-87.5);
way["natural"="water"]["intermittent"!="yes"]["water"!~"^(river|stream|canal|ditch)$"](42.0,-93.0,47.0,-87.5);
relation["natural"="water"]["intermittent"!="yes"]["water"!~"^(river|stream|canal|ditch)$"](42.0,-93.0,47.0,-87.5);
node["water"="reservoir"]["intermittent"!="yes"](42.0,-93.0,47.0,-87.5);
way["water"="reservoir"]["intermittent"!="yes"](42.0,-93.0,47.0,-87.5);
relation["water"="reservoir"]["intermittent"!="yes"](42.0,-93.0,47.0,-87.5);
node["leisure"="stadium"](42.0,-93.0,47.0,-87.5);
way["leisure"="stadium"](42.0,-93.0,47.0,-87.5);
relation["leisure"="stadium"](42.0,-93.0,47.0,-87.5);
node["place"~"^(city|town)$"](42.0,-93.0,47.0,-87.5);
way["place"~"^(city|town)$"](42.0,-93.0,47.0,-87.5);
relation["place"~"^(city|town)$"](42.0,-93.0,47.0,-87.5);
);
out geom;"""


def test_the_query_is_exactly_the_filters():
    assert osm.build_overpass_query(BBOX) == GOLDEN


def test_each_category_labels_what_its_filter_fetches():
    assert osm._category_for_tags({"natural": "water", "name": "Long Lake"}) == "lake_or_pond"
    assert osm._category_for_tags({"water": "reservoir"}) == "reservoir"
    assert osm._category_for_tags({"leisure": "stadium"}) == "stadium"
    assert osm._category_for_tags({"place": "city"}) == "town"
    assert osm._category_for_tags({"place": "town"}) == "town"


def test_what_the_filters_leave_out_is_not_labelled_either():
    # Seasonal water, rivers as polygons (the route's crossing is the
    # checkpoint, found separately), and villages.
    assert osm._category_for_tags({"natural": "water", "intermittent": "yes"}) == "other"
    for riverine in ("river", "stream", "canal", "ditch"):
        assert osm._category_for_tags({"natural": "water", "water": riverine}) == "other"
    assert osm._category_for_tags({"water": "reservoir", "intermittent": "yes"}) == "other"
    assert osm._category_for_tags({"place": "village"}) == "other"


def test_the_first_matching_category_wins():
    # Both lake_or_pond's and reservoir's rules match; the spec's order
    # decides, which is why the collected corridors hold no reservoir.
    assert osm._category_for_tags({"natural": "water", "water": "reservoir"}) == "lake_or_pond"
