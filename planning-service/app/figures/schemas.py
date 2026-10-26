"""The questions and answers of the four figures' endpoints (app.figures):
POST /api/debrief, GET /api/diversion, GET /api/holding and POST
/api/lost-comms."""
from typing import Literal

from pydantic import BaseModel, Field

from ..schemas import Wind

# --- The debrief --------------------------------------------------------


class DebriefCheckpoint(BaseModel):
    """A saved flight's checkpoint, as the gateway keeps it
    (FlightCheckpointDto): its place and the plan's figures into it."""

    sequence_no: int
    name: str
    #: "departure", "stop", "destination", or a checkpoint's own kind.
    category: str
    lat: float
    lon: float
    along_track_nm: float
    true_course_deg: float | None = None
    altitude_ft: float | None = None
    ete_min: float | None = None


class DebriefPoint(BaseModel):
    """A point of the flown track (TrackDto): when, ms since 1970; GPS
    altitude, feet above sea level, where the file has one."""

    t: float
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    alt_ft: float | None = None


class DebriefAsk(BaseModel):
    """The saved flight's checkpoints and its track's points in time order,
    as many as the gateway keeps (TrackDto: 2 to 5,000)."""

    checkpoints: list[DebriefCheckpoint] = Field(min_length=2, max_length=200)
    points: list[DebriefPoint] = Field(min_length=2, max_length=5000)


class LegGrade(BaseModel):
    """A leg graded: the share of its cruise within the altitude tolerance
    and of its way within the course tolerance (0 to 1, None where none was
    graded), its furthest off each (altitude + high, distance + right), and
    `ok`, neither past its tolerance."""

    from_: str = Field(alias="from")
    to: str
    planned_alt_ft: float | None
    altitude_within: float | None
    worst_alt_ft: float | None
    course_deg: float | None
    course_within: float | None
    worst_off_nm: float | None
    ok: bool

    model_config = {"populate_by_name": True}


class CheckpointPass(BaseModel):
    """A checkpoint: minutes from the takeoff it was due and was passed (or
    landed at), None where the plan had no time or the track never got
    there; its closest, nm; how late (+) or early, and `ok`, within the
    tolerance (None where either time is not known)."""

    name: str
    category: str
    landed: bool
    due_min: float | None
    passed_min: float | None
    closest_nm: float | None
    late_min: float | None
    ok: bool | None


class PatternEntry(BaseModel):
    """The altitude PATTERN_NM from a field landed at, against its pattern
    altitude, ft MSL."""

    ident: str
    alt_ft: float
    pattern_ft: float
    off_ft: float
    ok: bool


class ProfilePoint(BaseModel):
    along_nm: float
    alt_ft: float


class PlannedStep(BaseModel):
    from_nm: float
    to_nm: float
    alt_ft: float | None


class LinePoint(BaseModel):
    """The flight as flown, for the map: `off` where it was outside a
    tolerance there."""

    lat: float
    lon: float
    off: bool


class Debrief(BaseModel):
    """The flight debriefed: its takeoff and landing (ms since 1970), its
    time in the air and the plan's, leg by leg, the checkpoints and the
    patterns, the profile flown and planned, the line for the map, and
    notes on what does not fit."""

    takeoff: float
    landing: float
    flown_min: float
    planned_min: float | None
    legs: list[LegGrade]
    passes: list[CheckpointPass]
    patterns: list[PatternEntry]
    profile: list[ProfilePoint]
    planned: list[PlannedStep]
    line: list[LinePoint]
    has_altitude: bool
    notes: list[str]


class DebriefTolerances(BaseModel):
    """ACS PA.VI.A's and PA.III.B's tolerances the debrief holds the flight
    to, for the page's headings."""

    altitude_ft: float
    course_deg: float
    off_route_nm: float
    eta_min: float
    pattern_nm: float
    pattern_ft: float


class DebriefAnswer(BaseModel):
    """The debrief, or None where the track never flew faster than taxiing."""

    debrief: Debrief | None
    tolerances: DebriefTolerances


# --- The diversion drill ------------------------------------------------


class DiversionSolved(BaseModel):
    """The diversion worked out: true course and distance, the correction
    (+ right), true and magnetic heading, ground speed, minutes and gallons."""

    tc: float
    distance_nm: float
    wca: float
    th: float
    mh: float
    gs: float
    ete: float
    fuel: float


class Step(BaseModel):
    name: str
    value: str


class EstimateCheck(BaseModel):
    """A student's estimate against the exact figure: reasonable within its
    allowance, and the figure written as the drill writes it."""

    key: Literal["mh", "gs", "ete", "fuel"]
    label: str
    unit: str
    allowance: float
    typed: float | None
    exact: float | None
    written: str | None
    reasonable: bool | None


class Diversion(BaseModel):
    """To a field from a point, in the planner's air there: the field, the
    air it is flown in (`wind` None where no forecast was near: worked
    with none), the solution and its steps in words, or `problem` where no
    heading holds; and each estimate given, checked."""

    to: str
    name: str
    altitude_ft: float
    tas_kt: float
    fuel_burn_gph: float
    magnetic_variation_deg: float
    wind: Wind | None
    solved: DiversionSolved | None
    steps: list[Step]
    problem: str | None
    checks: list[EstimateCheck]


# --- Holding ------------------------------------------------------------


class HoldLeg(BaseModel):
    heading: float
    wca: float
    gs: float


class HoldingWind(BaseModel):
    """The legs in the wind: the inbound leg's minutes, each leg's heading,
    correction and ground speed, the outbound time by the speeds and by the
    rule of a second a knot, seconds, and each row's line in words."""

    leg_min: float
    inbound: HoldLeg
    outbound: HoldLeg
    outbound_sec: float
    rule_sec: float
    inbound_words: str
    outbound_words: str
    time_words: str


class Holding(BaseModel):
    """A hold's entry by AIM 5-3-8 and its steps in words, the other entry
    within 5 degrees of a sector's edge, where the airplane comes from
    round the fix (for drawing), and the legs in the wind where one was
    given -- or `wind_problem` where it is stronger than the airplane."""

    entry: Literal["direct", "teardrop", "parallel"]
    entry_name: str
    steps: str
    either: Literal["direct", "teardrop", "parallel"] | None
    either_name: str | None
    approach_relative: float
    wind: HoldingWind | None
    wind_problem: str | None


# --- Lost communications ------------------------------------------------


class LostCommsSegment(BaseModel):
    name: str = ""
    minimum_ft: float | None = None


class LostCommsAsk(BaseModel):
    """The clearance and the route's segments: the altitude assigned, the
    one to expect and from which segment on, each segment's minimum for
    IFR operations, and for leaving the limit whether it is a fix an
    approach begins from, the EFC and the ETA as the pilot writes them."""

    segments: list[LostCommsSegment] = Field(min_length=1, max_length=50)
    assigned_ft: float | None = None
    expected_ft: float | None = None
    expected_from: int = Field(0, ge=0)
    approach_fix: bool = False
    efc: str = Field("", max_length=40)
    eta: str = Field("", max_length=40)


class LostCommsRoute(BaseModel):
    key: str
    label: str
    rule: str


class FlownSegment(BaseModel):
    name: str
    fly: float | None
    because: Literal["assigned", "minimum", "expected"] | None
    words: str


class LostComms(BaseModel):
    """91.185: VFR's words, the routes in the rule's order, each segment's
    altitude and why, and when to leave the clearance limit."""

    vfr: str
    routes: list[LostCommsRoute]
    segments: list[FlownSegment]
    leave: str
