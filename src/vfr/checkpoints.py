"""Turning the model's scored candidates into an actual nav-log checkpoint
list.

model-service scores every candidate in the corridor -- 206 of them on
C81->KDLH -- and that is a ranking, not a flight plan. A pilot flies a
handful of checkpoints, far enough apart to be worth timing between and
close enough together to catch a heading error before it compounds. This
module is the step that was missing between the two: until 2026-09-10 the
nav-log agent consumed the scored list and zipped *all* of it into
consecutive legs, producing 205 legs and, in effect, throwing the model's
judgment away while carrying its numbers around.

Deliberately pure-Python over a list of dicts, with no pandas or numpy:
this runs inside the lean nav-log-agent image and is called on the
response body of an HTTP request, where a DataFrame round-trip would buy
nothing.
"""

# A VFR pilotage checkpoint every 10-15 nm is the conventional spacing:
# close enough that a heading error shows up before it has taken you
# somewhere unrecognizable, far enough that you are not head-down the
# whole leg. 10.0 is the low end of that, which suits a slow trainer.
DEFAULT_MIN_SPACING_NM = 10.0

# Below this the model is saying it would not pick the feature out.
# Leaving a genuine gap in the route is more honest than filling it with
# something a pilot will look for and fail to see.
DEFAULT_MIN_SCORE = 2.5


def select_checkpoints(
    scored: list,
    min_spacing_nm: float = DEFAULT_MIN_SPACING_NM,
    max_count: int | None = None,
    min_score: float | None = DEFAULT_MIN_SCORE,
) -> list:
    """Pick nav-log checkpoints from model-service's scored candidates.

    `scored` is the /invocations checkpoint list: dicts with at least
    `along_track_nm` and `predicted_score`. Returns the chosen subset in
    route order (by along-track distance), ready to be zipped into legs.

    Greedy by score, subject to spacing: take the highest-scored candidate
    still at least `min_spacing_nm` from everything already taken, and
    repeat. Selecting purely by score would cluster -- the three
    best-scoring features on this route are lakes at 269, 143 and 231 nm,
    and two of them being adjacent lakes is not a nav log. Selecting purely
    by spacing would ignore the model entirely, which is what the previous
    behaviour amounted to.

    Greedy is used rather than an optimal dynamic program because the
    objective here is a judgment call, not a well-posed optimum: there is
    no principled exchange rate between "one better checkpoint" and "more
    even spacing". Greedy-by-score has the property that actually matters,
    which is that the single best feature on the route is never dropped to
    tidy up spacing elsewhere.

    max_count=None means "as many as the spacing allows", which is usually
    what you want -- a 300 nm route needs more checkpoints than a 40 nm
    one, and the spacing rule already scales with route length.
    """
    usable = [
        c for c in scored
        if c.get("along_track_nm") is not None
        and c.get("predicted_score") is not None
        and (min_score is None or c["predicted_score"] >= min_score)
    ]
    # Ties broken by along-track distance so the result is deterministic:
    # equal-scoring candidates otherwise come out in whatever order the
    # caller's JSON happened to arrive in.
    by_score = sorted(usable, key=lambda c: (-c["predicted_score"], c["along_track_nm"]))

    chosen: list = []
    for cand in by_score:
        if max_count is not None and len(chosen) >= max_count:
            break
        if all(abs(cand["along_track_nm"] - t["along_track_nm"]) >= min_spacing_nm for t in chosen):
            chosen.append(cand)
    return sorted(chosen, key=lambda c: c["along_track_nm"])


def selection_gaps_nm(selected: list) -> list:
    """Along-track distances between consecutive selected checkpoints.

    Worth surfacing rather than hiding: min_score means a stretch of route
    with nothing worth looking at produces a long leg, and a pilot should
    be told that rather than discovering it in the air.
    """
    return [
        round(b["along_track_nm"] - a["along_track_nm"], 2)
        for a, b in zip(selected, selected[1:])
    ]
