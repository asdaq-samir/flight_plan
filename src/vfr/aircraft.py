"""Configurable aircraft performance profiles.

Altitude selection needs a service ceiling to check against, but that
number varies enormously by aircraft type -- so it's never hardcoded,
only ever a parameter loaded from a plain JSON profile.
"""
import json
from pathlib import Path

DEFAULT_PROFILE_DIR = Path(__file__).resolve().parents[2] / "data" / "aircraft"

REQUIRED_FIELDS = {"service_ceiling_ft"}


def load_aircraft_profile(name_or_path) -> dict:
    """`name_or_path` can be a bare profile name (e.g. "c172", resolved
    against data/aircraft/c172.json) or a full path to a JSON file.
    """
    path = Path(name_or_path)
    if not path.suffix:
        path = DEFAULT_PROFILE_DIR / f"{path.name}.json"
    with open(path) as f:
        profile = json.load(f)
    missing = REQUIRED_FIELDS - profile.keys()
    if missing:
        raise ValueError(f"{path} is missing required field(s): {missing}")
    return profile
