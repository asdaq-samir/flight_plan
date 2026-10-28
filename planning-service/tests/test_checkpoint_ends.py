"""Checkpoints between a route's ends: none behind the departure or past
the destination, where its nav log flew out to one and back."""
from types import SimpleNamespace

from app import scoring


def _c(along: float, score: float, name: str) -> dict:
    return {"id": name, "category": "lake", "name": name, "lat": 0.0, "lon": 0.0,
            "along_track_nm": along, "predicted_score": score}


def _hop(dep: str, dest: str, length: float):
    return SimpleNamespace(dep_ident=dep, dest_ident=dest, length_nm=length)


def test_one_hop_takes_none_behind_its_departure_or_past_its_destination(monkeypatch):
    # KLSE-KCMY as the chart read it (2026-10-28): 22.9 nm, the best
    # scored a lake 2.6 nm behind La Crosse and a landing site 3.1 nm
    # past Camp Douglas.
    scored = [_c(-2.62, 4.2, "Lake"), _c(9.31, 4.3, "River near West Salem"), _c(12.5, 3.0, "Town"),
              _c(26.0, 4.6, "Young Tactical Landing Site"), _c(1.0, 4.9, "Beside the field")]
    monkeypatch.setattr(scoring, "score", lambda dep, dest: [dict(c) for c in scored])
    monkeypatch.setattr(scoring.places, "checkpoint_name", lambda *a: None)
    route = SimpleNamespace(hops=[_hop("KLSE", "KCMY", 22.9)], dep_ident="KLSE", dest_ident="KCMY")
    _, selected, by_hop = scoring.route_checkpoints(route)
    assert [c["name"] for c in selected] == ["River near West Salem"]
    assert by_hop == [selected]


def test_the_ends_are_three_nm_in_from_each_field(monkeypatch):
    scored = [_c(2.9, 4.0, "Too near the departure"), _c(3.0, 4.0, "Three out"),
              _c(17.0, 4.0, "Three short"), _c(17.1, 4.0, "Too near the destination")]
    monkeypatch.setattr(scoring, "score", lambda dep, dest: [dict(c) for c in scored])
    monkeypatch.setattr(scoring.places, "checkpoint_name", lambda *a: None)
    route = SimpleNamespace(hops=[_hop("A", "B", 20.0)], dep_ident="A", dest_ident="B")
    _, selected, _ = scoring.route_checkpoints(route)
    assert [c["name"] for c in selected] == ["Three out", "Three short"]
