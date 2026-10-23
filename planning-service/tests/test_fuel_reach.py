"""The figures a fuel stop is picked on: each stop's flight as its nav log
flies it (routers.plan.fuel_stops_of)."""
from datetime import datetime, timezone

from app.routers.plan import night_on_the_way, worst_burn_per_nm


def test_the_worst_stretch_not_the_average():
    # 300 nm at 0.07 gal/nm, then 300 into a headwind at 0.08.
    legs = [{"distance_nm": 100.0, "fuel_gal": 7.0}] * 3 + [{"distance_nm": 100.0, "fuel_gal": 8.0}] * 3
    assert abs(worst_burn_per_nm(legs, 300.0) - 0.08) < 1e-9
    assert abs(worst_burn_per_nm(legs, 600.0) - 0.075) < 1e-9
    assert worst_burn_per_nm([{"distance_nm": 50.0, "fuel_gal": None}], 100.0) is None


def test_a_trip_running_into_the_night():
    # El Paso to Hartford leaving at 15:00Z in October: day at the start,
    # past dusk in the east ten hours on.
    start, end = (31.8, -106.4), (41.9, -72.7)
    leave = datetime(2026, 10, 23, 15, 0, tzinfo=timezone.utc)
    assert night_on_the_way(start, end, leave, 600.0)
    assert not night_on_the_way(start, end, leave, 120.0)
