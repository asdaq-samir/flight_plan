"""The words endpoints (app.words): the planner's own figures -- the
route's NOTAMs, its briefing, its Go / No-Go, a flown flight's debrief,
what changed in a briefing since the last look -- put into a few plain
sentences by Claude, each sentence citing the raw source it rests on.

The figures come from the planner as its other endpoints give them
(nothing is fetched here that the briefing, the Go / No-Go or the debrief
does not fetch already); the words come from the model; the sources go
back with the words by the ids the sentences cite, for the pilot to read
raw. A words answer never fails the figures: the model out of reach is a
200 with no sentences and `unavailable` set.

The ids a sentence cites: "flight:route"; "notam:<id>" ("notam:BJC
10/060"); "tfr:<notam id>"; "metar:<ident>"; "taf:<station>";
"hazard:<n>", "hazard-gone:<n>"; "gairmet:<n>", "gairmet-gone:<n>";
"pirep:<n>"; "below-vfr:<ident>"; "vfr-not-recommended"; "unchecked";
"verdict:line"; "finding:<key>"; "risk:line", "risk:<factor key>";
"pilot:record"; "time", "leg:<n>", "pass:<n>", "pattern:<ident>",
"note:<n>", "tolerances"."""
import json
import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from wingtip import notams, tfr

from .. import exposure
from ..common import load_route
from ..figures import debrief as debrief_rules
from ..figures.schemas import Debrief, DebriefAnswer, DebriefTolerances
from ..gonogo import ask as engine
from ..gonogo.schemas import RiskAssessment
from ..gonogo.words import WEATHER_SOURCE_LABEL, alt_ft, ceiling_and_visibility, gairmet_title, num, one, sigmet_hazard
from ..schemas import Briefing, ForecastStation, GAirmet, Hazard, OnRoute
from ..words import WORDS_MODEL, Source, WordsAnswer, WordsSaid, say
from . import briefing as briefing_router

router = APIRouter()

#: Where the briefing reports what it could not check, by source name
#: (Briefing.weather_unavailable).
_UNCHECKED_ID = "unchecked"


# --- The asks and the answers -------------------------------------------

#: The sentences a reading keeps: a pilot looks and goes (the owner,
#: 2026-11-03: "make it simpler for them to just look and go"), so a
#: reading is one to three short sentences with their chips, never a
#: paragraph; the debrief gets one more for the instructor's line.
MOST_SENTENCES = 3
MOST_DEBRIEF_SENTENCES = 4


class RouteAsk(BaseModel):
    """A route as the words are asked for it: its ends, the stops landed
    at between them in order (app.common.load_route) and when it leaves
    (UTC when naive; now when not given)."""

    dep: str
    dest: str
    stops: list[str] = []
    depart: datetime | None = None


class WeatherAsk(RouteAsk):
    """The briefing's own parameters besides the route (GET /api/briefing):
    the flight's minutes, and the nav log's fixes ("lat,lon;lat,lon") and
    each leg's minutes where the page has them, for each hazard to be
    placed where the flight meets it."""

    ete_min: float | None = None
    fixes: str = ""
    leg_min: str = ""


class VerdictLineLoose(BaseModel):
    finding: str
    words: str = ""


class VerdictItemLoose(BaseModel):
    key: str
    label: str
    finding: str
    detail: str = ""


class RiskVerdict(BaseModel):
    """The Go / No-Go as POST /api/go-no-go answers it (its line, its
    items, its risk assessment), or as the web app's own twin keeps it
    (lib/verdict: the line's finding and words on the object itself, its
    items, no risk assessment): either reads here, the extras dropped."""

    line: VerdictLineLoose | None = None
    finding: str | None = None
    words: str | None = None
    items: list[VerdictItemLoose] = []
    risk: RiskAssessment | None = None

    @property
    def over(self) -> VerdictLineLoose | None:
        """The line over the findings, however the client wrote it."""
        if self.line:
            return self.line
        return VerdictLineLoose(finding=self.finding, words=self.words or "") if self.finding else None


class RiskAsk(BaseModel):
    """The Go / No-Go as the client has it (RiskVerdict), and the pilot's
    own record as the client keeps it -- personal minimums, currency,
    recency, whatever it has, by its own keys -- given to the model as one
    source the words can cite."""

    verdict: RiskVerdict
    pilot: dict | None = None


class DebriefWordsAsk(BaseModel):
    """The debrief as POST /api/debrief answered it (the debrief and the
    tolerances), or as the web app's own twin keeps it (lib/debrief: the
    figures alone, their keys camel-cased, without the flown line and the
    profile, thousands of points a sentence cannot use): `debrief_of`
    reads either."""

    debrief: dict


def _snake(value):
    """The web's camelCase keys as the planner's snake_case, all the way
    down: flownMin to flown_min, plannedAltFt to planned_alt_ft."""
    if isinstance(value, dict):
        return {re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", k).lower(): _snake(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_snake(v) for v in value]
    return value


def debrief_of(raw: dict) -> DebriefAnswer:
    """The debrief and its tolerances from what the client sent: the
    planner's own answer as it was, or the web's figures with the drawn
    lists left empty and the engine's tolerances put beside them."""
    if "tolerances" in raw or "debrief" in raw:
        return DebriefAnswer.model_validate(raw)
    # The web's twin keeps no marks (FlightPage works them beside each
    # figure), so they are put on here as /api/debrief puts them on.
    figures = debrief_rules.marked({"profile": [], "planned": [], "line": [], **_snake(raw)})
    return DebriefAnswer(
        debrief=Debrief.model_validate(figures),
        tolerances=DebriefTolerances(
            altitude_ft=debrief_rules.ALTITUDE_FT, course_deg=debrief_rules.COURSE_DEG, off_route_nm=debrief_rules.OFF_ROUTE_NM,
            eta_min=debrief_rules.ETA_MIN, pattern_nm=debrief_rules.PATTERN_NM, pattern_ft=debrief_rules.PATTERN_FT,
        ),
    )


class ChangesAsk(BaseModel):
    """A briefing read twice, as GET /api/briefing answered it then and
    now."""

    dep: str
    dest: str
    stops: list[str] = []
    then: Briefing
    now: Briefing


class NotamWords(WordsAnswer):
    """The NOTAM words, with since when the planner has heard the NOTAM
    feed (ISO 8601 UTC; None where it has not yet): until the feed's
    first load of what was already in force, the list is not the whole
    list for a field. `unchecked` names "tfrs" where tfr.faa.gov did not
    answer, so an empty list does not read as no TFRs."""

    since: str | None = None
    unchecked: list[str] = []


class DebriefWords(WordsSaid):
    """The debrief's words: the sentences, and one paragraph for the
    pilot's instructor written from them."""

    instructor_note: str | None = Field(
        default=None,
        description="One paragraph for the pilot's instructor, from the sentences above and nothing else: no new figure or fact.",
    )


class DebriefWordsAnswer(WordsAnswer):
    instructor_note: str | None = None


class ChangesWords(WordsAnswer):
    """Whether anything changed; with nothing changed there are no words."""

    changed: bool


# --- Sources from the planner's figures ---------------------------------


def _start(depart: datetime | None) -> float:
    return time.time() if depart is None else (depart if depart.tzinfo else depart.replace(tzinfo=timezone.utc)).timestamp()


def _flight_source(dep: str, dest: str, stops: list[str], start: float | None = None, ete_min: float | None = None) -> Source:
    """The flight itself, for a sentence about it to rest on."""
    way = " via " + ", ".join(stops) if stops else ""
    lines = [f"From {dep} to {dest}{way}."]
    if start is not None:
        lines.append(f"Leaving {exposure.iso(start)}.")
    if ete_min is not None:
        lines.append(f"{num(one(ete_min))} min planned in the air.")
    return Source(id="flight:route", label="The flight", text=" ".join(lines))


def _meets(on: OnRoute | None) -> str:
    """Where and when the flight meets a hazard, from the briefing's own
    placing of it (app.exposure)."""
    if on is None:
        return ""
    text = f"The flight meets it from {num(on.from_nm)} to {num(on.to_nm)} nm along the route"
    if on.enter and on.leave:
        text += f", there {on.enter} to {on.leave}"
    if on.valid_from or on.valid_to:
        text += f"; it is valid {_span(on.valid_from, on.valid_to)}"
    when = {"during": "while it is in force", "before": "before it comes into force", "after": "after it has ended"}
    if on.when:
        text += f"; the airplane is there {when[on.when]}"
    return text + "."


def _span(starts: str | None, ends: str | None, capital: bool = False) -> str:
    """"from 2026-10-01T12:00:00Z to 2026-10-02T12:00:00Z", or ", until
    further notice" where it has no end; "From" at the start of a line."""
    return f"{'From' if capital else 'from'} {starts or 'now'}" + (f" to {ends}" if ends else ", until further notice")


def _altitudes(low: float | None, high: float | None) -> str:
    if low is None and high is None:
        return ""
    return f"From {alt_ft(low) + ' ft' if low is not None else 'the surface'} to {alt_ft(high) + ' ft' if high is not None else 'above'}."


def _notam_source(n: dict) -> Source:
    """A NOTAM as the FAA's feed gave it (wingtip.notams.at_fields), with its
    times in ISO beside the form a briefing reads."""
    when = _span(n.get("starts"), n.get("ends"), capital=True)
    if n.get("estimated"):
        when += " (estimated)"
    if n.get("schedule"):
        when += f"; schedule {n['schedule']}"
    return Source(id=f"notam:{n['id']}", label=f"NOTAM {n['id']}", text=f"{n.get('raw') or n.get('text') or ''}\n{when}.")


def _tfr_source(t: dict) -> Source:
    """A TFR as wingtip.tfr reads its NOTAM and places it on the route."""
    lines = [f"TFR {t['notam_id']}: {t.get('title') or 'no title'}."]
    kind = ", ".join(x for x in (t.get("kind"), t.get("purpose")) if x)
    if kind:
        lines.append(kind + ".")
    if t.get("rule"):
        lines.append(f"Rule: {t['rule']}.")
    lines.append(_span(t.get("effective"), t.get("expires"), capital=True) + ".")
    if t.get("floor_ft") is not None or t.get("ceiling_ft") is not None:
        floor = f"{alt_ft(t['floor_ft'])} ft {t.get('floor_ref') or ''}".strip() if t.get("floor_ft") is not None else "the surface"
        top = f"{alt_ft(t['ceiling_ft'])} ft {t.get('ceiling_ref') or ''}".strip() if t.get("ceiling_ft") is not None else "above"
        lines.append(f"From {floor} to {top}.")
    if t.get("along_track_nm") is not None:
        through = "goes through it" if t.get("crosses") else "passes near it"
        lines.append(f"{num(t['along_track_nm'])} nm along the route; the route {through}.")
    if t.get("active_now"):
        lines.append("In force now.")
    on = t.get("on_route")
    if on:
        lines.append(_meets(OnRoute.model_validate(on)))
    return Source(id=f"tfr:{t['notam_id']}", label=f"TFR {t['notam_id']}", text=" ".join(lines))


def _hazard_source(h: Hazard, i: int, gone: bool = False) -> Source:
    kind = h.type or "SIGMET"
    what = sigmet_hazard(h.hazard, kind)
    text = " ".join(x for x in (h.raw or f"{kind}: {what}.", _altitudes(h.altitude_low_ft, h.altitude_high_ft), _meets(h.on_route)) if x)
    return Source(id=f"hazard{'-gone' if gone else ''}:{i}", label=f"{'Gone: ' if gone else ''}{kind}, {what}", text=text)


def _gairmet_source(g: GAirmet, i: int, gone: bool = False) -> Source:
    # gairmet_title reads the Go / No-Go's dict, so the model is dumped
    # for it (a live briefing's first reading raised on the model).
    title = gairmet_title(g.model_dump())
    lines = [f"G-AIRMET: {title}."]
    if g.due_to:
        lines.append(f"Due to {g.due_to}.")
    # As the web's gairmetAltitudes writes them: AWC gives an IFR G-AIRMET
    # a top of -1, which is no top, and such a one has no altitude line.
    top = f"{alt_ft(g.altitude_high_ft)} ft" if g.altitude_high_ft is not None and g.altitude_high_ft > 0 else None
    low = "the freezing level" if g.from_freezing_level else (f"{alt_ft(g.altitude_low_ft)} ft" if g.altitude_low_ft is not None else None)
    if top:
        lines.append(f"From {low or 'the surface'} to {top}.")
    elif g.from_freezing_level:
        lines.append("From the freezing level.")
    if g.valid_at:
        lines.append(f"Valid at {g.valid_at}.")
    if g.on_route:
        lines.append(_meets(g.on_route))
    label = f"{'Gone: ' if gone else ''}G-AIRMET, {title}"
    return Source(id=f"gairmet{'-gone' if gone else ''}:{i}", label=label, text=" ".join(lines))


def _metar_source(ident: str, metar) -> Source:
    if metar is None or not metar.raw:
        return Source(id=f"metar:{ident}", label=f"{ident} METAR", text=f"No METAR reported for {ident}.")
    about = f"{metar.flight_category or 'no category'}: {ceiling_and_visibility(metar.ceiling_ft, metar.visibility_sm)}"
    return Source(id=f"metar:{ident}", label=f"{ident} METAR, {metar.flight_category or 'no category'}", text=f"{metar.raw}\n{about}.")


def _taf_source(s: ForecastStation) -> Source:
    lines = []
    if s.along_track_nm is not None:
        lines.append(f"{num(s.along_track_nm)} nm along the route" + (f", the flight there {s.eta}" if s.eta else "") + ".")
    if s.eta:
        lines.append(f"Forecast for then: {ceiling_and_visibility(s.eta_ceiling_ft, s.eta_visibility_sm)}.")
    lines.append(f"Worst over the flight: {ceiling_and_visibility(s.ceiling_ft, s.visibility_sm)}.")
    if s.raw:
        lines.append(s.raw)
    return Source(id=f"taf:{s.icaoId}", label=f"{s.icaoId} TAF", text="\n".join(lines))


def _briefing_sources(b: Briefing) -> list[Source]:
    """Every figure of a briefing a sentence can rest on, in briefing
    order: what cannot be checked, the reasons not to go VFR, the fields
    below VFR, each field's METAR, each TAF station at the flight's time
    there, the hazards, the G-AIRMETs, the pilot reports and the TFRs."""
    out: list[Source] = []
    if b.weather_unavailable:
        names = ", ".join(WEATHER_SOURCE_LABEL.get(w, w) for w in b.weather_unavailable)
        out.append(Source(id=_UNCHECKED_ID, label="Not checked", text=f"Could not be checked, the source did not answer: {names}."))
    if b.vfr_not_recommended:
        out.append(Source(id="vfr-not-recommended", label="VFR flight not recommended",
                          text="VFR flight not recommended (AIM 7-1-5): " + "; ".join(b.vfr_not_recommended) + "."))
    for f in b.fields_below_vfr:
        out.append(Source(id=f"below-vfr:{f.ident}", label=f"{f.ident} below VFR",
                          text=f"{f.ident} is below VFR where the flight meets it, by its {f.source}"
                               f"{' (' + f.flight_category + ')' if f.flight_category else ''}: "
                               f"{ceiling_and_visibility(f.ceiling_ft, f.visibility_sm)}. {_meets(f.on_route)}"))
    out += [_metar_source(ident, m) for ident, m in b.metars.items()]
    out += [_taf_source(s) for s in b.forecast.stations]
    out += [_hazard_source(h, i) for i, h in enumerate(b.hazards)]
    out += [_gairmet_source(g, i) for i, g in enumerate(b.gairmets)]
    for i, p in enumerate(b.pireps):
        lines = [p.raw or "Pilot report."]
        if p.urgent:
            lines.append("Urgent.")
        if p.on_route:
            lines.append(_meets(p.on_route))
        out.append(Source(id=f"pirep:{i}", label="Pilot report" + (f" at {alt_ft(p.altitude_ft)} ft" if p.altitude_ft is not None else ""),
                          text=" ".join(lines)))
    out += [_tfr_source(t.model_dump()) for t in b.tfrs]
    return out


def _record_lines(record: dict) -> str:
    """A client's free-form record as lines, a nested value as JSON."""
    return "\n".join(f"{k}: {v if isinstance(v, (str, int, float, bool)) or v is None else json.dumps(v)}" for k, v in record.items())


def _z(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%H%MZ")


def _off(ft: float | None, unit: str, up: str, down: str) -> str:
    if ft is None:
        return ""
    return f"{alt_ft(abs(ft)) if unit == 'ft' else num(one(abs(ft)))} {unit} {up if ft > 0 else down}"


def _debrief_sources(d: Debrief, t: DebriefTolerances) -> list[Source]:
    """Each figure of the debrief as a line: the time in the air, each
    leg's altitude and course held, each checkpoint's time, each pattern
    entry, the notes, and the tolerances they are marked against."""
    planned = f" against {num(one(d.planned_min))} min planned" if d.planned_min is not None else ""
    out = [Source(id="time", label="Time in the air",
                  text=f"Took off {_z(d.takeoff)}, landed {_z(d.landing)}: {num(one(d.flown_min))} min in the air{planned}.")]
    for i, leg in enumerate(d.legs):
        parts = [f"{leg.from_} to {leg.to}:"]
        if leg.planned_alt_ft is not None and leg.altitude_within is not None:
            worst = f", furthest off {_off(leg.worst_alt_ft, 'ft', 'high', 'low')}" if leg.worst_alt_ft is not None else ""
            parts.append(f"altitude within {num(t.altitude_ft)} ft of {alt_ft(leg.planned_alt_ft)} ft "
                         f"for {round(leg.altitude_within * 100)}% of the cruise{worst};")
        else:
            parts.append("altitude not graded;")
        if leg.course_deg is not None and leg.course_within is not None:
            off = f", furthest off the line {_off(leg.worst_off_nm, 'nm', 'right', 'left')}" if leg.worst_off_nm is not None else ""
            parts.append(f"course {num(leg.course_deg)}° held within {num(t.course_deg)}° "
                         f"for {round(leg.course_within * 100)}% of the way{off};")
        else:
            parts.append("course not graded;")
        parts.append("within tolerance." if leg.ok else "outside tolerance.")
        out.append(Source(id=f"leg:{i}", label=f"Leg {leg.from_} to {leg.to}", text=" ".join(parts)))
    for i, p in enumerate(d.passes):
        parts = [f"{p.name} ({p.category}){', landed at' if p.landed else ''}:"]
        if p.due_min is not None:
            parts.append(f"due {num(one(p.due_min))} min after takeoff;")
        if p.passed_min is not None:
            parts.append(f"{'reached' if p.landed else 'passed'} at {num(one(p.passed_min))} min;")
        else:
            parts.append("never reached;")
        if p.late_min is not None:
            parts.append(f"{num(one(abs(p.late_min)))} min {'late' if p.late_min > 0 else 'early'};")
        if p.closest_nm is not None:
            parts.append(f"closest {num(one(p.closest_nm))} nm;")
        parts.append("within tolerance." if p.ok else "outside tolerance." if p.ok is False else "time not known.")
        out.append(Source(id=f"pass:{i}", label=f"Checkpoint {p.name}", text=" ".join(parts)))
    for p in d.patterns:
        out.append(Source(id=f"pattern:{p.ident}", label=f"Pattern at {p.ident}",
                          text=f"{p.ident}: {alt_ft(p.alt_ft)} ft entering the pattern against {alt_ft(p.pattern_ft)} ft, "
                               f"{_off(p.off_ft, 'ft', 'high', 'low')}; {'within' if p.ok else 'outside'} tolerance."))
    out += [Source(id=f"note:{i}", label="Note", text=n) for i, n in enumerate(d.notes)]
    out.append(Source(id="tolerances", label="Tolerances (ACS PA.VI.A and PA.III.B)",
                      text=f"Altitude within {num(t.altitude_ft)} ft, course within {num(t.course_deg)}°, "
                           f"off route by {num(t.off_route_nm)} nm at most, each checkpoint within {num(t.eta_min)} min of its "
                           f"estimate, the pattern altitude within {num(t.pattern_ft)} ft at {num(t.pattern_nm)} nm from the field."))
    return out


def _category(ceiling_ft: float | None, visibility_sm: float | None, ceiling_unknown: bool = False) -> str | None:
    """The flight category of a ceiling and visibility, as the engine sets
    it from the AWC's lines (wingtip_engine::metar::flight_category, the
    one copy the web and the phones share); None with neither, or with a
    ceiling forecast with no height ("OVC///") the visibility does not
    settle (14 CFR 1.1: not known, not none)."""
    return engine("flight_category", ceiling_ft=ceiling_ft, visibility_sm=visibility_sm, ceiling_unknown=ceiling_unknown)


def _hazard_key(h: Hazard) -> str:
    return h.raw or f"{h.type} {h.hazard} {h.altitude_low_ft} {h.altitude_high_ft}"


def _gairmet_key(g: GAirmet) -> str:
    return f"{g.hazard} {g.severity} {g.due_to} {g.altitude_low_ft} {g.altitude_high_ft} {g.from_freezing_level}"


def briefing_changes(then: Briefing, now: Briefing) -> list[Source]:
    """What changed between two readings of a route's briefing, each
    change a source with both readings: a field whose METAR's flight
    category changed; a SIGMET/AIRMET or G-AIRMET new or gone; a TFR new;
    a field newly below VFR; a TAF station whose forecast for the
    flight's time there moved across a flight-category line (the AWC's
    VFR/MVFR/IFR/LIFR, the engine's flight_category). Empty where nothing
    did."""
    out: list[Source] = []
    for ident in dict.fromkeys([*now.metars, *then.metars]):
        a, b = then.metars.get(ident), now.metars.get(ident)
        was, is_ = a.flight_category if a else None, b.flight_category if b else None
        if was != is_:
            out.append(Source(id=f"metar:{ident}", label=f"{ident} METAR, {was or 'none'} to {is_ or 'none'}",
                              text=f"Was: {a.raw if a and a.raw else 'no METAR'}\nNow: {b.raw if b and b.raw else 'no METAR'}"))
    then_hazards, now_hazards = {_hazard_key(h) for h in then.hazards}, {_hazard_key(h) for h in now.hazards}
    out += [_hazard_source(h, i) for i, h in enumerate(now.hazards) if _hazard_key(h) not in then_hazards]
    out += [_hazard_source(h, i, gone=True) for i, h in enumerate(then.hazards) if _hazard_key(h) not in now_hazards]
    then_g, now_g = {_gairmet_key(g) for g in then.gairmets}, {_gairmet_key(g) for g in now.gairmets}
    out += [_gairmet_source(g, i) for i, g in enumerate(now.gairmets) if _gairmet_key(g) not in then_g]
    out += [_gairmet_source(g, i, gone=True) for i, g in enumerate(then.gairmets) if _gairmet_key(g) not in now_g]
    then_tfrs = {t.notam_id for t in then.tfrs}
    out += [_tfr_source(t.model_dump()) for t in now.tfrs if t.notam_id not in then_tfrs]
    then_below = {(f.ident, f.source) for f in then.fields_below_vfr}
    for f in now.fields_below_vfr:
        if (f.ident, f.source) not in then_below:
            out.append(Source(id=f"below-vfr:{f.ident}", label=f"{f.ident} newly below VFR",
                              text=f"{f.ident} is now below VFR where the flight meets it, by its {f.source}: "
                                   f"{ceiling_and_visibility(f.ceiling_ft, f.visibility_sm)}. {_meets(f.on_route)}"))
    then_stations = {s.icaoId: s for s in then.forecast.stations}
    for s in now.forecast.stations:
        before = then_stations.get(s.icaoId)
        if before is None:
            continue
        # The forecast for the flight's time there where both readings
        # placed the station; else the worst over the flight.
        at = lambda x: (x.eta_ceiling_ft, x.eta_visibility_sm) if x.eta and before.eta else (x.ceiling_ft, x.visibility_sm)  # noqa: E731
        unknown = lambda x: x.eta_ceiling_unknown if x.eta and before.eta else x.ceiling_unknown  # noqa: E731
        was, is_ = _category(*at(before), unknown(before)), _category(*at(s), unknown(s))
        if was != is_:
            out.append(Source(id=f"taf:{s.icaoId}", label=f"{s.icaoId} TAF, {was or 'none'} to {is_ or 'none'}",
                              text=f"Was: {ceiling_and_visibility(*at(before))}\n{before.raw or ''}\n"
                                   f"Now: {ceiling_and_visibility(*at(s))}\n{s.raw or ''}"))
    return out


# --- The endpoints ------------------------------------------------------

NOTAMS_ASK = ("Which of these NOTAMs and TFRs matter for this flight, and why: the most important first, one sentence each, "
              "leaving out those that do not bear on it. At most three sentences, each short: the pilot looks and goes.")
WEATHER_ASK = ("The weather for this flight as a pilot would brief it: the departure now, each leg at its time, the destination "
               "at arrival, then what could change it -- the hazards, the pilot reports, the TFRs. Where the figures give a "
               "reason not to go VFR, say so plainly. At most three sentences, each short: the pilot looks and goes.")
RISK_ASK = ("Where the risk in this flight is, in the pilot's terms: the weather, the airplane, the pilot's own recency and "
            "minimums, the plan; and what would lower it, where the findings say. The most important first. Never say the "
            "flight is safe. At most three sentences, each short: the pilot looks and goes.")
DEBRIEF_ASK = ("The flight as flown against its plan, as an instructor would debrief it: what was held and what was not, leg by "
               "leg, the checkpoints' times and the pattern entries, the most important first. Then one paragraph for the "
               "pilot's instructor, from those sentences alone. At most four sentences, each short: the pilot looks and goes.")
CHANGES_ASK = ("What changed in this flight's weather since the last look, and what it means for the flight: each change in a "
               "sentence, the most important first, with both readings where they help. At most three sentences, each short.")


@router.post("/api/words/notams")
def notam_words(ask: RouteAsk) -> NotamWords:
    """The NOTAMs that matter for a flight, in a few sentences. The figures
    are the planner's: the NOTAMs in force or to come at every field the
    route lands at, as the FAA's NOTAM feed gave them (wingtip.notams, SWIM's
    FNS), and the TFRs near the route over the briefing's hours
    (wingtip.tfr.along_route, as GET /api/briefing asks them: two hours of
    flight and an hour past, the route's own time not being known here).
    The words are the model's; the sources are the pilot's to read raw.
    With no NOTAM and no TFR there is nothing to say and no call."""
    r = load_route(ask.dep, ask.dest, ask.stops)
    fields = list(dict.fromkeys(i for i, a in zip(r.idents, r.airports) if not a.get("fix")))
    start = _start(ask.depart)
    found = notams.at_fields(fields, now=start)
    path = [(a["lat"], a["lon"]) for a in r.airports]
    end = start + briefing_router.DEFAULT_ETE_MIN * 60 + briefing_router.MARGIN_S
    unchecked = []
    try:
        tfrs = tfr.along_route(path, datetime.fromtimestamp(start, timezone.utc), datetime.fromtimestamp(end, timezone.utc))
    except tfr.TfrUnavailable:
        tfrs, unchecked = [], ["tfrs"]
    items = [*map(_notam_source, found), *map(_tfr_source, tfrs)]
    words = say(NOTAMS_ASK, [_flight_source(r.idents[0], r.idents[-1], ask.stops, start), *items] if items else [], most=MOST_SENTENCES)
    return NotamWords(**words.model_dump(), since=exposure.iso(notams.since()), unchecked=unchecked)


@router.post("/api/words/weather")
def weather_words(ask: WeatherAsk) -> WordsAnswer:
    """The weather for a flight as a briefer would say it, in a few
    sentences. The figures are the planner's briefing (GET /api/briefing,
    asked here with the same parameters: its METARs, its TAF stations at
    the flight's time there, its hazards, G-AIRMETs, pilot reports and
    TFRs, the fields below VFR and its own "VFR flight not recommended");
    the words are the model's; the sources are the pilot's to read raw. A
    briefing that cannot be had fails as it does there (a 502)."""
    raw = briefing_router.briefing(ask.dep, ask.dest, ",".join(ask.stops), ask.depart, ask.ete_min, ask.fixes, ask.leg_min)
    b = Briefing.model_validate(raw)
    flight = _flight_source(ask.dep.upper(), ask.dest.upper(), ask.stops, _start(ask.depart),
                            ask.ete_min if ask.ete_min is not None else briefing_router.DEFAULT_ETE_MIN)
    return say(WEATHER_ASK, [flight, *_briefing_sources(b)], most=MOST_SENTENCES)


@router.post("/api/words/risk")
def risk_words(ask: RiskAsk) -> WordsAnswer:
    """Where the risk in a flight is, in a few sentences. The figures are
    the Go / No-Go's (POST /api/go-no-go: its line, each finding's line,
    the risk assessment's level and every factor it counted) and the
    pilot's own record as the client sends it; the words are the model's;
    the sources are the pilot's to read raw. Never "safe": the decision
    is the pilot in command's (14 CFR 91.3), and the briefer is told so."""
    v = ask.verdict
    sources = []
    if (line := v.over) is not None:
        sources.append(Source(id="verdict:line", label="Go / No-Go", text=f"{line.finding}: {line.words}"))
    sources += [Source(id=f"finding:{i.key}", label=f"{i.label}: {i.finding}", text=i.detail) for i in v.items]
    if v.risk:
        sources.append(Source(id="risk:line", label="Risk assessment",
                              text=f"{v.risk.line}. {v.risk.words} {v.risk.score} points, level {v.risk.level}."))
        for f in v.risk.factors:
            unlawful = " Makes the flight unlawful as planned." if f.stop else ""
            sources.append(Source(id=f"risk:{f.key}", label=f.label, text=f"{f.why or f.label}. {f.points} points.{unlawful}"))
    if ask.pilot:
        sources.append(Source(id="pilot:record", label="The pilot's record", text=_record_lines(ask.pilot)))
    return say(RISK_ASK, sources, most=MOST_SENTENCES)


@router.post("/api/words/debrief")
def debrief_words(ask: DebriefWordsAsk) -> DebriefWordsAnswer:
    """A flown flight's debrief in a few sentences, and a paragraph for
    the pilot's instructor written from them. The figures are the
    debrief's (POST /api/debrief: the time in the air, each leg's altitude
    and course held, each checkpoint's time, each pattern entry, its
    notes, and the ACS tolerances they are marked against); the words are
    the model's; the sources are the pilot's to read raw. A 422 where
    there is no debrief: the track never flew."""
    try:
        answer = debrief_of(ask.debrief)
    except (ValueError, KeyError, TypeError) as err:
        # A validation error, or the marks asked of figures with no legs,
        # passes or patterns at all: not a debrief either way.
        raise HTTPException(422, f"The debrief is not in a shape the words can read: {err!r}") from err
    if answer.debrief is None:
        raise HTTPException(422, "There is no debrief to put into words: the track never flew faster than taxiing.")
    sources = _debrief_sources(answer.debrief, answer.tolerances)
    return say(DEBRIEF_ASK, sources, most=MOST_DEBRIEF_SENTENCES, output=DebriefWords, answer=DebriefWordsAnswer)


@router.post("/api/words/changes")
def changes_words(ask: ChangesAsk) -> ChangesWords:
    """What changed in a flight's briefing since the last look, in a few
    sentences, for a watch that reads the briefing again every half
    hour. The changes are found here first (briefing_changes), in
    Python, and the words asked only where there is one: the figures are
    the planner's two readings, the words the model's, the sources --
    each change with both readings -- the pilot's to read raw. With no
    change there is no call at all, which is most half hours: a watch on
    every saved flight asking the model each time would be the app's
    largest bill for nothing to say."""
    changes = briefing_changes(ask.then, ask.now)
    if not changes:
        return ChangesWords(changed=False, sentences=[], sources=[], model=WORDS_MODEL)
    words = say(CHANGES_ASK, [_flight_source(ask.dep.upper(), ask.dest.upper(), ask.stops), *changes], most=MOST_SENTENCES)
    return ChangesWords(changed=True, **words.model_dump())
