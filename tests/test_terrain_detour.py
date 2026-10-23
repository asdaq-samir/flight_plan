"""vfr.terrain_detour: a way round high ground by fields with fuel."""

import numpy as np
import pandas as pd

from vfr import terrain_detour


def test_the_highest_cruise_either_way_under_the_ceiling():
    # A PA-28-140's 10,950 ft: 9,500 east, 10,500 west, the lower kept.
    assert terrain_detour.highest_cruise_ft(10_950) == 9_500
    assert terrain_detour.highest_cruise_ft(13_500) == 12_500
    # Never into Class A (14 CFR 71.33).
    assert terrain_detour.highest_cruise_ft(25_000) == 16_500


def _fields(*rows):
    return pd.DataFrame([{"ident": i, "name": f"{i} FIELD", "lat": la, "lon": lo} for i, la, lo in rows])


def test_round_a_ridge_by_the_field_at_its_end(monkeypatch):
    # A ridge 12,000 ft high across the straight line at 1 to 2 degrees
    # east, from 1 degree south to 3 north; low ground elsewhere.
    def heights(lats, lons):
        ridge = (lons > 1.0) & (lons < 2.0) & (lats > -1.0) & (lats < 3.0)
        return np.where(ridge, 12_000.0, 500.0)
    monkeypatch.setattr(terrain_detour, "_heights_ft", heights)
    fields = _fields(("SOUTH", -1.6, 1.5), ("NORTH", 3.6, 1.5), ("ONRIDGE", 0.0, 1.5))
    way = terrain_detour.way_round((0.0, 0.0), (0.0, 3.0), 10_950, fields=fields)
    assert [w["ident"] for w in way] == ["SOUTH"]


def test_a_clear_line_needs_no_way_round(monkeypatch):
    monkeypatch.setattr(terrain_detour, "_heights_ft", lambda lats, lons: np.full(lats.shape, 500.0))
    assert terrain_detour.way_round((0.0, 0.0), (0.0, 3.0), 10_950, fields=_fields(("A", 0.0, 1.5))) == []
