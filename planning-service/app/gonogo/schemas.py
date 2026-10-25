"""POST /api/go-no-go's question and answer: the route as /api/navlog is
asked it, what only the pilot knows -- their minimums, the loading, the
risk assessment's ticks, their logbook's currency and their own airplane's
records -- and the Go / No-Go the planner works out of them with its own
plan and briefing."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from ..common import DEFAULT_AIRCRAFT
from ..schemas import AltitudeChoice, FlightRules, Loading

Finding = Literal["ok", "caution", "stop", "unknown", "pending"]
VerdictKey = Literal["weather", "airspace", "altitude", "fuel", "runways", "balance", "risk"]
VerdictTab = Literal["preflight", "depart", "enroute", "arrive"]
RiskLevel = Literal["low", "caution", "high"]


class PersonalMinimums(BaseModel):
    """The weather the pilot will not take off or land in, each off (None)
    until set (lib/minimums): the lowest ceiling, feet above the field;
    the least visibility, statute miles; the most crosswind on the best
    runway and the most surface wind, gusts included, knots."""

    ceiling_ft: float | None = None
    visibility_sm: float | None = None
    crosswind_kt: float | None = None
    wind_kt: float | None = None


class AirplaneLoad(BaseModel):
    """What the pilot loads (lib/weightBalance Load): the airplane's own
    empty weight and arm, each station's pounds in the loading's order,
    and the fuel at the start, gallons."""

    empty_weight_lb: float = Field(gt=0)
    empty_arm_in: float
    stations_lb: list[float]
    fuel_gal: float = Field(ge=0)


class PilotCurrency(BaseModel):
    """The pilot's currency from their logbook, as the gateway's
    /api/logbook/currency gives it (in snake case): the dates are the
    last days each holds, "yyyy-mm-dd"."""

    flights: int = 0
    total_hours: float = 0
    day_passengers_until: str | None = None
    night_passengers_until: str | None = None
    instrument_current_until: str | None = None
    ipc_needed_after: str | None = None
    flight_review_until: str | None = None
    medical_expires_on: str | None = None


class AirplaneInspections(BaseModel):
    """The pilot's own airplane's inspections and tests as its owner
    recorded them on the gateway: each its last good day, "yyyy-mm-dd"."""

    annual_good_through: str | None = None
    elt_inspection_good_through: str | None = None
    elt_battery_due_on: str | None = None
    static_check_good_through: str | None = None
    transponder_check_good_through: str | None = None
    hundred_hour_due_at_hours: float | None = None
    hours_now: float | None = None


class OpenSquawk(BaseModel):
    """A squawk not yet fixed, and how far its 14 CFR 91.213(d)
    determination reaches, where one was made."""

    text: str
    inoperative: bool = False
    deferred_for: Literal["VFR_DAY", "VFR", "ALL"] | None = None


class VorCheck(BaseModel):
    """The airplane's last VOR check (14 CFR 91.171): its last good day and
    whether its error was within limits."""

    good_through: str
    within_limit: bool


class OwnAirplane(BaseModel):
    """The pilot's own airplane being flown, its records from the gateway;
    left out for a stock profile, which has none."""

    vor_check: VorCheck | None = None
    inspections: AirplaneInspections | None = None
    squawks: list[OpenSquawk] = []


class RunwayPicks(BaseModel):
    """The runway ends the pilot picked, by field: `pattern` the
    departure's runway out and every other field's runway in, `takeoff` a
    stop's runway out ("24", as painted)."""

    pattern: dict[str, str] = {}
    takeoff: dict[str, str] = {}


class GoNoGoAsk(BaseModel):
    """The route, as /api/navlog is asked it (PlanQuery's fields), and what
    only the pilot knows."""

    dep: str
    dest: str
    stops: str = ""
    altitude_ft: float | None = None
    altitude_nearest: bool = False
    altitude_choice: AltitudeChoice = "fastest"
    aircraft: str = DEFAULT_AIRCRAFT
    cruise_tas_kt: float | None = Field(default=None, gt=0, le=1000)
    fuel_burn_gph: float | None = None
    usable_fuel_gal: float | None = None
    climb_tas_kt: float | None = Field(default=None, gt=0, le=1000)
    climb_fuel_burn_gph: float | None = None
    cruise_power_pct: float | None = Field(default=None, ge=40, le=100)
    service_ceiling_ft: float | None = Field(default=None, ge=1000, le=30000)
    #: When the flight leaves (UTC when naive); now when not given.
    depart: datetime | None = None
    class_b_clearance: bool = False
    rules: FlightRules = "vfr"
    alternate: str = ""
    altitudes: str = ""
    procedures: str = ""
    runways: str = ""
    crossings: str = ""
    holds: str = ""
    ground: str = ""
    checkpoints: bool = True
    #: The day of the flight where the pilot is, "yyyy-mm-dd", that the
    #: logbook's and the airplane's dates are read on; the departure's UTC
    #: day when not given.
    day: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    minimums: PersonalMinimums = PersonalMinimums()
    #: The loading; the POH's sample airplane, a pilot of 170 lb and full
    #: usable fuel when not given (lib/weightBalance defaultLoad).
    load: AirplaneLoad | None = None
    #: The risk assessment's own checks the pilot ticked, by key
    #: (GoNoGo.self_checks).
    ticked: list[str] = []
    currency: PilotCurrency | None = None
    own_airplane: OwnAirplane | None = None
    runway_picks: RunwayPicks | None = None


class VerdictItem(BaseModel):
    """One tab's finding: what it is, what was found in a line, and where
    it is shown in full (a tab of the Brief and a section by its title)."""

    key: VerdictKey
    label: str
    finding: Finding
    detail: str
    tab: VerdictTab
    section: str | None = None


class VerdictLine(BaseModel):
    finding: Finding
    words: str


class RiskFactor(BaseModel):
    """What raises the risk (lib/frat): why it counts, its points, and
    whether it makes the flight unlawful as planned (`stop`)."""

    key: str
    label: str
    why: str | None = None
    points: int
    stop: bool = False
    #: Its mark as the web's RiskAssessment draws it: a stop for one that
    #: makes the flight unlawful or is high on its own, else a caution.
    finding: Literal["caution", "stop"] = "caution"


class RiskCheck(RiskFactor):
    """One of the checks only the pilot can answer, in its group."""

    group: str


class RiskAssessment(BaseModel):
    """The risk assessment: its points, its level and its line ("Raised ·
    8 points"), what to do at that level, and every factor counted."""

    score: int
    level: RiskLevel
    line: str
    words: str
    factors: list[RiskFactor]


class LoadCondition(BaseModel):
    weight_lb: float
    #: The centre of gravity, inches aft of the datum.
    arm_in: float


class LoadBalance(BaseModel):
    """The weight and balance for the load used: the pilot's, or the
    POH's sample airplane where none was sent."""

    load: AirplaneLoad
    takeoff: LoadCondition
    landing: LoadCondition
    problems: list[str]


class GoNoGo(BaseModel):
    """POST /api/go-no-go: the line over the findings and each finding,
    with what the Brief's Risk and Loading pages show beside them."""

    line: VerdictLine
    items: list[VerdictItem]
    risk: RiskAssessment | None = None
    #: The checks the pilot can tick, in the order shown.
    self_checks: list[RiskCheck]
    #: The airplane's POH loading, for the Loading page; None where its
    #: profile has none.
    loading: Loading | None = None
    balance: LoadBalance | None = None
