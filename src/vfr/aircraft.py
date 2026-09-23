"""Configurable aircraft performance profiles.

Altitude selection needs a service ceiling to check against, but that
number varies enormously by aircraft type -- so it's never hardcoded,
only ever a parameter loaded from a plain JSON profile.
"""
import json
from functools import lru_cache
from pathlib import Path

DEFAULT_PROFILE_DIR = Path(__file__).resolve().parents[2] / "data" / "aircraft"

# What the nav log cannot be worked out without: the ceiling for the
# altitude selection, the airspeed and burn for every leg. Checked when a
# profile is loaded, so a file missing one is refused by name here rather
# than failing leg by leg further in (vfr.navlog.assemble_leg used to be
# the first place anything noticed).
REQUIRED_FIELDS = {"service_ceiling_ft", "cruise_tas_kt", "fuel_burn_gph"}


@lru_cache(maxsize=32)
def _load(path_str: str) -> dict:
    """The disk read and the validation, cached by resolved path. Every
    caller of load_aircraft_profile -- planning.py's aircraft_profile --
    gets called on every plan or nav log request, for one of a handful of checked-in JSON files that only
    change on a deploy. A ValueError is not cached: lru_cache never
    remembers an exception, so a fixed file is picked up on the next call
    without needing a restart.
    """
    with open(path_str) as f:
        profile = json.load(f)
    missing = REQUIRED_FIELDS - profile.keys()
    if missing:
        raise ValueError(f"{path_str} is missing required field(s): {missing}")
    return profile


def load_aircraft_profile(name_or_path) -> dict:
    """`name_or_path` can be a bare profile name (e.g. "c172", resolved
    against data/aircraft/c172.json) or a full path to a JSON file.

    A fresh dict every call, cache hit or not: planning.py's
    aircraft_profile() overrides cruise_tas_kt/fuel_burn_gph/
    usable_fuel_gal on the dict it gets back, in place -- handing out
    the cached object itself would let a pilot's own aeroplane numbers
    on one request leak into the stock profile every other pilot gets
    next. All the fields are scalars (checked against
    data/aircraft/*.json), so a shallow copy is enough.
    """
    path = Path(name_or_path)
    if not path.suffix:
        path = DEFAULT_PROFILE_DIR / f"{path.name}.json"
    return dict(_load(str(path)))
