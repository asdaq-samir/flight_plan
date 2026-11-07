"""Which winds-aloft forecast period a departure gets."""
from wingtip.weather import forecast_hour


def test_now_and_the_next_few_hours_use_the_six_hour_product():
    assert forecast_hour(None) == "06"
    assert forecast_hour(0) == "06"
    assert forecast_hour(6) == "06"


def test_later_today_uses_the_twelve_hour_product():
    assert forecast_hour(6.5) == "12"
    assert forecast_hour(15) == "12"


def test_tomorrow_uses_the_twenty_four_hour_product():
    assert forecast_hour(15.5) == "24"
    assert forecast_hour(40) == "24"
