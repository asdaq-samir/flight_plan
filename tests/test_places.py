"""vfr.places: a point described by what is there -- the landmark it is
by, or the town it is near -- from the USGS's place names, as a
stand-alone VFR waypoint has no name of its own."""
import io

from vfr import places

HEADER = "feature_id|feature_name|feature_class|prim_lat_dec|prim_long_dec\n"


def _table(tmp_path, *rows):
    text = HEADER + "".join(f"{i}|{name}|{klass}|{lat}|{lon}\n" for i, (name, klass, lat, lon) in enumerate(rows))
    out = tmp_path / "places.csv"
    places.prepare(io.StringIO(text), out)
    return places._load(out)


def test_a_waypoint_on_a_landmark_is_by_it_and_one_elsewhere_is_so_far_from_a_town(tmp_path):
    table = _table(
        tmp_path,
        ("Bangs Lake", "Lake", 42.2656, -88.1331),
        ("Village of Wauconda", "Civil", 42.2589, -88.1398),
        ("Fort Sheridan (historical)", "Military", 42.2172, -87.8098),
        ("Village of Glenview", "Civil", 42.0698, -87.8162),
        # Not what a chart labels, or not there any more.
        ("The Grove", "Populated Place", 42.0800, -87.8640),
        ("Township of Northfield", "Civil", 42.0790, -87.8630),
        ("Old Lake (historical)", "Lake", 42.0781, -87.8636),
    )

    assert places.describe(42.26733888, -88.13105, table) == "by Bangs Lake"           # VPBNG
    assert places.describe(42.21298888, -87.803625, table) == "by Fort Sheridan"        # VPFTS
    assert places.describe(42.07806388, -87.86358888, table) == "2 nm W of Glenview"    # VPAON
    assert places.describe(42.2610, -88.1420, table) == "in Wauconda"


def test_far_from_everything_or_before_the_names_load_a_point_is_undescribed(tmp_path, monkeypatch):
    table = _table(tmp_path, ("Village of Glenview", "Civil", 42.0698, -87.8162))

    assert places.describe(45.0, -95.0, table) is None
    monkeypatch.setattr(places, "_TABLE", None)
    assert places.describe(42.07, -87.86) is None


def test_a_chart_checkpoint_is_named_as_the_chart_labels_the_place(tmp_path):
    table = _table(
        tmp_path,
        ("Village of Lake Zurich", "Civil", 42.1967, -88.0934),
        ("Village of Johnsburg", "Civil", 42.3800, -88.2420),
        ("Lauderdale Lakes", "Lake", 42.7686, -88.5710),
        ("Pleasant Island", "Island", 42.7690, -88.5704),
        ("Nepco Lake 175", "Lake", 44.3500, -89.8100),
        ("0.985 Reservoir", "Reservoir", 43.4300, -89.1000),
    )
    # A town: the town it is in. A lake: the water there, not the island
    # beside it, and without GNIS's own number on the name.
    assert places.checkpoint_name("town", 42.2044, -88.0668, table) == "Lake Zurich"
    assert places.checkpoint_name("water", 42.7687, -88.5704, table) == "Lauderdale Lakes"
    assert places.checkpoint_name("water", 44.3510, -89.8090, table) == "Nepco Lake"
    # A river or a road: the town it is near.
    assert places.checkpoint_name("river", 42.3900, -88.2600, table) == "River near Johnsburg"
    assert places.checkpoint_name("road_or_rail", 42.3900, -88.2600, table) == "Road or railway near Johnsburg"
    # Nothing near enough, a survey's number for a name, or another kind: no name.
    assert places.checkpoint_name("town", 45.0, -95.0, table) is None
    assert places.checkpoint_name("water", 43.4300, -89.1000, table) is None
    assert places.checkpoint_name("airport", 42.2044, -88.0668, table) is None
