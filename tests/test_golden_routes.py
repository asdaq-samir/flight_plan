"""Recorded routes, replayed: what the nav log engine (vfr.navlog) made of
a real route -- its four plans, and the flown one's legs with their
climbs, tops of climb and descent -- from the winds, temperatures and
magnetic variation it was given then (tests/golden/record.py). The unit
tests prove each piece by hand; these catch a change in what they add up
to on a whole route. A change meant to move them is re-recorded, and the
golden files' diff read before it is committed."""
import json
from pathlib import Path

import pytest

from tests.golden.record import replay

GOLDEN = sorted((Path(__file__).parent / "golden").glob("*.json"))


@pytest.mark.parametrize("path", GOLDEN, ids=[p.stem for p in GOLDEN])
def test_a_recorded_route_plans_as_it_did(path):
    recorded = json.loads(path.read_text())
    assert json.loads(json.dumps(replay(recorded))) == recorded["expected"]
