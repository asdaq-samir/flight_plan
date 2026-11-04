"""The words endpoints (app.words, routers/words.py), Claude stubbed: a
sentence is kept only where every id it cites is a source given; the
briefer out of reach is an answer with no sentences and why; a briefing's
changes are found in Python, and no call is made where there are none."""
from types import SimpleNamespace

import anthropic
import pytest
from fastapi.testclient import TestClient

from app import words
from app.main import app
from app.routers import briefing as briefing_router
from app.routers import words as words_router
from app.schemas import Briefing

# Mounted here until app.main includes the router (the one line to add
# there); once it does, this finds it and adds nothing.
if not any(getattr(r, "path", "") == "/api/words/notams" for r in app.routes):
    app.include_router(words_router.router)
client = TestClient(app)
REAL_SAID = words._said
METAR_C81 = "KC81 061353Z AUTO 27008KT 10SM CLR 15/07 A2992"
METAR_KDLH = "KDLH 061353Z 09012KT 2SM BR OVC008 08/07 A2988"


def canned(monkeypatch, *outputs):
    """The model's answers, one a call, and each call's material."""
    calls = []

    def said(material, output):
        calls.append(material)
        return output.model_validate(outputs[len(calls) - 1])

    monkeypatch.setattr(words, "_said", said)
    return calls


def briefing(**over) -> dict:
    return {
        "hazards": [], "weather_unavailable": [], "airports": {},
        "metars": {"C81": {"raw": METAR_C81, "flight_category": "VFR", "visibility_sm": 10, "wind_speed_kt": 8}, "KDLH": None},
        "forecast": {"min_ceiling_ft": 3500, "min_visibility_sm": 6, "stations": [
            {"icaoId": "KDLH", "ceiling_ft": 3500, "visibility_sm": 6, "along_track_nm": 300.0, "eta": "2026-10-06T16:30:00Z",
             "eta_ceiling_ft": 3500, "eta_visibility_sm": 6, "raw": "KDLH 061130Z 0612/0712 09010KT P6SM BKN035"}]},
        **over,
    }


def test_a_sentence_citing_a_given_id_is_kept_with_its_source_and_one_citing_an_unknown_id_is_dropped(monkeypatch):
    calls = canned(monkeypatch, {"sentences": [
        {"text": "C81 is VFR with 10 sm.", "sources": ["metar:C81"]},
        {"text": "KDLH is IFR.", "sources": ["metar:C81", "metar:KDLH"]},  # not a source it was given
        {"text": "The sky is clear.", "sources": []},  # rests on nothing
    ]})
    given = [words.Source(id="metar:C81", label="C81 METAR", text=METAR_C81),
             words.Source(id="taf:KDLH", label="KDLH TAF", text="TAF text")]

    answer = words.say("Say it.", given)

    assert [s.text for s in answer.sentences] == ["C81 is VFR with 10 sm."]
    assert [s.id for s in answer.sources] == ["metar:C81"]  # the one cited, not every one given
    assert answer.unavailable is None and answer.model == words.WORDS_MODEL
    # The sources are set apart as data, and the ask follows them.
    assert '<source id="metar:C81" label="C81 METAR">\n' + METAR_C81 in calls[0] and calls[0].endswith("Say it.")


def test_the_sentences_are_capped_at_most_and_no_sources_is_no_call(monkeypatch):
    calls = canned(monkeypatch, {"sentences": [{"text": f"Sentence {i}.", "sources": ["a"]} for i in range(5)]})
    answer = words.say("Say it.", [words.Source(id="a", label="A", text="a")], most=2)
    assert len(answer.sentences) == 2 and len(calls) == 1
    assert words.say("Say it.", []).sentences == [] and len(calls) == 1


def test_the_briefer_out_of_reach_or_out_of_room_is_no_sentences_and_why(monkeypatch):
    # The real call, to a client whose key is refused, then to one that cut its answer off.
    monkeypatch.setattr(words, "_said", REAL_SAID)

    def refused(**kwargs):
        raise anthropic.AuthenticationError("invalid x-api-key", response=_response(401), body=None)

    monkeypatch.setattr(words.anthropic, "Anthropic", lambda: SimpleNamespace(messages=SimpleNamespace(parse=refused)))
    answer = words.say("Say it.", [words.Source(id="a", label="A", text="a")])
    assert answer.sentences == [] and "invalid x-api-key" in answer.unavailable

    cut = lambda **kwargs: SimpleNamespace(stop_reason="max_tokens", parsed_output=None)  # noqa: E731
    monkeypatch.setattr(words.anthropic, "Anthropic", lambda: SimpleNamespace(messages=SimpleNamespace(parse=cut)))
    answer = words.say("Say it.", [words.Source(id="a", label="A", text="a")])
    assert answer.sentences == [] and "ran out of room" in answer.unavailable


def test_briefing_changes_finds_a_category_change_and_none_when_identical():
    then = Briefing.model_validate(briefing())
    now = Briefing.model_validate(briefing(metars={"C81": {"raw": METAR_KDLH, "flight_category": "IFR"}, "KDLH": None}))

    changes = words_router.briefing_changes(then, now)

    assert [c.id for c in changes] == ["metar:C81"]
    assert changes[0].text == f"Was: {METAR_C81}\nNow: {METAR_KDLH}"
    assert words_router.briefing_changes(then, then) == []


def test_briefing_changes_sees_a_new_hazard_a_new_tfr_a_field_newly_below_vfr_and_a_forecast_across_a_line():
    then = Briefing.model_validate(briefing())
    now = Briefing.model_validate(briefing(
        hazards=[{"hazard": "CONVECTIVE", "type": "SIGMET", "raw": "WSUS32 KKCI 061655 SIGMET 2C"}],
        tfrs=[{"notam_id": "6/1234", "title": "Stadium", "geometry": {}, "along_track_nm": 120.0, "crosses": True, "active_now": True}],
        fields_below_vfr=[{"ident": "KDLH", "source": "TAF", "ceiling_ft": 800, "visibility_sm": 2,
                           "on_route": {"legs": [0], "from_nm": 290, "to_nm": 300, "source": "TAF"}}],
        forecast={"min_ceiling_ft": 800, "min_visibility_sm": 2, "stations": [
            {"icaoId": "KDLH", "ceiling_ft": 800, "visibility_sm": 2, "along_track_nm": 300.0, "eta": "2026-10-06T16:30:00Z",
             "eta_ceiling_ft": 800, "eta_visibility_sm": 2, "raw": "KDLH 061130Z 0612/0712 09010KT 2SM BR OVC008"}]},
    ))

    ids = [c.id for c in words_router.briefing_changes(then, now)]

    assert ids == ["hazard:0", "tfr:6/1234", "below-vfr:KDLH", "taf:KDLH"]
    # And gone the other way, the hazard is said to be gone.
    assert "hazard-gone:0" in [c.id for c in words_router.briefing_changes(now, then)]


def test_the_changes_endpoint_makes_no_call_when_nothing_changed(monkeypatch):
    calls = canned(monkeypatch, {"sentences": [{"text": "C81 went IFR.", "sources": ["metar:C81"]}]})
    body = {"dep": "C81", "dest": "KDLH", "then": briefing(), "now": briefing()}

    resp = client.post("/api/words/changes", json=body)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"changed": False, "sentences": [], "sources": [], "model": words.WORDS_MODEL, "unavailable": None}
    assert calls == []

    body["now"] = briefing(metars={"C81": {"raw": METAR_KDLH, "flight_category": "IFR"}, "KDLH": None})
    answer = client.post("/api/words/changes", json=body).json()
    assert answer["changed"] is True and [s["text"] for s in answer["sentences"]] == ["C81 went IFR."]
    assert len(calls) == 1 and '<source id="flight:route"' in calls[0]


def test_the_weather_words_rest_on_the_briefings_metar(monkeypatch):
    asked = {}

    def fake_briefing(dep, dest, stops="", depart=None, ete_min=None, fixes="", leg_min="", ground_min=""):
        asked.update(dep=dep, dest=dest, stops=stops, ete_min=ete_min, fixes=fixes)
        return briefing()

    monkeypatch.setattr(briefing_router, "briefing", fake_briefing)
    calls = canned(monkeypatch, {"sentences": [
        {"text": "C81 is VFR, wind 270 at 8.", "sources": ["metar:C81"]},
        {"text": "KDLH reports no weather.", "sources": ["metar:KDLH"]},
        {"text": "The route is clear of hazards.", "sources": ["hazards"]},  # no such source
    ]})

    resp = client.post("/api/words/weather", json={"dep": "c81", "dest": "kdlh", "stops": ["KMSN"], "ete_min": 150,
                                                   "depart": "2026-10-06T14:00:00Z", "fixes": "42,-88;46,-92"})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert asked == {"dep": "c81", "dest": "kdlh", "stops": "KMSN", "ete_min": 150, "fixes": "42,-88;46,-92"}
    assert [s["text"] for s in body["sentences"]] == ["C81 is VFR, wind 270 at 8.", "KDLH reports no weather."]
    assert {s["id"]: s["text"] for s in body["sources"]} == {
        "metar:C81": f"{METAR_C81}\nVFR: no ceiling · 10 sm.",
        "metar:KDLH": "No METAR reported for KDLH.",
    }
    # The TAF station was offered at the flight's time there, as the briefing placed it.
    assert '<source id="taf:KDLH"' in calls[0] and "the flight there 2026-10-06T16:30:00Z" in calls[0]
    assert "From C81 to KDLH via KMSN. Leaving 2026-10-06T14:00:00Z. 150 min planned in the air." in calls[0]


def test_the_notam_words_come_from_the_feeds_notams_at_the_fields_landed_at(monkeypatch):
    from vfr import notams

    asked = {}

    def at_fields(fields, now=None):
        asked["fields"] = fields
        return [{"id": "DLH 10/012", "location": "DLH", "starts": "2026-10-01T12:00:00Z", "ends": None, "estimated": False,
                 "schedule": None, "text": "RWY 09/27 CLSD", "raw": "!DLH 10/012 DLH RWY 09/27 CLSD 2610011200-PERM"}]

    monkeypatch.setattr(notams, "at_fields", at_fields)
    monkeypatch.setattr(notams, "since", lambda: 1_760_000_000.0)
    calls = canned(monkeypatch, {"sentences": [{"text": "Runway 09/27 at KDLH is closed.", "sources": ["notam:DLH 10/012"]}]})

    resp = client.post("/api/words/notams", json={"dep": "C81", "dest": "KDLH", "depart": "2026-10-06T14:00:00Z"})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert asked["fields"] == ["C81", "KDLH"]
    assert body["sentences"][0]["sources"] == ["notam:DLH 10/012"]
    assert body["sources"][0]["text"] == "!DLH 10/012 DLH RWY 09/27 CLSD 2610011200-PERM\nFrom 2026-10-01T12:00:00Z, until further notice."
    assert body["since"] == "2025-10-09T08:53:20Z" and body["unchecked"] == []
    assert len(calls) == 1

    # No NOTAM and no TFR: nothing to say, and no call.
    monkeypatch.setattr(notams, "at_fields", lambda fields, now=None: [])
    body = client.post("/api/words/notams", json={"dep": "C81", "dest": "KDLH"}).json()
    assert body["sentences"] == [] and body["unavailable"] is None and len(calls) == 1


def test_the_risk_words_are_asked_from_the_findings_the_factors_and_the_pilots_record(monkeypatch):
    calls = canned(monkeypatch, {"sentences": [
        {"text": "Your night currency lapses on the day.", "sources": ["risk:night_currency", "pilot:record"]},
    ]})
    verdict = {
        "line": {"finding": "caution", "words": "Caution: 1 thing to check"},
        "items": [{"key": "weather", "label": "Weather", "finding": "ok", "detail": "VFR at both ends.", "tab": "preflight"},
                  {"key": "fuel", "label": "Fuel", "finding": "caution", "detail": "2.1 gal over the reserve.", "tab": "preflight"}],
        "risk": {"score": 7, "level": "caution", "line": "Raised · 7 points", "words": "Bring it down where you can.",
                 "factors": [{"key": "night_currency", "label": "Night currency", "why": "No night landings in 90 days", "points": 4,
                              "finding": "caution"}]},
        "self_checks": [],
    }

    resp = client.post("/api/words/risk", json={"verdict": verdict, "pilot": {"ceiling_ft": 3000, "night_landings_90d": 0}})

    assert resp.status_code == 200, resp.text
    assert [s["id"] for s in resp.json()["sources"]] == ["risk:night_currency", "pilot:record"]
    material = calls[0]
    assert '<source id="finding:fuel" label="Fuel: caution">\n2.1 gal over the reserve.' in material
    assert '<source id="risk:line"' in material and "Raised · 7 points. Bring it down where you can. 7 points, level caution." in material
    assert "ceiling_ft: 3000\nnight_landings_90d: 0" in material


def test_the_debrief_words_carry_the_instructor_note_and_a_track_that_never_flew_is_a_422(monkeypatch):
    calls = canned(monkeypatch, {
        "sentences": [{"text": "The second leg ran 300 ft high.", "sources": ["leg:1", "tolerances"]}],
        "instructor_note": "Altitude on the second leg wants work.",
    })
    debrief = {
        "takeoff": 1_759_417_320_000, "landing": 1_759_419_480_000, "flown_min": 36.0, "planned_min": 36.0,
        "legs": [{"from": "A", "to": "Lake", "planned_alt_ft": 3500, "altitude_within": 0.9, "worst_alt_ft": 100, "course_deg": 0,
                  "course_within": 1.0, "worst_off_nm": 0.5, "ok": True},
                 {"from": "Lake", "to": "B", "planned_alt_ft": 3500, "altitude_within": 0.8, "worst_alt_ft": 300, "course_deg": 0,
                  "course_within": 1.0, "worst_off_nm": 0.5, "ok": False}],
        "passes": [{"name": "Lake", "category": "lake", "landed": False, "due_min": 18, "passed_min": 19.2, "closest_nm": 0.5,
                    "late_min": 1.2, "ok": True}],
        "patterns": [{"ident": "B", "alt_ft": 1800, "pattern_ft": 1700, "off_ft": 100, "ok": True}],
        "profile": [], "planned": [], "line": [], "has_altitude": True, "notes": ["The track starts 0.2 nm from A."],
    }
    tolerances = {"altitude_ft": 200, "course_deg": 15, "off_route_nm": 3, "eta_min": 5, "pattern_nm": 1.5, "pattern_ft": 100}

    resp = client.post("/api/words/debrief", json={"debrief": {"debrief": debrief, "tolerances": tolerances}})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["instructor_note"] == "Altitude on the second leg wants work."
    assert [s["id"] for s in body["sources"]] == ["leg:1", "tolerances"]
    assert body["sources"][0]["text"] == (
        "Lake to B: altitude within 200 ft of 3,500 ft for 80% of the cruise, furthest off 300 ft high; "
        "course 0° held within 15° for 100% of the way, furthest off the line 0.5 nm right; outside tolerance.")
    assert '<source id="pattern:B"' in calls[0] and "1,800 ft entering the pattern against 1,700 ft, 100 ft high" in calls[0]
    assert '<source id="time"' in calls[0] and "Took off 1502Z, landed 1538Z: 36 min in the air against 36 min planned." in calls[0]

    assert client.post("/api/words/debrief", json={"debrief": {"debrief": None, "tolerances": tolerances}}).status_code == 422


def _response(status: int):
    import httpx
    return httpx.Response(status, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))


@pytest.fixture(autouse=True)
def no_real_model(monkeypatch):
    """No test here may reach the model: a call not canned fails."""
    def unexpected(material, output):
        raise AssertionError("the model was asked without a canned answer")

    monkeypatch.setattr(words, "_said", unexpected)


def test_the_risk_words_read_the_webs_own_verdict_with_the_line_on_the_object(monkeypatch):
    """The web app's Brief keeps the Go / No-Go as lib/verdict's twin: the
    line's finding and words on the object itself, the items, no risk
    assessment (RiskWords sends it so)."""
    calls = canned(monkeypatch, {"sentences": [{"text": "Fuel is the finding to look at.", "sources": ["finding:fuel"]}]})
    verdict = {"finding": "caution", "words": "Caution: 1 thing to check",
               "items": [{"key": "fuel", "label": "Fuel", "finding": "caution", "detail": "2.1 gal over the reserve."}]}

    pilot = {"personal_minimums": {"ceiling_ft": 3000}, "currency": ["Night not current"]}
    resp = client.post("/api/words/risk", json={"verdict": verdict, "pilot": pilot})

    assert resp.status_code == 200, resp.text
    assert [s["id"] for s in resp.json()["sources"]] == ["finding:fuel"]
    assert '<source id="verdict:line" label="Go / No-Go">\ncaution: Caution: 1 thing to check' in calls[0]
    assert "currency: [\"Night not current\"]" in calls[0]


def test_the_debrief_words_read_the_webs_own_figures_camel_cased_and_unmarked(monkeypatch):
    """The web's DebriefWords sends lib/debrief's figures as they are: the
    keys camel-cased, no marks, no drawn line or profile; the marks are
    put on here as /api/debrief puts them on, the tolerances the engine's."""
    calls = canned(monkeypatch, {"sentences": [{"text": "The second leg ran high.", "sources": ["leg:1"]}], "instructor_note": None})
    figures = {
        "takeoff": 1_759_417_320_000, "landing": 1_759_419_480_000, "flownMin": 36.0, "plannedMin": 36.0,
        "legs": [{"from": "A", "to": "Lake", "plannedAltFt": 3500, "altitudeWithin": 0.9, "worstAltFt": 100, "courseDeg": 0,
                  "courseWithin": 1.0, "worstOffNm": 0.5},
                 {"from": "Lake", "to": "B", "plannedAltFt": 3500, "altitudeWithin": 0.8, "worstAltFt": 300, "courseDeg": 0,
                  "courseWithin": 1.0, "worstOffNm": 0.5}],
        "passes": [{"name": "Lake", "category": "lake", "dueMin": 18, "passedMin": 19.2, "closestNm": 0.5}],
        "patterns": [{"ident": "B", "altFt": 1800, "patternFt": 1700}],
        "hasAltitude": True, "notes": [],
    }

    resp = client.post("/api/words/debrief", json={"debrief": figures})

    assert resp.status_code == 200, resp.text
    assert [s["id"] for s in resp.json()["sources"]] == ["leg:1"]
    assert "furthest off 300 ft high" in calls[0] and "outside tolerance" in calls[0]
    assert '<source id="pattern:B"' in calls[0] and "100 ft high" in calls[0]
    assert client.post("/api/words/debrief", json={"debrief": {"takeoff": 1}}).status_code == 422
