"""web/src/lib/holding.test.ts's cases for app.figures.holding, by AIM
5-3-8's sectors, and HoldingPage's words."""
import pytest

from app.figures.holding import entry_steps, holding_entry, holding_wind, leg_minutes


def test_a_standard_hold_on_360():
    assert holding_entry(360, 360, "right")["entry"] == "direct"
    assert holding_entry(360, 90, "right")["entry"] == "direct"
    assert holding_entry(360, 300, "right")["entry"] == "direct"
    # From the north-west, heading south-east: the non-holding side, beyond the fix.
    assert holding_entry(360, 150, "right")["entry"] == "teardrop"
    # From the north-east, heading south-west, and from the east heading west: the holding side.
    assert holding_entry(360, 220, "right")["entry"] == "parallel"
    assert holding_entry(360, 270, "right")["entry"] == "parallel"


def test_left_turns_are_the_mirror():
    assert holding_entry(360, 210, "left")["entry"] == "teardrop"
    assert holding_entry(360, 140, "left")["entry"] == "parallel"
    assert holding_entry(360, 270, "left")["entry"] == "direct"
    assert holding_entry(90, 160, "left")["entry"] == "direct"


def test_within_5_degrees_of_a_sectors_edge_either_entry():
    assert holding_entry(360, 112, "right") == {"entry": "teardrop", "either": "direct"}
    assert holding_entry(360, 288, "right") == {"entry": "parallel", "either": "direct"}
    assert holding_entry(360, 45, "right")["either"] is None


def test_a_headwind_inbound_the_outbound_leg_shorter():
    w = holding_wind(360, 100, 360, 20, 5000)
    assert w["leg_min"] == 1
    assert w["inbound"]["gs"] == pytest.approx(80)
    assert w["outbound"]["gs"] == pytest.approx(120)
    # 80 kt for a minute is 1.33 nm, flown outbound at 120 kt: 40 s.
    assert w["outbound_sec"] == pytest.approx(40)
    assert w["rule_sec"] == pytest.approx(40)


def test_a_crosswind_outbound_three_times_the_inbound_correction_a_minute_and_a_half_up_high():
    w = holding_wind(360, 100, 90, 15, 16000)
    assert w["leg_min"] == 1.5
    assert w["inbound"]["wca"] == pytest.approx(8.63, abs=0.05)
    assert w["outbound"]["wca"] == pytest.approx(-3 * w["inbound"]["wca"])
    assert w["outbound"]["heading"] == pytest.approx(180 - 3 * w["inbound"]["wca"])
    assert holding_wind(360, 50, 90, 60, 5000) is None


def test_the_inbound_legs_time():
    # A minute at or below 14,000 ft MSL, a minute and a half above (AIM 5-3-8).
    assert leg_minutes(3000) == 1
    assert leg_minutes(14_000) == 1
    assert leg_minutes(14_001) == 1.5
    assert leg_minutes(17_000) == 1.5


def test_the_entries_in_words():
    assert entry_steps("direct", 360, "right", 5000) == "Fly to the fix and turn right to follow the pattern: outbound on 180°."
    teardrop = entry_steps("teardrop", 360, "right", 5000)
    assert teardrop.startswith("Fly to the fix, then turn to 150°, 30° into the holding side, for one minute")
    assert "for a minute and a half; then turn right" in entry_steps("parallel", 90, "left", 16000)
