from vfr.checkpoints import select_checkpoints, selection_gaps_nm


def _c(along, score, name="x"):
    return {"along_track_nm": along, "predicted_score": score, "name": name}


def test_returns_route_order_not_score_order():
    picked = select_checkpoints(
        [_c(0, 3.0, "a"), _c(30, 5.0, "b"), _c(60, 4.0, "c")], min_spacing_nm=10
    )
    assert [c["name"] for c in picked] == ["a", "b", "c"]


def test_spacing_drops_the_lower_scored_of_two_close_candidates():
    picked = select_checkpoints([_c(20, 4.9, "near"), _c(22, 5.0, "best")], min_spacing_nm=10)
    assert [c["name"] for c in picked] == ["best"]


def test_the_single_best_candidate_is_never_dropped():
    """The property greedy-by-score is chosen for: a cluster of decent
    candidates must not crowd out the one the model rates highest."""
    scored = [_c(i, 3.0) for i in range(0, 100, 3)] + [_c(50.5, 5.0, "best")]
    picked = select_checkpoints(scored, min_spacing_nm=10)
    assert "best" in [c["name"] for c in picked]


def test_min_score_leaves_a_gap_rather_than_picking_something_unusable():
    picked = select_checkpoints(
        [_c(0, 4.0, "a"), _c(40, 1.2, "bad"), _c(80, 4.0, "b")],
        min_spacing_nm=10,
        min_score=2.5,
    )
    assert [c["name"] for c in picked] == ["a", "b"]
    assert selection_gaps_nm(picked) == [80.0]


def test_max_count_caps_the_list():
    scored = [_c(i * 20, 3.0 + (i % 3)) for i in range(10)]
    assert len(select_checkpoints(scored, min_spacing_nm=10, max_count=4)) == 4


def test_ties_are_deterministic():
    scored = [_c(60, 4.0, "late"), _c(10, 4.0, "early")]
    twice = [select_checkpoints(scored, min_spacing_nm=100) for _ in range(2)]
    assert twice[0] == twice[1]
    assert twice[0][0]["name"] == "early"


def test_empty_and_all_filtered_out():
    assert select_checkpoints([]) == []
    assert select_checkpoints([_c(0, 1.0)], min_score=2.5) == []


def test_ignores_rows_missing_a_score():
    picked = select_checkpoints(
        [{"along_track_nm": 5.0, "name": "no score"}, _c(50, 4.0, "ok")], min_spacing_nm=10
    )
    assert [c["name"] for c in picked] == ["ok"]


def test_gaps_are_empty_for_a_single_checkpoint():
    assert selection_gaps_nm([_c(10, 4.0)]) == []
