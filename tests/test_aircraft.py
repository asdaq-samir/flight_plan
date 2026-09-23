"""vfr.aircraft: a profile is refused, by name, when it is missing what
the nav log needs -- at load, not leg by leg further in."""
import json

import pytest

from vfr import aircraft


def test_every_stock_profile_has_what_the_nav_log_needs():
    for path in aircraft.DEFAULT_PROFILE_DIR.glob("*.json"):
        profile = aircraft.load_aircraft_profile(path.stem)
        assert aircraft.REQUIRED_FIELDS <= profile.keys(), path.name


def test_a_profile_without_a_fuel_burn_is_refused_when_loaded(tmp_path):
    path = tmp_path / "glider.json"
    path.write_text(json.dumps({"service_ceiling_ft": 18000, "cruise_tas_kt": 60}))
    with pytest.raises(ValueError, match="fuel_burn_gph"):
        aircraft.load_aircraft_profile(str(path))
