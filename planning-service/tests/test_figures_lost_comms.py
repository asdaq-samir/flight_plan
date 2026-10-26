"""web/src/lib/lostComms.test.ts's cases for app.figures.lost_comms, 14 CFR
91.185."""
from app.figures.lost_comms import fly_words, leave_limit, segment_altitudes


def test_each_segment_at_the_highest_of_assigned_minimum_and_expected():
    flown = segment_altitudes(
        [{"name": "to SWEDE", "minimum_ft": 2600}, {"name": "SWEDE to RAYMO", "minimum_ft": 5000},
         {"name": "RAYMO to the approach", "minimum_ft": 3400}],
        4000, 6000, 1,
    )
    assert flown == [
        {"name": "to SWEDE", "fly": 4000, "because": "assigned"},
        {"name": "SWEDE to RAYMO", "fly": 6000, "because": "expected"},
        {"name": "RAYMO to the approach", "fly": 6000, "because": "expected"},
    ]
    # An MEA above both: the MEA.
    assert segment_altitudes([{"name": "x", "minimum_ft": 7000}], 4000, 6000, 0)[0] == {"name": "x", "fly": 7000, "because": "minimum"}
    assert segment_altitudes([{"name": "x", "minimum_ft": None}], None, None, 0)[0]["fly"] is None
    assert fly_words(flown[1]) == "Fly 6,000 ft: expected"
    assert fly_words({"name": "x", "fly": None, "because": None}) == "No altitude known"


def test_leaving_the_clearance_limit_at_the_efc_else_the_eta():
    assert "expect-further-clearance time, 1420Z" in leave_limit(True, "1420Z", "1435Z")
    assert "estimated time of arrival, 1435Z" in leave_limit(True, "", "1435Z")
    on_arriving = leave_limit(False, "", "1435Z")
    assert on_arriving.startswith("Leave the clearance limit on arriving over it, proceed to a fix an approach begins from")
    assert "Leave the clearance limit at the expect-further-clearance time, 1420Z" in leave_limit(False, "1420Z", "")
