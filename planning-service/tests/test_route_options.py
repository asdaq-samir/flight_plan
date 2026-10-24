"""FPL's Routes (/api/route-options): the ways to fly a route."""

from app.routers import route_options

ANSWER = {
    "options": [{"kind": "fastest", "kinds": ["fastest", "weather"], "title": "Fastest", "stops": ["KDSM"], "fuel": ["KDSM"],
                 "path": [[42.3, -88.1], [41.5, -93.7], [41.3, -95.9]], "distance_nm": 390.0, "air_min": 190.0,
                 "ground_min": 30.0, "fuel_gal": 31.7, "landings": 1, "crosses": [], "marginal": [],
                 "bands": [{"kind": "vfr", "min": 190.0}], "tail_kt": 6.0, "floor_ft": 2200}],
    "direct": [0], "ends": [], "current": [], "current_marginal": [],
    "current_along": {"bands": [{"kind": "storm", "min": 20.0}], "tail_kt": 2.0, "floor_ft": 2000},
    "hazards": [{"kind": "storm", "name": "Thunderstorms forecast at KCID"}], "unchecked": [],
}


def test_the_ways_with_the_airplanes_figures_and_the_pilots_minimums(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    asked = []

    def options(dep, dest, profile, **given):
        asked.append((dep, dest, profile, given))
        return ANSWER

    monkeypatch.setattr(route_options, "resolve", lambda *idents: tuple({"lat": 1.0 + i, "lon": 2.0} for i, _ in enumerate(idents)))
    monkeypatch.setattr(route_options.vfr_route_options, "options", options)
    client = TestClient(app)
    url = "/api/route-options?dep=c81&dest=koma&aircraft=c172&cruise_tas_kt=110&min_ceiling_ft=3000&min_visibility_sm=5"
    first = client.get(url)
    assert first.status_code == 200
    assert first.json() == ANSWER
    dep, dest, profile, given = asked[0]
    assert dep == {"ident": "C81", "lat": 1.0, "lon": 2.0} and dest["ident"] == "KOMA"
    assert profile["cruise_tas_kt"] == 110
    assert given["min_ceiling_ft"] == 3000 and given["min_visibility_sm"] == 5
    # Asked again within ten minutes, the answer kept.
    assert client.get(url).json() == ANSWER and len(asked) == 1
