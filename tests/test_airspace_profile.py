"""The leg-by-leg airspace ceiling, on a made-up shelf: a Class B shelf
over the first leg only, so that leg is capped and the next is free --
the geometry the stepped altitude plans rest on."""
from shapely.geometry import Polygon

from vfr import airspace

# A straight north-east route with one checkpoint half way.
START, MID, END = (40.0, -90.0), (40.7, -89.1), (41.4, -88.2)


def _shelf(floor_ft, x0, y0, x1, y1, klass="B", name="TEST"):
    return {
        "name": name, "class": klass, "floor_ft_msl": floor_ft,
        "geometry": Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)]),
    }


def test_a_shelf_over_the_first_leg_caps_that_leg_only(monkeypatch):
    shelf = _shelf(3600.0, -90.2, 39.8, -89.5, 40.4)   # around the departure, short of MID
    monkeypatch.setattr(airspace, "load_controlled_airspace", lambda shp_path, bbox: [shelf])

    ceilings = airspace.airspace_ceiling_profile(START, END, [START, MID, END], shp_path="unused")

    assert ceilings == [3600.0, None]
    # And the whole route's own ceiling is that same shelf.
    assert airspace.max_airspace_altitude_msl(START, END, shp_path="unused") == 3600.0


def test_the_lowest_shelf_wins_where_two_overlap_a_leg(monkeypatch):
    shelves = [_shelf(3600.0, -90.2, 39.8, -89.5, 40.4), _shelf(2600.0, -90.1, 39.9, -89.8, 40.2, name="INNER")]
    monkeypatch.setattr(airspace, "load_controlled_airspace", lambda shp_path, bbox: shelves)

    assert airspace.airspace_ceiling_profile(START, END, [START, MID, END], shp_path="unused") == [2600.0, None]


def test_class_c_and_d_and_the_routes_own_surface_areas_impose_nothing(monkeypatch):
    shapes = [
        _shelf(2000.0, -90.2, 39.8, -89.5, 40.4, klass="C", name="CHARLIE"),
        _shelf(0.0, -90.1, 39.9, -89.9, 40.1, name="OWN FIELD"),   # Class B from the surface around the departure
    ]
    monkeypatch.setattr(airspace, "load_controlled_airspace", lambda shp_path, bbox: shapes)

    assert airspace.airspace_ceiling_profile(START, END, [START, MID, END], shp_path="unused") == [None, None]


def test_the_route_wide_ceiling_is_the_one_leg_profile_on_every_fixture(monkeypatch):
    for shapes in (
        [_shelf(3600.0, -90.2, 39.8, -89.5, 40.4)],
        [_shelf(3600.0, -90.2, 39.8, -89.5, 40.4), _shelf(2600.0, -90.1, 39.9, -89.8, 40.2, name="INNER")],
        [_shelf(2000.0, -90.2, 39.8, -89.5, 40.4, klass="C"), _shelf(0.0, -90.1, 39.9, -89.9, 40.1, name="OWN")],
    ):
        monkeypatch.setattr(airspace, "load_controlled_airspace", lambda shp_path, bbox, shapes=shapes: shapes)
        assert airspace.max_airspace_altitude_msl(START, END, shp_path="unused") == \
            airspace.airspace_ceiling_profile(START, END, [START, END], shp_path="unused")[0]
