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
