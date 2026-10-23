"""Every shape this service sends, as Pydantic models.

FastAPI validates each response against its model and publishes them all
in /openapi.json; web/ generates its TypeScript types from that document
(`npm run types`), so a field renamed here is a compile error there
rather than a silent `undefined` at runtime. The streamed NDJSON
messages live here too: no route "returns" them, so app.main adds their
unions to the OpenAPI components by hand.
"""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

Rating = Literal[0, 1, 2, 3, 4, 5]
Role = Literal["dr", "visual"]
Source = Literal["detected", "added"]
#: The flight rules a route is planned under: VFR, or IFR (vfr.ifr).
FlightRules = Literal["vfr", "ifr"]


# --- the plan -----------------------------------------------------------


class AirportEnd(BaseModel):
    """A point of the route: an airport, or -- a stop only -- a named fix
    flown through (`kind` "fix": a VFR or GPS waypoint, its `name` the
    kind of fix it is, no elevation)."""

    ident: str
    name: str
    lat: float
    lon: float
    elevation_ft: float | None = None
    kind: Literal["airport", "fix"] = "airport"
    #: An airport's: the class of the airspace at its surface, as its card
    #: has it (vfr.airspace.surface_class_at) -- for the route's points to
    #: be drawn in their airspace's look the moment the course is in,
    #: where each was a card's whole lookup (its METAR among it) behind
    #: the plan being made.
    airspace_class: Literal["B", "C", "D", "E", "G"] | None = None
    #: An airport's traffic pattern altitude above sea level, to the nearest
    #: hundred feet (the TPA the FAA publishes, else 1,000 ft over the
    #: field): what the route's box offers as the altitude there.
    pattern_altitude_ft: float | None = None


class ChartSheet(BaseModel):
    """One sheet of an overlay chart kind and where it is: the map
    offers to pin the terminal area chart when the view is over one."""

    name: str
    label: str
    west: float
    south: float
    east: float
    north: float


class ChartLayer(BaseModel):
    """One kind of FAA chart the map can draw and the zooms it has
    tiles for: the sectional and the IFR enroute charts as base layers
    (`base`), the terminal area chart as an overlay."""

    kind: str
    label: str
    min_zoom: int
    max_zoom: int
    base: bool
    # For an overlay, the base kinds it belongs over.
    over: list[str] = []
    # For an overlay, its sheets and their extents.
    sheets: list[ChartSheet] = []


class ChartInfo(BaseModel):
    """Which chart the map draws and where its tiles are: the map with no
    route on it yet asks for this alone (/api/chart), and a Course
    carries it as well."""

    chart_layers: list[ChartLayer]
    # The zooms the sectional layer draws at. Each overlay's own are in
    # chart_layers.
    max_zoom: int
    min_zoom: int
    # The chart edition the tile endpoints are serving. The map puts it
    # in every tile URL, so a browser that cached tiles under the same
    # {z}/{x}/{y} from an earlier edition -- or from the hosted service
    # this app drew before, whose no-coverage checkerboard one phone
    # went on showing for a day -- asks afresh when it changes.
    chart_cycle: str
    # How many times tiles already served for that edition have been
    # rendered again (a sheet cleaned on disk): in the tile URL beside
    # the cycle for the same reason, since a re-render leaves {z}/{x}/{y}
    # and the cycle as they were.
    chart_revision: int = 0
    # Where the map fetches tiles when the pyramid is published to a
    # CDN (the AWS deployment): a base URL the map appends
    # /<cycle>/<kind>/{z}/{x}/{y}.png to. None when this planner
    # serves its own tiles.
    chart_tiles_base: str | None = None


class Course(ChartInfo):
    """The course: the departure, the stops it lands at on the way (in
    order; none for a route flown straight), the destination, the whole
    distance stop by stop, the bearing out of the departure, and the line
    through every stop."""

    departure: AirportEnd
    destination: AirportEnd
    stops: list[AirportEnd] = []
    distance_nm: float
    bearing_deg: float
    course_line: list[tuple[float, float]]
    #: Whether the chart along every hop is read already, so its
    #: checkpoints, and the nav log through them, are a moment away: the
    #: web app asks for the route as entered beside them only where they
    #: are not.
    checkpoints_ready: bool = False


class Candidate(BaseModel):
    """A scored detection off the chart (app.scoring): `id` its kind and
    place, `name` the FAA's for an airport and the kind of thing for
    the rest. `selected` is set by the server's greedy pass."""

    id: str
    name: str | None = None
    category: str
    lat: float
    lon: float
    predicted_score: float
    along_track_nm: float
    selected: bool
    #: Which hop of a route with stops it is on, from 0 (app.common.Route).
    hop: int = 0
    #: A selected checkpoint's waypoint name in the route's ForeFlight pack
    #: (app.foreflight.waypoint_names: LAKE_ZURICH), for a flight plan to
    #: name it by; None for a candidate not selected.
    waypoint: str | None = None


class Checkpoints(BaseModel):
    """Every hop's candidates and selected checkpoints in order along the
    whole route (app.scoring.route_checkpoints), its along-track
    distances running on through each stop."""

    departure: AirportEnd
    destination: AirportEnd
    stops: list[AirportEnd] = []
    candidates: list[Candidate]
    selected: list[Candidate]


class Wind(BaseModel):
    wind_dir_true_deg: float
    wind_speed_kt: float


class LegPoint(BaseModel):
    """A point on a leg that the nav log has a row for, the leg cut there.
    The miles, minutes and gallons are from the leg's start;
    `altitude_ft`, the level there."""

    along_nm: float
    ete_min: float
    fuel_gal: float | None
    altitude_ft: float
    lat: float
    lon: float


class TopOfClimb(LegPoint):
    """Where a climb tops out (TOC), and the climb's true airspeed and
    ground speed on the way up to it (vfr.navlog.with_climbs)."""

    tas_kt: float
    groundspeed_kt: float


class TopOfDescent(LegPoint):
    """Where a descent starts (TOD): down from `altitude_ft` to `to_ft` --
    the pattern altitude of the field landed at, the altitude an
    approach's first fix is crossed at, or the next leg's lower level --
    at `fpm`, three to one at the leg's ground speed, or steeper where
    the climb before it left less room (vfr.navlog.with_descents)."""

    to_ft: float
    # Whether `to_ft` is the pattern altitude at the field the flight
    # lands at, rather than a lower level on the way.
    pattern: bool
    # The approach's fix `to_ft` is crossed at, where the flight lands by
    # one (plan.approach_end).
    fix: str | None = None
    fpm: float


class MissedApproachPath(BaseModel):
    """An approach's missed approach as it is flown, from its missed
    approach point and round its hold once (vfr.procedure_paths.missed_path),
    and the altitude it climbs to: the highest its fixes set."""

    path: list[list[float]]
    ft: float | None


class LegProcedure(BaseModel):
    """A leg flown by the procedures picked -- out by a departure, in by an
    arrival and an approach (vfr.procedure_paths.flown) -- rather than as
    the route goes: its path from the leg's start, [lat, lon] pairs; the
    altitude the chart sets at each point (None where it sets none); its
    length; whether it comes down to a runway; where its final starts, the
    index in `path` of its final approach fix; where its missed approach
    point is, the index in `path` the missed approach is flown from (short
    of the runway's threshold, where the path ends, on a VOR's or a LOC's
    approach); and the approach's missed approach. The miles it is more than the leg's own, and the time and
    fuel they take at the leg's ground speed and cruise burn, are in the
    leg's `ete_min` and `fuel_gal` (plan.with_procedures)."""

    path: list[list[float]]
    ft: list[float | None]
    nm: float
    landing: bool
    final_at: int | None = None
    map_at: int | None = None
    missed: MissedApproachPath | None = None
    more_nm: float
    more_min: float
    more_gal: float


class LegHold(BaseModel):
    """A hold the pilot put at a point of the route (vfr.holds), on the
    leg that leaves it -- `at_end`, the leg into the destination it is
    held at: its inbound course (magnetic), its turns, its legs by time or
    distance, how long (turns, or minutes), the minutes and fuel it takes,
    already in the leg's `ete_min` and `fuel_gal` (plan.with_holds), one
    turn round its racetrack's minutes, the entry from the course flown to
    it (AIM 5-3-8), and that one turn as [lat, lon] pairs from the point."""

    fix: str
    inbound_deg: int
    right: bool
    leg_min: float | None
    leg_nm: float | None
    turns: int | None
    minutes: float
    lap_min: float
    gal: float
    entry: Literal["direct", "teardrop", "parallel"]
    path: list[list[float]]
    at_end: bool = False


class Leg(BaseModel):
    """One dead-reckoning leg. `wind` is None when no winds-aloft station
    is near enough, which is not the same as calm: groundspeed then falls
    back to true airspeed. groundspeed/ETE/fuel are None when the wind
    exceeds true airspeed, i.e. the leg cannot be flown.

    The true airspeed and fuel flow are the aeroplane's in the leg's own
    air (vfr.performance): its cruise figures are at a reference
    altitude on a standard day, and the forecast temperature at this
    altitude gives the density altitude they are flown at, at the power
    it allows -- the cruise power, or less where full throttle cannot
    make it. `oat_c` is None where no forecast temperature was near: a
    standard day is assumed there."""

    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    distance_nm: float
    altitude_ft: float
    true_course_deg: float
    wind: Wind | None
    wca_deg: float
    true_heading_deg: float
    magnetic_variation_deg: float
    magnetic_heading_deg: float
    groundspeed_kt: float | None
    ete_min: float | None
    fuel_gal: float | None
    tas_kt: float
    fuel_burn_gph: float
    power_pct: float
    oat_c: float | None = None
    density_altitude_ft: float
    # How much of the leg's time is climb -- from the field on the first
    # leg, and up to a new level where a plan steps -- flown at climb
    # speed and burn, and already in `ete_min` and `fuel_gal`.
    climb_min: float = 0.0
    # The top of the climb, on the leg it is reached on, and the top of
    # the descent, on the leg it starts on.
    toc: TopOfClimb | None = None
    tod: TopOfDescent | None = None
    # Flown by the procedures picked, the time and fuel of their miles
    # more already in `ete_min` and `fuel_gal` (plan.with_procedures).
    procedure: LegProcedure | None = None
    # A hold the pilot put at its start (or, into the destination, its
    # end), its time and fuel already in `ete_min` and `fuel_gal`.
    hold: LegHold | None = None
    # Into a stop the route lands at and leaves again: the minutes on the
    # ground there before the next leg (the pilot's own, else the
    # planner's TURNAROUND_MIN), not in `ete_min`. None on every other
    # leg.
    ground_min: float | None = None
    # Along an airway (vfr.airways, the route's "BAE V191 OSH"): the
    # segment flown and its published altitudes, the MEA the floor under
    # IFR (14 CFR 91.177(a)(1)), for the nav log's route column as a paper
    # IFR log has one. None off an airway.
    airway: "AirwayAltitudes | None" = None


class AlternateLeg(BaseModel):
    """The leg from the destination on to the IFR alternate: flown at the
    route's last altitude in its winds, or in still air where they could
    not be read (`still_air`)."""

    ident: str
    distance_nm: float
    ete_min: float
    fuel_gal: float
    altitude_ft: float
    still_air: bool = False


class Totals(BaseModel):
    """The trip's sums, and the fuel check: the legs' fuel plus the VFR
    reserve (30 minutes by day, 45 at night -- `night` is None when no
    departure time said which) against the aeroplane's usable fuel,
    when it has one. `fuel_margin_gal` below zero is a flight the tanks
    do not hold."""

    distance_nm: float
    #: The miles the procedures picked add to the route's, flown in place
    #: of its legs (plan.with_procedures): in `distance_nm`, and their time
    #: and fuel in `ete_min` and `fuel_gal`.
    procedure_nm: float = 0.0
    ete_min: float | None
    fuel_gal: float | None
    unflyable_legs: int
    legs_without_wind: int
    reserve_min: float | None = None
    reserve_gal: float | None = None
    #: Start, taxi and takeoff, included in fuel_required_gal.
    taxi_gal: float | None = None
    fuel_required_gal: float | None = None
    usable_fuel_gal: float | None = None
    fuel_margin_gal: float | None = None
    night: bool | None = None
    #: The rules the reserve is under: IFR's 45 minutes day or night
    #: (14 CFR 91.167(a)(3)), VFR's 30 by day and 45 at night (91.151).
    rules: FlightRules = "vfr"
    #: Under IFR with an alternate filed: the leg on to it, whose fuel is
    #: in `fuel_required_gal` before the reserve (14 CFR 91.167(a)(2)).
    alternate: "AlternateLeg | None" = None
    #: A route with stops: each flight between two landings with its own
    #: fuel check, the tanks filled at each stop -- the route's own fuel
    #: figures are None then (app.planning.route_totals). Empty without.
    hops: list["HopTotals"] = []
    #: Where a flight the tanks do not hold could land for fuel
    #: (vfr.fuelstops), one entry a flight short of fuel; empty where every
    #: flight's fuel check passes.
    fuel_stops: list["FuelStopSuggestion"] = []
    #: Minutes on the ground at the route's stops (PlanQuery.ground), not in
    #: `ete_min`: the destination's arrival is `ete_min` and this after the
    #: departure. 0 without stops.
    ground_min: float = 0.0
    #: When the plan was made, ISO UTC.
    planned_at: str | None = None
    #: The period of the winds-aloft forecast the legs fly (a route with
    #: stops, its first flight's; each hop has its own): None where it
    #: could not be read.
    winds: "WindsPeriod | None" = None


class WindsPeriod(BaseModel):
    """A winds and temperatures aloft forecast's period (AC 00-45H, the
    Winds and Temperatures Aloft Forecast (FB)):
    valid at `valid_at`, for use from `use_from` to `use_to`, ISO UTC."""

    valid_at: str
    use_from: str
    use_to: str


class FuelStop(BaseModel):
    """A field with the airplane's fuel a flight can land at for it, with
    its reserve left (vfr.fuelstops)."""

    ident: str
    name: str
    city: str
    lat: float
    lon: float
    #: Miles from the flight's departure to it, and the miles it adds to
    #: the flight's straight line.
    from_nm: float
    added_nm: float
    #: The fuel left on landing there, gallons.
    lands_with_gal: float
    #: Minutes flown to it from the flight's departure.
    minutes: float
    #: What fuel it sells, as the FAA lists it ("100LL,A").
    fuel_types: str
    #: Its longest paved runway, feet.
    runway_ft: int
    elevation_ft: float | None = None


class FuelStopSuggestion(BaseModel):
    """The stops that take one flight short of fuel to its destination with
    the reserve left at every landing, the tanks filled at each, and other
    fields the first could be. `reason` is "fuel": breaks for a meal or a
    rest are the pilot's to pick from the map's Stops."""

    departure: str
    destination: str
    #: The tanks' usable fuel, gallons, each stop's landing measured against.
    usable_gal: float
    reason: Literal["fuel", "break"] = "fuel"
    stops: list[FuelStop]
    choices: list[FuelStop] = []


class HopTotals(BaseModel):
    """One flight between two landings of a route with stops."""

    departure: str
    destination: str
    totals: Totals


Totals.model_rebuild()


class Hazard(BaseModel):
    """A SIGMET/AIRMET whose polygon the route line crosses."""

    hazard: str | None = None
    type: str | None = None
    altitude_low_ft: float | None = None
    altitude_high_ft: float | None = None
    raw: str | None = None


class AirspaceTransit(BaseModel):
    """Controlled airspace the route passes through: a radio call to
    make, not a ceiling constraint."""

    model_config = ConfigDict(populate_by_name=True)

    name: str
    class_: str = Field(alias="class")
    floor_ft_msl: float | None = None
    requires: str
    along_track_nm: float


class SpecialUse(BaseModel):
    """One special-use area, as the FAA publishes it."""

    name: str
    #: P, R, MOA, W, A or D.
    type: str
    kind: str
    floor_ft: float | None = None
    #: SFC, MSL or AGL.
    floor_ref: str | None = None
    ceiling_ft: float | None = None
    ceiling_ref: str | None = None
    times_of_use: str | None = None
    #: The IANA zone its times of use are written in (vfr.sua.time_zone,
    #: from the FAA's GMTOFFSET and DST_CODE); None where the FAA gives none.
    time_zone: str | None = None
    controlling_agency: str | None = None


class SpecialUseArea(SpecialUse):
    """One special-use area the route crosses."""

    along_track_nm: float
    #: The legs (between consecutive fixes) that cross it.
    legs: list[int] = []


class AltitudeSegment(BaseModel):
    """One leg's own band: its floor, the shelf and the clouds over it
    alone, and the legal cruising altitudes between -- what lets a plan
    step down under a Class B shelf and climb again past it."""

    from_nm: float
    to_nm: float
    floor_ft: float
    airspace_ceiling_ft: float | None
    #: The aeroplane's service ceiling over this leg in the forecast air
    #: (see AltitudeBreakdown's).
    service_ceiling_ft: float | None = None
    #: The lowest cloud base (MSL) the TAFs near this leg forecast for
    #: the flight, and the station: the leg keeps 14 CFR 91.155's
    #: distance below it, up to `cloud_ceiling_ft`. None where no
    #: station near it forecasts one.
    cloud_base_ft: float | None = None
    cloud_station: str | None = None
    cloud_ceiling_ft: float | None = None
    #: False where the clouds leave this leg no altitude: VFR is not
    #: possible there as forecast, and its altitudes are the band's
    #: without the clouds.
    cloud_clearance_kept: bool = True
    band_ceiling_ft: float | None
    #: This leg's own magnetic course and half of the hemispheric rule,
    #: which its legal altitudes are rounded to.
    course_magnetic_deg: float | None = None
    eastbound: bool | None = None
    #: Where the rule begins over this leg (see AltitudeBreakdown's).
    hemispheric_rule_from_ft: float | None = None
    candidates_ft: list[float]
    #: No 500 ft step fits under this leg's ceiling, and its one altitude
    #: is the highest whole hundred under it that clears the floor (1,800
    #: ft under a 1,900 ft shelf): legal, but tight (vfr.altitude).
    tight: bool = False
    #: Under IFR, what the floor is from (vfr.ifr, 14 CFR 91.177(a)(2)):
    #: the highest obstacle within 4 nm of the leg's course, ground or a
    #: DOF obstacle, its height MSL, whether the leg is over a mountainous
    #: area (Part 95), and the clearance over it, 2,000 ft there and
    #: 1,000 elsewhere. None under VFR.
    highest_ft: float | None = None
    highest_is_obstacle: bool | None = None
    mountainous: bool | None = None
    obstacle_clearance_ft: float | None = None
    #: Under IFR along an airway (vfr.airways): the segment's published
    #: altitudes, its MEA the floor (14 CFR 91.177(a)(1)) and its MAA a
    #: ceiling.
    airway: "AirwayAltitudes | None" = None


class AirwayAltitudes(BaseModel):
    """An airway segment's published altitudes, feet MSL (NASR AWY_SEG_ALT):
    the MEA, the GNSS MEA, the MOCA and the MAA; `from_` the fix it starts
    at."""

    id: str
    from_: str = Field(alias="from")
    mea_ft: float | None = None
    gnss_mea_ft: float | None = None
    moca_ft: float | None = None
    maa_ft: float | None = None

    model_config = ConfigDict(populate_by_name=True)


class AltitudeCaution(BaseModel):
    """An altitude the pilot set for a hop (`from_ident` to `to_ident`) and
    what is wrong with it against the planner's band there
    (app.planning.own_altitude_caution): a warning, not a refusal."""

    from_ident: str
    to_ident: str
    altitude_ft: float
    reasons: list[str]


class AltitudeBreakdown(BaseModel):
    """The full reasoning behind one recommended cruise altitude.
    `low_ceiling_or_visibility` is None, not False, when the forecast
    call itself failed: unknown must not read as confirmed fine.
    `candidates_ft` are every legal altitude for the whole route;
    `segments` the same leg by leg, present when the nav log's fixes
    were known."""

    #: The rules it was chosen under: "vfr", or "ifr" -- 14 CFR 91.177's
    #: minimum IFR altitudes for its floors, 91.179(b)'s thousands by
    #: direction of flight, no Class B, cloud or Class A ceiling (vfr.ifr).
    rules: FlightRules = "vfr"
    recommended_ft: float | None
    candidates_ft: list[float] = []
    # The magnetic course the hemispheric rule was applied to, and which
    # half of the rule that is: 000-179 flies odd thousands plus 500,
    # 180-359 even thousands plus 500.
    course_magnetic_deg: float
    eastbound: bool
    #: 14 CFR 91.159 applies only more than 3,000 ft above the surface:
    #: this is 3,000 ft over the lowest ground on the route, and below it
    #: every 500 ft is legal as well as the rule's altitudes.
    hemispheric_rule_from_ft: float | None = None
    floor_ft: float
    airspace_ceiling_ft: float | None
    #: Planned with a Class B clearance: its shelves are no ceiling, and
    #: its transits still say it takes one.
    class_b_cleared: bool = False
    #: The aeroplane's service ceiling where it is in the forecast air,
    #: the lowest over any leg: a service ceiling is a density altitude
    #: (the profile's `service_ceiling_ft`, the book figure), so a warm
    #: day brings it down and a cold one lifts it. The book figure where
    #: the temperatures aloft could not be read.
    service_ceiling_ft: float | None = None
    #: The lowest forecast cloud base (MSL) along the route, and the TAF
    #: station it is from; `cloud_ceiling_ft` is the highest altitude
    #: that keeps 14 CFR 91.155's distance below it (500 ft, 1,000 ft at
    #: 10,000 and above), which the band keeps under.
    cloud_base_ft: float | None = None
    cloud_station: str | None = None
    cloud_ceiling_ft: float | None = None
    #: False where the clouds leave the route, or a leg of it, no
    #: altitude: those altitudes are the band's without the clouds.
    cloud_clearance_kept: bool = True
    airspace_transits: list[AirspaceTransit]
    #: Prohibited and restricted areas, MOAs and the like the legs cross
    #: (vfr.sua); no candidate altitude enters a prohibited one.
    special_use: list[SpecialUseArea] = []
    freezing_level_ft: float | None
    #: The freezing level is at or below `freezing_level_ft`: it was
    #: already below 0 degC at the lowest altitude the forecast reports.
    freezing_level_at_or_below: bool = False
    #: A legal altitude reaches the freezing level and cloud or an icing
    #: AIRMET/SIGMET is forecast along the route. None where the freezing
    #: level could not be checked.
    icing_possible: bool | None = None
    band_ceiling_ft: float | None
    min_ceiling_ft: float | None
    min_visibility_sm: float | None
    hazards: list[Hazard]
    low_ceiling_or_visibility: bool | None
    weather_unavailable: list[Literal["freezing_level", "ceiling_visibility", "hazards", "special_use"]] = []
    segments: list[AltitudeSegment] = []
    #: Under IFR, some leg is over a designated mountainous area (14 CFR
    #: Part 95): its floor is 2,000 ft over the obstacles, not 1,000.
    mountainous: bool = False


AltitudeChoice = Literal["lowest", "highest", "fastest", "economical"]


class AltitudeStep(BaseModel):
    """Consecutive legs flown at one altitude."""

    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    altitude_ft: float
    distance_nm: float


class AltitudeOption(BaseModel):
    """One of the four plans -- lowest, highest, fastest, economical --
    as its steps and what it costs. `ete_min` is the flying time with every climb
    flown (`climb_penalty_min` is how many of those minutes are climb),
    the figure the plans are compared on; `tailwind_kt` the
    distance-weighted wind component along the course, positive helping,
    over the legs that had wind data."""

    kind: AltitudeChoice
    steps: list[AltitudeStep]
    ete_min: float | None
    fuel_gal: float | None
    climb_penalty_min: float
    tailwind_kt: float | None
    unflyable_legs: int
    legs_without_wind: int
    # Whether any step is above 12,500 ft, where more than 30 minutes
    # needs supplemental oxygen (14 CFR 91.211). A plan goes there only
    # where a leg has no legal altitude under it, or the profile says
    # the aeroplane carries oxygen or is pressurised.
    needs_oxygen: bool


class AltitudeFigure(BaseModel):
    """The route flown at one altitude, for the altitude wheel (the owner's
    pick, 2026-10-20): each leg at it where it is legal there, else at the
    leg's nearest legal altitude (`everywhere` false then); the times and
    fuel with the climbs, the wind along the legs, positive helping."""

    altitude_ft: float
    ete_min: float | None
    fuel_gal: float | None
    tailwind_kt: float | None
    everywhere: bool


class LoadingStation(BaseModel):
    name: str
    arm_in: float
    max_lb: float | None = None


class Loading(BaseModel):
    """How the aeroplane is loaded (its POH's weight and balance): the
    weight limits, a sample empty weight and moment (each aeroplane's own
    is on its weight and balance record), the stations and their arms,
    the fuel's, and the centre-of-gravity envelope as (arm, weight)
    corners."""

    source: str
    max_ramp_lb: float
    max_takeoff_lb: float
    max_landing_lb: float
    sample_empty_weight_lb: float
    sample_empty_moment_lb_in: float
    stations: list[LoadingStation]
    baggage_combined_max_lb: float | None = None
    fuel_arm_in: float
    fuel_max_gal: float
    fuel_lb_per_gal: float = 6.0
    start_taxi_fuel_lb: float = 0.0
    envelope: list[tuple[float, float]]


class DistanceTable(BaseModel):
    """One weight's distances, by pressure altitude (rows) and
    temperature (columns)."""

    ground_roll_ft: list[list[float]]
    total_50ft_ft: list[list[float]]


class ShortField(BaseModel):
    """A POH's short-field takeoff or landing distances: a table per
    weight, and how much a dry grass runway adds to the ground roll."""

    source: str
    pressure_altitudes_ft: list[float]
    temperatures_c: list[float]
    weights_lb: list[float]
    tables: list[DistanceTable]
    grass_ground_roll_pct: float


class DemonstratedCrosswind(BaseModel):
    """The strongest crosswind the POH says the aeroplane was shown to
    take off and land in: not a limitation, but past it the pilot is
    beyond what was tested."""

    demonstrated_kt: float
    source: str


class AircraftProfile(BaseModel):
    """The aircraft's name plus its performance profile -- every field a
    data/aircraft/*.json file carries, declared, so a page reads them as
    fields rather than guessing at a dict. The three figures after the
    name are required when a profile is loaded (REQUIRED_FIELDS in
    vfr.aircraft); the rest fall back to defaults in vfr.navlog when a
    profile leaves them out. `extra="allow"` keeps a field a newer
    profile adds on its way through."""

    model_config = ConfigDict(extra="allow")

    name: str
    cruise_tas_kt: float
    fuel_burn_gph: float
    service_ceiling_ft: float
    type: str | None = None
    #: Its type designator as FAA Order JO 7360.1 lists it, what a flight
    #: plan's item 9 takes: C172 for the Cessna 172, P28A for the PA-28s
    #: from the -140 to the -181.
    designator: str | None = None
    #: The power `cruise_tas_kt` and `fuel_burn_gph` are at, in percent,
    #: at vfr.performance's reference altitude on a standard day; its
    #: default where None.
    cruise_power_pct: float | None = None
    climb_rate_fpm_sea_level: float | None = None
    climb_tas_kt: float | None = None
    climb_fuel_burn_gph: float | None = None
    usable_fuel_gal: float | None = None
    supplemental_oxygen: bool | None = None
    pressurized: bool | None = None
    # Its POH's loading and short-field distances, where the profile has
    # them (the Cessna 172S's).
    loading: Loading | None = None
    takeoff: ShortField | None = None
    landing: ShortField | None = None
    crosswind: DemonstratedCrosswind | None = None


class Plan(BaseModel):
    departure: AirportEnd
    destination: AirportEnd
    stops: list[AirportEnd] = []
    distance_nm: float
    course_line: list[tuple[float, float]]
    candidates: list[Candidate]
    selected: list[Candidate]
    legs: list[Leg]
    totals: Totals
    altitude_ft: float
    altitude_selection: AltitudeBreakdown | None
    altitude_options: list[AltitudeOption] = []
    altitude_choice: AltitudeChoice | None = None
    #: As the nav log stream's (NavLogAltitude.cautions).
    altitude_cautions: list[AltitudeCaution] = []
    #: With the Class B clearance, the waypoints that keep the route out
    #: of the Class B it enters (Detour, best first): "Avoid Class B".
    class_b_detours: list["Detour"] = []
    #: The route flown at each altitude any leg may fly (AltitudeFigure),
    #: lowest first: the altitude wheel's figures.
    altitude_figures: list[AltitudeFigure] = []
    aircraft: AircraftProfile
    max_zoom: int
    min_zoom: int
    chart_cycle: str
    chart_revision: int = 0
    chart_tiles_base: str | None = None
    chart_layers: list[ChartLayer]


# --- the briefing -------------------------------------------------------


class ForecastStation(BaseModel):
    """A TAF station near the route: the worst it forecasts over the
    whole flight (`ceiling_ft`, `visibility_sm`, the go/no-go read), and
    -- placed along the route -- when the flight gets there and the worst
    it forecasts within an hour of then, with the TAF as issued."""

    icaoId: str
    ceiling_ft: float | None
    visibility_sm: float | None
    lat: float | None = None
    lon: float | None = None
    along_track_nm: float | None = None
    #: When the flight gets there, ISO 8601 UTC: the flight's share of its
    #: time at that distance along.
    eta: str | None = None
    eta_ceiling_ft: float | None = None
    eta_visibility_sm: float | None = None
    raw: str | None = None


class Forecast(BaseModel):
    min_ceiling_ft: float | None
    min_visibility_sm: float | None
    stations: list[ForecastStation]


class Metar(BaseModel):
    raw: str | None = None
    #: When the station made the report (ISO 8601, UTC).
    observed_at: str | None = None
    flight_category: str | None = None
    ceiling_ft: float | None = None
    visibility_sm: float | None = None
    wind_dir_true_deg: float | None = None
    wind_speed_kt: float | None = None
    wind_gust_kt: float | None = None
    altimeter_in_hg: float | None = None
    temp_c: float | None = None
    dewpoint_c: float | None = None


class ForecastWind(BaseModel):
    """The wind a TAF forecasts at a field for a time (vfr.weather.
    forecast_wind): its own TAF's, else the nearest station's within 30
    nm (`ident`, `distance_nm`). From true north; `dir_true_deg` None for
    a variable wind. `valid_from` and `valid_to`, the period's, s since
    1970."""

    ident: str
    distance_nm: float
    dir_true_deg: float | None
    speed_kt: float
    gust_kt: float | None = None
    valid_from: float
    valid_to: float


class NearbyMetar(BaseModel):
    """A field's nearest report within 30 nm, for one with none of its
    own: the station, how far and which way from the field (true), its
    METAR, and `near` where it is within 10 statute miles, close enough to
    say the field's weather by it, approximately (vfr.weather)."""

    ident: str
    distance_nm: float
    bearing_deg: int
    near: bool
    metar: Metar


class ModelledWeather(BaseModel):
    """The weather at a field as the NWS's Gridded LAMP models it for the
    hour (vfr.glmp), for one with no report of its own: the ceiling above
    the ground (None with none), the visibility (10 sm and more is "10"),
    their flight category (AIM 7-1-7), and the hour it is for. Planning
    guidance, not an observation."""

    ceiling_ft: float | None
    visibility_sm: float
    flight_category: Literal["VFR", "MVFR", "IFR", "LIFR"]
    valid_at: str


class RunwayWind(BaseModel):
    """The reported wind on the end of a runway it favours, the one with
    the most headwind (vfr.runway_wind): the headwind negative for a
    tailwind, the crosswind positive from the right, and the crosswind
    in the gusts where the report has them."""

    end: str
    headwind_kt: float
    crosswind_kt: float
    gust_crosswind_kt: float | None = None
    #: Calm now: True where `end` is the one the field's last wind
    #: favoured, the runway in use (vfr.runway_wind.favoured_end).
    in_use: bool | None = None


class RunwayEnd(BaseModel):
    """One end of a runway (vfr.pattern): its true heading, None for a
    helipad, which way its traffic pattern is flown -- left unless the FAA
    flags it right (14 CFR 91.126(b)(1)) -- and where it is."""

    ident: str
    heading_true_deg: float | None = None
    traffic: Literal["left", "right"] = "left"
    #: Where it is, for the card's sketch of the field's runways: NASR's
    #: surveyed threshold, else OurAirports'; None where neither has it.
    lat: float | None = None
    lon: float | None = None


class RunwayTurf(BaseModel):
    """A length of a runway of two surfaces that is turf, where the FAA's
    remarks say which (vfr.remarks.runway_turf): from `from_ft` to `to_ft`
    feet along it from its `end`, `to_ft` None for the rest of it."""

    end: str
    from_ft: int
    to_ft: int | None = None


class Runway(BaseModel):
    ends: str | None
    length_ft: int | None
    width_ft: int | None
    surface: str | None
    lighted: bool
    closed: bool
    #: The current METAR's wind on the end it favours; None without a
    #: report, with a variable wind, or for a helipad.
    wind: RunwayWind | None = None
    runway_ends: list[RunwayEnd] = []
    #: Its turf, where it is partly paved and the remarks say where: C81's
    #: 06/24, the south-west 1,000 ft. None said for a runway of one
    #: surface, whose `surface` says it.
    turf: list[RunwayTurf] = []


class TrafficPattern(BaseModel):
    """How high a field's traffic pattern is flown (vfr.pattern):
    `agl_ft` above the field, the FAA's own where `published`, else AC
    90-66C's 1,000 ft for a propeller aeroplane; `altitude_ft` above sea
    level where the field's elevation is known."""

    agl_ft: float
    altitude_ft: float | None = None
    published: bool = False


class Frequency(BaseModel):
    type: str | None = None
    description: str | None = None
    frequency_mhz: float | None = None


class AirportFacilities(BaseModel):
    #: The airport's name, for what a pilot calls its tower or its
    #: traffic, its elevation, and the class of the airspace at its
    #: surface (vfr.airspace.surface_class_at).
    name: str | None = None
    elevation_ft: float | None = None
    airspace_class: Literal["B", "C", "D", "E", "G"] | None = None
    pattern: TrafficPattern | None = None
    runways: list[Runway]
    # The FAA's airport diagram and Chart Supplement page (vfr.publications),
    # and the d-TPP cycle to ask for the diagram's picture by
    # (/api/airport-diagram/{cycle}/{ident}.png).
    airport_diagram_url: str | None = None
    airport_diagram_cycle: str | None = None
    chart_supplement_url: str | None = None
    frequencies: list[Frequency]


class TfrInfo(BaseModel):
    """A temporary flight restriction (vfr.tfr): its NOTAM, the site's
    title and kind, when it is in force (UTC; `expires` None until further
    notice), the rule it is issued under, why, and how high it reaches --
    the lowest floor and highest ceiling of its areas, MSL or AGL."""

    notam_id: str
    title: str | None = None
    kind: str | None = None
    state: str | None = None
    effective: str | None = None
    expires: str | None = None
    rule: str | None = None
    purpose: str | None = None
    floor_ft: float | None = None
    floor_ref: Literal["MSL", "AGL"] | None = None
    ceiling_ft: float | None = None
    ceiling_ref: Literal["MSL", "AGL"] | None = None


class Tfr(TfrInfo):
    """A TFR with its areas, for the map: a GeoJSON MultiPolygon."""

    geometry: dict


class VfrMinimums(BaseModel):
    """14 CFR 91.155(a)'s basic VFR weather minimums: the flight
    visibility, and the distance from clouds -- clear of them, or so far
    below, above and to the side (5,280 ft is a statute mile)."""

    visibility_sm: float
    clear_of_clouds: bool
    below_ft: float | None = None
    above_ft: float | None = None
    horizontal_ft: float | None = None


class DayNightMinimums(BaseModel):
    day: VfrMinimums
    night: VfrMinimums


class AirspaceBand(BaseModel):
    """One class of airspace over a point, from `floor_ft` to
    `ceiling_ft` MSL (vfr.airspace_at): its name where it is a B, C or
    D; the VFR minimums in it (None in A); what it takes to go in; the
    equipment it asks for; and the 91.117 speed limit there."""

    floor_ft: float
    ceiling_ft: float
    class_: Literal["A", "B", "C", "D", "E", "G"] = Field(alias="class")
    name: str | None = None
    minimums: DayNightMinimums | None = None
    entry: str
    equipment: str | None = None
    speed_kt: int | None = None

    model_config = ConfigDict(populate_by_name=True)


class ModeCVeil(BaseModel):
    """The Class B primary airport whose 30 nm Mode C veil the point is in."""

    ident: str
    name: str | None = None
    distance_nm: float


class TfrHere(TfrInfo):
    """A TFR over the point, and whether it is in force now."""

    active_now: bool


class PointOffFix(BaseModel):
    """A point named as the pilot's own point off the nearest fix a pilot
    knows (vfr.fixes.frd_near): "VPBNG/095/14.2", its fix, its magnetic
    course from it (a VOR's radial where `radial`), its distance, and its
    name, "14.2 nm on 095° from VPBNG"."""

    ident: str
    base: str
    course_deg: int
    distance_nm: float
    radial: bool
    name: str


class AirspaceAt(BaseModel):
    """The airspace over a point on the chart, from the ground up: the
    classes in bands, the Mode C veil, the special-use areas and the
    TFRs there. `ground_ft` is the ground's height the AGL floors were
    placed from (Terrain Tiles); None where it could not be read, and
    the bands are then measured from sea level. Either source of areas
    out is said so rather than shown as none."""

    lat: float
    lon: float
    ground_ft: float | None
    bands: list[AirspaceBand]
    mode_c_veil: ModeCVeil | None = None
    special_use: list[SpecialUse] = []
    special_use_unavailable: bool = False
    tfrs: list[TfrHere] = []
    tfrs_unavailable: bool = False
    #: The point named off the nearest fix, for the route (the card's Add
    #: to route, Direct to, Hold here); None with none within 40 nm.
    point: PointOffFix | None = None


class AheadAlert(BaseModel):
    """One thing ahead of the airplane (vfr.alerts): airspace, a special-
    use area or a TFR its track goes into in the next five minutes, or the
    ground or an obstacle it comes within 500 ft of in the next minute.
    `seconds` and `distance_nm` are how long and how far until it at the
    ground speed, 0 where it is now; `lat`/`lon` where the track meets it
    (the obstacle itself, the ground's highest point)."""

    id: str
    kind: Literal["airspace", "special_use", "tfr", "terrain", "obstacle"]
    level: Literal["warning", "caution"]
    #: As the FAA names it ("CHICAGO CLASS B", "R-6901A", a TFR's title),
    #: an obstacle's kind ("TOWER"), or "Terrain".
    name: str
    #: B, C or D; P, R, MOA, W or A.
    class_: str | None = Field(default=None, alias="class")
    #: What it takes, with the rule's section.
    need: str
    inside: bool = False
    seconds: float
    distance_nm: float
    lat: float
    lon: float
    #: Its floor and ceiling, feet MSL; None at the surface or with no top.
    floor_ft: float | None = None
    ceiling_ft: float | None = None
    #: The ground's or the obstacle's top, feet MSL, and the airplane's
    #: projected height over it there.
    top_ft: float | None = None
    clearance_ft: float | None = None
    times_of_use: str | None = None
    notam_id: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class AlertsAhead(BaseModel):
    """What is ahead of the airplane, warnings first, then the soonest;
    `unavailable` names what could not be read (special-use airspace,
    TFRs, terrain, obstacles), said rather than shown as nothing there."""

    alerts: list[AheadAlert]
    unavailable: list[str] = []


class TrafficAircraft(BaseModel):
    """One airplane in the air near the point (vfr.traffic): who, where,
    how high -- the GNSS height where it sends one, else its pressure
    altitude set on the nearest METAR's altimeter (vfr.traffic.on_altimeter),
    or as sent where none is near (`pressure_altitude`) -- its track, speed
    and climb, and how many seconds old its position is."""

    hex: str
    callsign: str | None = None
    registration: str | None = None
    type: str | None = None
    lat: float
    lon: float
    altitude_ft: float | None = None
    pressure_altitude: bool = False
    track_deg: float | None = None
    speed_kt: float | None = None
    vertical_fpm: float | None = None
    seen_s: float | None = None
    #: Its transponder code, and the emergency it declares, if any.
    squawk: str | None = None
    emergency: str | None = None
    #: What it is, as its transponder says: DO-260B's emitter category
    #: ("A1" light ... "A7" rotorcraft), for the Aircraft tab's filters.
    category: str | None = None


class Traffic(BaseModel):
    """The airplanes ADS-B receivers hear near a point, from adsb.lol's
    open data, under the Open Database License 1.0, which asks that the
    map say so where it draws them."""

    aircraft: list[TrafficAircraft]
    #: How many seconds before this answer the airplanes were where it
    #: gives them, each `seen_s` more: the map carries each on from there.
    age_s: float = 0.0
    source: str = "adsb.lol"
    license: str = "ODbL 1.0"


class FlightDeparted(BaseModel):
    """The field a flight took off from, and when (Unix seconds)."""

    ident: str
    name: str | None = None
    at: float


class TrailPoint(BaseModel):
    """Where an airplane was: Unix seconds, its position, its height (None
    on the ground)."""

    t: float
    lat: float
    lon: float
    alt_ft: float | None = None


class AircraftRegistration(BaseModel):
    """A US airplane's record in the FAA's aircraft registry (vfr.registry,
    the Releasable Aircraft Database): who it is registered to and where,
    what it is, its engine, and its registration's and airworthiness
    certificates. The owner's town, never the street; an owner who asked
    the FAA to withhold their name (49 U.S.C. 44114(b)) is not in it."""

    n_number: str
    mode_s_hex: str | None = None
    serial: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    year: int | None = None
    aircraft_type: str | None = None
    engines: int | None = None
    seats: int | None = None
    engine: str | None = None
    engine_type: str | None = None
    horsepower: int | None = None
    thrust_lb: int | None = None
    owner: str | None = None
    owner_type: str | None = None
    co_owners: int = 0
    city: str | None = None
    state: str | None = None
    country: str | None = None
    certificate_issued: str | None = None
    expires: str | None = None
    airworthiness: str | None = None
    airworthiness_date: str | None = None
    kit: str | None = None
    fractional: bool = False
    status: str | None = None
    standing: Literal["valid", "lapsed", "other"] = "other"


class TrafficFound(BaseModel):
    """The airplanes in the air a pilot named by callsign, registration
    or ICAO address (vfr.traffic.find); and, where none is in the air or
    heard now, the FAA's record of the one named (vfr.traffic.registered),
    to open its card all the same."""

    aircraft: list[TrafficAircraft]
    registered: AircraftRegistration | None = None
    #: False where adsb.lol could not be asked just now (it answers one
    #: request every few seconds): `aircraft` is then empty, `registered`
    #: the FAA's record all the same, and the page, which shows the
    #: airplanes its map has heard by that name besides, asks again.
    checked: bool = True
    #: Whose data `aircraft` is, to credit it where it is shown, as the
    #: map's traffic is (Traffic): ADS-B Exchange's for a search it
    #: answered (vfr.traffic.find_credited), else adsb.lol's.
    source: str = "adsb.lol"
    license: str = "ODbL 1.0"


class PastFlightField(BaseModel):
    """A landing field a past flight took off from or landed at."""

    ident: str
    name: str | None = None
    city: str | None = None
    region: str | None = None


class PastFlightSummary(BaseModel):
    """One of an airplane's flights of the last days (vfr.traffic.history):
    where it went from and to, where the receivers heard that, and when."""

    id: int
    origin: PastFlightField | None = None
    destination: PastFlightField | None = None
    off: float
    on: float
    landed: bool
    in_air: bool
    max_alt_ft: float


class PastFlights(BaseModel):
    """An airplane's last flights found, ten at most, newest first, from
    adsb.lol's traces (Open Database License 1.0)."""

    hex: str
    registration: str | None = None
    type: str | None = None
    flights: list[PastFlightSummary]
    #: Past days whose traces adsb.lol did not give just now: their
    #: flights are missing from the list, not known not to have flown.
    unread_days: int = 0
    #: The UTC day (ISO) to ask from, with `before` the last flight's id,
    #: for the flights before these; None where adsb.lol's archive, about
    #: six weeks, has none older.
    next_until: str | None = None


class PastFlightPoint(BaseModel):
    """A report of a past flight: when (s since 1970), where, its height
    (GNSS where sent, ft; None on the ground), ground speed (kt), track
    (degrees true) and climb (ft/min)."""

    t: float
    lat: float
    lon: float
    alt_ft: float | None = None
    gs_kt: float | None = None
    track_deg: float | None = None
    vrate_fpm: float | None = None


class PastFlight(BaseModel):
    """One past flight's reports, for its track log and its replay."""

    id: int
    points: list[PastFlightPoint]


class FlightArrival(PastFlightField):
    """The field an airplane has landed at, and when it was last heard (Unix seconds)."""

    at: float


class FlightStatus(BaseModel):
    """An airplane's state now, for the alerts a pilot sets on it
    (vfr.traffic.status): how long since it was heard, whether it is in
    the air -- and where, as the map draws it -- the field it took off
    from, and, not in the air, the field it has landed at; from adsb.lol's
    open data (ODbL 1.0)."""

    hex: str
    heard_s: float | None = None
    airborne: bool = False
    aircraft: TrafficAircraft | None = None
    departed: PastFlightField | None = None
    arrived: FlightArrival | None = None


class FlightDetail(BaseModel):
    """An airplane and its flight today (vfr.traffic.flight): what it is,
    who flies it, where it took off from where its track shows that, and
    its track since, from adsb.lol's open data (ODbL 1.0); and a US
    airplane's FAA registration."""

    hex: str
    faa: AircraftRegistration | None = None
    registration: str | None = None
    type: str | None = None
    description: str | None = None
    operator: str | None = None
    year: str | None = None
    departed: FlightDeparted | None = None
    trail: list[TrailPoint] = []


class RouteAirport(BaseModel):
    ident: str
    name: str | None = None
    location: str | None = None


class FlightRoute(BaseModel):
    """The route a flight number is scheduled to fly (vfr.traffic.route),
    from Virtual Radar Server's route database (CC0): the airports in
    order, and whether the airplane is on or near it now. Not the flight
    plan filed for today's flight."""

    airports: list[RouteAirport]
    plausible: bool | None = None


class GoogleMaps(BaseModel):
    """The browser key for Google's Map Tiles API (routers/basemaps)."""

    key: str


class ProfileGround(BaseModel):
    along_nm: float
    ground_ft: float


class ProfileAirspace(BaseModel):
    """A Class B, C or D the route passes through: where along it, from
    its floor to its ceiling (feet MSL; the ceiling None where the FAA's
    file has none)."""

    name: str
    class_: str = Field(alias="class")
    from_nm: float
    to_nm: float
    floor_ft: float
    ceiling_ft: float | None = None
    # The airport it is drawn round, as a route names it (KDLH); "" where
    # the FAA's file names none that can be placed (vfr.profile).
    ident: str = ""

    model_config = ConfigDict(populate_by_name=True)


class RouteProfile(BaseModel):
    """The route's side view (vfr.profile): its length, the ground under
    it, and the controlled airspace it passes through."""

    length_nm: float
    terrain: list[ProfileGround]
    airspace: list[ProfileAirspace]


class Tfrs(BaseModel):
    tfrs: list[Tfr]


class RouteTfr(TfrInfo):
    """A TFR within a few miles of the route and in force at some time
    during the flight: how far along the route it is, whether the route
    goes through it, and whether it is in force now."""

    along_track_nm: float
    crosses: bool
    active_now: bool


class Pirep(BaseModel):
    """A pilot report near the route (vfr.weather.pireps_along_route):
    when, how high, in what, the turbulence and icing it reports (the
    intensity, as reported: "LGT", "MOD", "NEG"), and its own words."""

    observed_at: str | None = None
    altitude_ft: float | None = None
    aircraft: str | None = None
    urgent: bool = False
    turbulence: str | None = None
    icing: str | None = None
    raw: str | None = None
    along_track_nm: float


class GAirmet(BaseModel):
    """A G-AIRMET the route crosses during the flight
    (vfr.weather.gairmets_along_route): the hazard in words, its severity
    and cause, the time its snapshot is valid at, and its altitudes --
    `from_freezing_level` where it starts there."""

    hazard: str
    severity: str | None = None
    due_to: str | None = None
    valid_at: str | None = None
    altitude_low_ft: float | None = None
    from_freezing_level: bool = False
    altitude_high_ft: float | None = None


class Briefing(BaseModel):
    """`weather_unavailable` names which of hazards/forecast/metars/tfrs
    come from a call that failed rather than one that found nothing: an
    empty `hazards` must not read the same as "no hazards reported"."""

    hazards: list[Hazard]
    forecast: Forecast
    metars: dict[str, Metar | None]
    airports: dict[str, AirportFacilities]
    weather_unavailable: list[Literal["hazards", "forecast", "metars", "tfrs", "pireps", "gairmets"]]
    # The TFRs near the route during the flight (vfr.tfr.along_route).
    tfrs: list[RouteTfr] = []
    # Pilot reports near the route, and the G-AIRMETs it crosses.
    pireps: list[Pirep] = []
    gairmets: list[GAirmet] = []
    # "VFR flight not recommended" (AIM 7-1-5), as its reasons -- either
    # end reporting IFR/LIFR, the forecast under 14 CFR 91.155's basic
    # minimums -- worked out here (vfr.weather) rather than by the page.
    # Empty when nothing warrants it.
    vfr_not_recommended: list[str] = []


# --- the chart: picks and detections ------------------------------------


class PickSummary(BaseModel):
    total: int
    accepted: int
    rejected: int
    added: int
    by_rating: dict[int, int]
    by_role: dict[str, int]
    added_categories: list[str] = []


class Pick(BaseModel):
    """A pilot's own mark on the chart. `rated` is derived from the
    rating, so a rated point can never describe itself as unrated."""

    route: str | None = None
    source: Source
    role: Role | None = None
    category: str
    lat: float
    lon: float
    along_track_nm: float
    cross_track_nm: float
    rating: Rating | None = None
    area_m2: float = 0.0
    note: str | None = None
    created_at: str | None = None

    @field_validator("area_m2", mode="before")
    @classmethod
    def _missing_area_is_zero(cls, value):
        return 0.0 if value is None else value

    @computed_field
    @property
    def rated(self) -> bool:
        return self.rating is not None


class DisplacedPick(BaseModel):
    """A pick on another point that a save took the place of: the store
    keeps one pick per place (vfr.routecsv.SAME_PLACE_NM), whatever each
    point is."""

    lat: float
    lon: float
    category: str


class PickSaved(BaseModel):
    ok: bool
    pick: Pick
    summary: PickSummary
    #: Picks on other points nearby that this one replaced -- no longer
    #: saved, though the page may still show them rated.
    displaced: list[DisplacedPick] = []


class PickDeleted(BaseModel):
    ok: bool
    summary: PickSummary


class Classification(BaseModel):
    """What the chart draws at one point; None where it has no coverage."""

    model_config = ConfigDict(extra="allow")

    category: str | None
    reason: str | None = None


class Detection(BaseModel):
    """A point the chart-vision detector found. `rating`/`role` are None
    until a pick claims it; `rated` is derived from the rating, as a
    Pick's is, rather than set beside it. `score` is the palette's
    constant for its kind; `predicted_score` the chart model's rating
    for it (vfr.chartmodel), None while none is promoted or the corridor
    is still being read for the first time."""

    lat: float
    lon: float
    category: str
    area_m2: float
    score: float
    predicted_score: float | None = None
    along_track_nm: float
    cross_track_nm: float
    rating: Rating | None
    role: Role | None

    @computed_field
    @property
    def rated(self) -> bool:
        return self.rating is not None


class DetectStart(BaseModel):
    type: Literal["start"] = "start"
    route: str


class DetectBlock(BaseModel):
    type: Literal["block"] = "block"
    block: int
    blocks: int
    tiles: int = 0
    missing: int = 0
    detections: list[Detection]


class DetectDone(BaseModel):
    type: Literal["done"] = "done"
    total: int
    added: list[Pick]
    summary: PickSummary


class DetectError(BaseModel):
    """The corridor read failed after the stream had started; always the
    last line."""

    type: Literal["error"] = "error"
    detail: str


DetectMessage = Annotated[DetectStart | DetectBlock | DetectDone | DetectError, Field(discriminator="type")]


# --- the nav log stream -------------------------------------------------


class NavLogStage(BaseModel):
    type: Literal["stage"] = "stage"
    detail: str


class Detour(BaseModel):
    """A named fix that keeps a route out of the Class B airspace it is
    stopped by (vfr.airspace.detour_waypoint), and where it goes in the
    stops: before the stop at `stop_index`, so on the hop it is for."""

    ident: str
    #: What it is to a pilot: "VFR waypoint", "GPS waypoint" (vfr.fixes).
    kind: str
    #: How much longer the route is through it.
    added_nm: float
    stop_index: int
    #: Where it is: "in Downers Grove" (vfr.places).
    description: str | None = None
    #: A way round high ground the airplane cannot climb over
    #: (vfr.terrain_detour): every point to fly by, in order, the first of
    #: them `ident`; empty for a Class B's one waypoint.
    via: list[str] = []


class NavLogError(BaseModel):
    """The stream's failure. `retry` False where asking again gets the
    same answer -- a route with no legal altitude -- so the page offers
    no Try again for it. For that one `detail` is the headline, and
    `reasons` and `advice` say why and what to do: the page lists them in
    the nav log (app.planning.no_altitude)."""

    type: Literal["error"] = "error"
    detail: str
    retry: bool = True
    #: The whole of it in a few words, for the one line under the route:
    #: "Aircraft ceiling restricts mountainous flying".
    brief: str | None = None
    reasons: list[str] = []
    advice: str | None = None
    #: Class B airspace is what leaves no altitude: the page offers to
    #: plan it with a clearance (`class_b_clearance`), or to fly via a
    #: waypoint, `detours` the ones that keep the route out of it, best
    #: first.
    class_b: bool = False
    detours: list[Detour] = []


class NavLogAltitude(BaseModel):
    """Which altitudes the legs that follow fly. `flown` is the planner's
    plan of that name, or "custom" for a pilot's own altitude; None when
    the winds the legs need could not be read, so no leg follows -- the
    stream's next line is the error. `altitude_ft` is the first leg's (a
    plan may step), and None exactly when `flown` is. `options` are the
    four plans, offered beside a pilot's own as well; empty only when the
    winds failed before they could be made.

    It used to say all of that with `choice: null` and an empty `options`,
    which a winds outage produced too: the page showed "0 ft · yours",
    with Custom pressed, for an altitude nobody typed."""

    type: Literal["altitude"] = "altitude"
    flown: AltitudeChoice | Literal["custom"] | None
    altitude_ft: float | None
    altitude_selection: AltitudeBreakdown
    options: list[AltitudeOption] = []
    aircraft: AircraftProfile
    #: The altitudes the pilot set that the planner would not have flown,
    #: and why (AltitudeCaution); none for the planner's own plans.
    cautions: list[AltitudeCaution] = []
    #: With the Class B clearance, the waypoints that keep the route out
    #: of the Class B it enters (Detour, best first): "Avoid Class B".
    class_b_detours: list["Detour"] = []
    #: The route flown at each altitude any leg may fly (AltitudeFigure),
    #: lowest first: the altitude wheel's figures.
    altitude_figures: list[AltitudeFigure] = []


class NavLogLeg(Leg):
    type: Literal["leg"] = "leg"


class NavLogDone(BaseModel):
    type: Literal["done"] = "done"
    totals: Totals


NavLogMessage = Annotated[
    NavLogStage | NavLogError | NavLogAltitude | NavLogLeg | NavLogDone, Field(discriminator="type"),
]


# --- checkpoint notes ---------------------------------------------------


class CheckpointNote(BaseModel):
    route: str
    lat: float
    lon: float
    description: str
    created_at: str


class CheckpointNoteSaved(BaseModel):
    ok: bool
    note: CheckpointNote


class PilotNotesForgotten(BaseModel):
    """How many of one pilot's own notes went, as their account did."""
    removed: int


class NoteStart(BaseModel):
    type: Literal["start"] = "start"
    count: int


class NoteCheckpoint(BaseModel):
    """`source` says where the text came from: "saved" is a pilot's own
    earlier edit, "generated" a fresh model call, "error" that call
    failing for this checkpoint alone (`description` is None then)."""

    type: Literal["checkpoint"] = "checkpoint"
    lat: float
    lon: float
    id: str
    description: str | None
    source: Literal["generated", "saved", "error"]
    detail: str | None = None


class NoteError(BaseModel):
    """A failure that applies to every checkpoint the same way (a bad
    key, an exhausted rate limit), sent once."""

    type: Literal["error"] = "error"
    detail: str


class NoteDone(BaseModel):
    type: Literal["done"] = "done"


CheckpointNoteMessage = Annotated[
    NoteStart | NoteCheckpoint | NoteError | NoteDone, Field(discriminator="type"),
]


# --- everything else ----------------------------------------------------


class AirportSuggestion(BaseModel):
    """An airport the search answers -- or, asked with `fixes`, a named
    fix (`kind` "fix": a VFR waypoint, a GPS waypoint), its `name` the
    kind of fix and its `region` the state it is in."""

    ident: str
    name: str
    municipality: str | None = None
    region: str | None = None
    kind: Literal["airport", "fix"] = "airport"


class AirportSearch(BaseModel):
    airports: list[AirportSuggestion]


class PlaceFound(BaseModel):
    """A place a pilot typed for Nearest to find the fields near: an
    airport, a town, a street address (vfr.geocode), and where it is."""

    label: str
    kind: Literal["airport", "town", "address"]
    lat: float
    lon: float


class PlacesFound(BaseModel):
    places: list[PlaceFound]


class AirportPin(BaseModel):
    """A landing field the map can open a card for: the ident pilots use,
    where it is, and its size -- the bigger ones are kept when a wide
    view holds more than the map asks for. `flight_category` is the
    field's METAR's (VFR, MVFR, IFR, LIFR), for the map's weather chip:
    None where it has no reporting station, or the weather could not be
    asked. `military` is a field the armed services own (the FAA's
    airport file, vfr.faa_data.military_fields): "military" where a civil
    airplane lands only with the service's permission, "joint" where a
    civil airport shares it; None for every other field."""

    ident: str
    name: str
    lat: float
    lon: float
    kind: Literal["large", "medium", "small", "other"]
    flight_category: str | None = None
    military: Literal["military", "joint"] | None = None
    #: Closed to the public (vfr.faa_data.private_fields): landed at only
    #: with its owner's permission, the sectional's R in a circle.
    private: bool = False
    #: The class of the airspace at its surface (vfr.airspace.surface_classes),
    #: for its mark on the map in that airspace's look; None where the FAA's
    #: airspace could not be had.
    airspace_class: Literal["B", "C", "D", "E", "G"] | None = None


class InboundRadio(BaseModel):
    """The frequency a pilot calls a field on, inbound: `kind` "TWR",
    "CTAF" or "UNICOM", and the frequency in MHz."""

    kind: Literal["TWR", "CTAF", "UNICOM"]
    mhz: float


class NearestAirport(AirportPin):
    """A field near a position: how far and which way (true), its town,
    elevation and longest open runway, and a frequency listed for it
    (None where OurAirports lists none)."""

    municipality: str | None = None
    elevation_ft: float | None = None
    distance_nm: float
    bearing_deg: float
    longest_runway_ft: int | None = None
    radio: InboundRadio | None = None


class NearestAirports(BaseModel):
    airports: list[NearestAirport]


class AirportsInView(BaseModel):
    airports: list[AirportPin]


class WaypointPin(BaseModel):
    """A VFR waypoint on the sectional (VPBNG), for the map's diamond: a
    tap names it, and with a route open puts it in the stops."""

    ident: str
    lat: float
    lon: float
    #: Where it is, a stand-alone waypoint having no name of its own: "by
    #: Bangs Lake", "2 nm W of Glenview" (vfr.places). None before the
    #: place names have loaded, or where nothing is near.
    description: str | None = None


class WaypointsInView(BaseModel):
    waypoints: list[WaypointPin]


class TerminalChart(BaseModel):
    """One of a field's charts in the d-TPP (vfr.publications): `kind` the
    FAA's chart code -- APD the airport diagram, HOT its hot spots, LAH
    land and hold short, IAP an approach, DP and ODP a departure, STR an
    arrival, MIN the takeoff or alternate minimums -- `name` its title as
    the FAA prints it, `url` its PDF."""

    kind: str
    name: str
    url: str


class ProcedureSummary(BaseModel):
    """One of a field's instrument procedures in the FAA's CIFP
    (vfr.procedures): `id` its coded identifier ("I08-Y"), `name` its
    chart's title ("ILS Y RWY 08"), `runway` an approach's, and the
    transitions a pilot picks from -- an approach's, an arrival's or a
    departure's enroute ones -- and an arrival's or departure's runway
    transitions, which are drawn with it."""

    kind: Literal["approach", "arrival", "departure"]
    id: str
    name: str
    runway: str | None = None
    transitions: list[str]
    runway_transitions: list[str]


class ProcedureList(BaseModel):
    """A field's instrument procedures, approaches first, from the CIFP
    of the AIRAC cycle that took effect on `cycle` (YYMMDD); none for a
    field with none."""

    airport: str
    cycle: str
    # True when `cycle` is not the one in force: the FAA's file for it
    # could not be had, and an older one is used.
    stale: bool = False
    procedures: list[ProcedureSummary]


class ProcedureLine(BaseModel):
    """A line of a drawn procedure, its points latitude and longitude:
    an approach's `transition`, its `final` and its `missed` approach; an
    arrival's or departure's enroute `transition`, `common` route, or a
    `runway` transition, `name` the transition's ("RW08")."""

    role: Literal["transition", "final", "missed", "common", "runway"]
    name: str | None = None
    points: list[tuple[float, float]]


class ProcedureHold(BaseModel):
    """A holding pattern of a drawn procedure, or its procedure turn: at `fix`, its inbound
    course `inbound_deg` true, its turns right or left (`turn`), drawn to
    a light airplane's size (vfr.procedures.HOLD_SPEED_KT)."""

    fix: str
    turn: Literal["L", "R"]
    inbound_deg: int
    missed: bool
    points: list[tuple[float, float]]
    #: A hold, or a procedure turn (45°/180°, AIM 5-4-9) where the chart has
    #: its barb, drawn and flown as a hold is.
    kind: Literal["hold", "procedure turn"] = "hold"


class ProcedureFix(BaseModel):
    """A fix of a drawn procedure: its `roles` on an approach (IAF, IF,
    FAF, MAP, hold), the altitudes it is crossed at -- at or above
    `min_ft`, at or below `max_ft`, at both where they are one -- and the
    speed it is crossed at, `speed_limit` saying whether that is the
    speed ("at"), a minimum ("min") or a maximum ("max"; ARINC 424-18
    5.261). `missed` where it is on the missed
    approach alone."""

    ident: str
    lat: float
    lon: float
    roles: list[str]
    min_ft: int | None = None
    max_ft: int | None = None
    speed_kt: int | None = None
    speed_limit: Literal["at", "min", "max"] | None = None
    missed: bool


class ProcedureDrawing(BaseModel):
    """One procedure drawn with the transition picked (vfr.procedures):
    its lines, holds and fixes, from the CIFP of `cycle`."""

    airport: str
    kind: Literal["approach", "arrival", "departure"]
    id: str
    name: str
    transition: str | None = None
    cycle: str
    stale: bool = False
    lines: list[ProcedureLine]
    holds: list[ProcedureHold]
    fixes: list[ProcedureFix]


class PlateOverlay(BaseModel):
    """An approach's plate's plan view placed on the map (vfr.plates): the
    FAA's plate of `name` in d-TPP cycle `cycle`, its picture at
    /api/approach-plate/{cycle}/{ident}/{procedure}.png, black on clear,
    north up between these latitudes and longitudes, as the plate's own
    georeference places it; `fixes` the approach's fixes inside it;
    `circling` whether the plate publishes circling minimums, so a pilot
    flying the approach may circle to land on another runway."""

    cycle: str
    name: str
    south: float
    west: float
    north: float
    east: float
    fixes: list[str]
    circling: bool


class ChartPage(BaseModel):
    """One page of one of the FAA's charts, to show in the app: its
    picture is /api/faa-chart/page/{source}/{edition}/{pdf}/{page}.png,
    `width` by `height` pixels (vfr.publications.chart_page_png)."""

    source: Literal["dtpp", "dcs"]
    edition: str
    pdf: str
    page: int
    width: int
    height: int


class ChartPages(BaseModel):
    """The pages of an FAA chart the app shows, in order: every page of a
    chart of its own, a booklet's pages for the field, a Chart Supplement
    entry's pages (vfr.publications.chart_pages)."""

    pages: list[ChartPage]


class AirportPlace(BaseModel):
    """One airport the way the map's card shows it: its name and place,
    the class of the airspace over it, whether it has a tower, its
    runways and radio, and the weather there now. `metar` is None for a
    field with no reporting station, and `weather_unavailable` says the
    weather service could not be asked at all -- not the same thing."""

    ident: str
    name: str
    municipality: str | None = None
    region: str | None = None
    lat: float
    lon: float
    elevation_ft: float | None = None
    kind: Literal["large", "medium", "small", "other"]
    airspace_class: Literal["B", "C", "D", "E", "G"] | None = None
    #: A field the armed services own, as AirportPin's.
    military: Literal["military", "joint"] | None = None
    #: Closed to the public, as AirportPin's: the card says so, since a
    #: pilot who taps the R needs to know to ask the owner first.
    private: bool = False
    towered: bool
    # Its remarks a pilot acts on from the cockpit, in plain English
    # (vfr.remarks): the lighting schedule -- lights turned on by keying
    # the mic -- and the other remarks that count mic clicks, such as the
    # weather read out on the CTAF. `standard_keying` where the lights
    # are the pilot's and the remarks do not say how many clicks: AIM
    # 4-1-9's 7, 5 and 3 apply.
    lighting: list[str] = []
    radio_notes: list[str] = []
    standard_keying: bool = False
    pattern: TrafficPattern | None = None
    runways: list[Runway]
    frequencies: list[Frequency]
    metar: Metar | None = None
    #: Where it has none, the nearest report within 30 nm
    #: (vfr.weather.nearest_report): its flight category the card's,
    #: marked approximate, where it is `near`.
    nearby_metar: NearbyMetar | None = None
    #: Where it has none, the weather the NWS's Gridded LAMP models at the
    #: field for the hour (vfr.glmp): the card's category, marked
    #: modelled, before a near station's.
    modelled_weather: ModelledWeather | None = None
    weather_unavailable: bool = False
    # Its phone and one-line street address, from the FAA's airport file
    # (vfr.faa_data.airport_contact): the manager's, else the owner's; None
    # where the FAA lists none.
    phone: str | None = None
    address: str | None = None
    # The FAA's airport diagram and Chart Supplement page for the current
    # editions (vfr.publications); None where the field has none. The
    # diagram's picture is /api/airport-diagram/{airport_diagram_cycle}/{ident}.png.
    airport_diagram_url: str | None = None
    airport_diagram_cycle: str | None = None
    chart_supplement_url: str | None = None
    # And all of the field's charts in this cycle's d-TPP, the diagram among
    # them: what the card's Diagrams tab lists.
    procedures: list[TerminalChart] = []


class NearbyPlace(BaseModel):
    """A place near a field from Overture Maps' places (vfr.nearby)."""

    name: str
    #: What it is, in words: "American restaurant", "Motel", "Car rental".
    kind: str
    distance_m: int
    #: The minutes' walk where it is near enough to walk to, else None.
    walk_min: int | None = None
    phone: str | None = None
    #: Its own website, where Overture lists one: the card's link to it.
    website: str | None = None
    lat: float
    lon: float


class GroundPhoto(BaseModel):
    """A field's photo from the ground, from its Wikipedia article's lead
    image on Wikimedia Commons (vfr.airport_photos), with its credit."""

    url: str
    #: Its size, pixels, for the full-screen viewer to fit it.
    width: int = 900
    height: int = 600
    credit: str
    license: str = ""
    source_url: str | None = None


class AirportPhotos(BaseModel):
    """The pictures an airport's card swipes through behind its diagram:
    its aerial from the USGS, every field's, and a photo from the ground
    where there is a free one."""

    aerial_url: str
    photo: GroundPhoto | None = None


class AirportServices(BaseModel):
    """What a field offers a pilot who lands there: from its Chart
    Supplement entry (NASR's APT_BASE and its remarks) the fuel, fees,
    parking, repair and oxygen, and from Overture Maps (vfr.nearby) the
    places to eat, sleep and hire a car within five miles.
    `nearby_unavailable` where Overture could not be read: not the same
    as nothing near."""

    ident: str
    fuel_types: list[str] = []
    #: The remarks on its fuel and FBO's hours, in plain English.
    fuel_notes: list[str] = []
    landing_fee: bool | None = None
    tie_down: bool = False
    hangar: bool = False
    airframe_repair: Literal["major", "minor"] | None = None
    powerplant_repair: Literal["major", "minor"] | None = None
    oxygen: bool = False
    courtesy_car: bool = False
    #: The remarks offering the courtesy car, in plain English.
    ground_notes: list[str] = []
    food: list[NearbyPlace] = []
    lodging: list[NearbyPlace] = []
    cars: list[NearbyPlace] = []
    nearby_unavailable: bool = False


class RouteStopField(BaseModel):
    """A field along the route to stop at, for the map's Stops (vfr.fuelstops.along):
    which flight it is on, how far along it and off the line, its fuel,
    and the nearest food, bed and car to hire from Overture (vfr.nearby),
    once read (`nearby_known`)."""

    ident: str
    name: str
    city: str
    lat: float
    lon: float
    #: The flight it is on, by its index among the route's flights, and that
    #: flight's departure.
    flight: int
    departure: str
    #: Miles from that flight's departure, straight, and the miles it adds.
    from_nm: float
    added_nm: float
    fuel_types: list[str] = []
    runway_ft: int
    elevation_ft: float | None = None
    courtesy_car: bool = False
    nearby_known: bool = False
    food: NearbyPlace | None = None
    lodging: NearbyPlace | None = None
    car: NearbyPlace | None = None


class RouteStops(BaseModel):
    """The fields along a route to stop at, in route order, and how many
    of them still have their places to be read (`pending`): asked again
    until none."""

    fields: list[RouteStopField]
    pending: int = 0


class ModelComparisonEntry(BaseModel):
    """`metric` names which number `score` is: cv_mae for the sklearn
    family and Spark, held_out_mae for PyTorch/TensorFlow. Lower is
    better either way."""

    name: str
    metric: Literal["cv_mae", "held_out_mae"]
    score: float | None
    promoted: bool


class ModelComparison(BaseModel):
    models: list[ModelComparisonEntry]
    trained_at: str | None
    n_labeled: int | None


class AircraftProfileSummary(BaseModel):
    """One of data/aircraft/*.json, for the nav log's aircraft picker."""

    name: str
    type: str
    cruise_tas_kt: float
    fuel_burn_gph: float
    service_ceiling_ft: float


class AircraftProfiles(BaseModel):
    profiles: list[AircraftProfileSummary]


# --- /api/status: the whole stack in one snapshot ---


class ServiceStatus(BaseModel):
    up: bool
    detail: str | None = None


class ModelServiceStatus(ServiceStatus):
    #: When the chart model it serves was trained; None while none is
    #: promoted.
    trained_at: str | None = None


class Services(BaseModel):
    """None for an agent this planner was not told the address of. The
    webapp and its database are probed from here too -- its liveness
    and its readiness group, which includes the database -- rather
    than by the browser: a phone's probes queued behind its chart
    tiles on one HTTP/1.1 connection pool and timed out, and the
    console read "no answer" for a gateway that had just served it."""

    model_service: ModelServiceStatus
    nav_log_agent: ServiceStatus | None
    crewai_agent: ServiceStatus | None
    webapp: ServiceStatus | None = None
    db: ServiceStatus | None = None


class DataFile(BaseModel):
    name: str
    downloaded_at: str | None


class WeatherDataset(BaseModel):
    name: str
    fetched_at: str | None


class ModelSnapshot(BaseModel):
    model_type: str | None
    trained_at: str | None
    cv_mae: float | None
    held_out_mae: float | None
    n_labeled: int | None
    n_features: int


class ModelVersion(BaseModel):
    name: str
    model_type: str | None
    trained_at: str | None
    cv_mae: float | None


class CandidateModel(BaseModel):
    name: str
    model_type: str | None
    trained_at: str | None
    metric: str | None
    score: float | None


class ChartModelSnapshot(BaseModel):
    """The promoted chart model (vfr.chartmodel), against what it has to
    beat on the ratings it held out: the palette's constants
    (`palette_held_out_mae`) and the training ratings' mean. The
    planner's checkpoints move onto the chart once it beats the
    palette."""

    model_type: str | None
    trained_at: str | None
    held_out_mae: float | None
    palette_held_out_mae: float | None
    dummy_held_out_mae: float | None
    n_labeled: int | None
    n_test: int | None


class ModelRegistry(BaseModel):
    current: ModelSnapshot | None
    versions: list[ModelVersion]
    candidates: list[CandidateModel]
    chart: ChartModelSnapshot | None = None


class PipelineRun(BaseModel):
    """A run of the training DAG. `error`, for one that failed: the
    exception its failed task ended on, from that task's own log."""

    dag_run_id: str | None
    state: str | None
    error: str | None = None


class TrainingReadiness(BaseModel):
    """Whether a retrain has enough to train the chart model on, asked
    before one is started (app.chart_model.readiness): the ratings on a
    detection the trainer would get (`usable`) against what it needs, how
    many of the `rated` are on a point the chart reader no longer finds
    (`off_detection`), and the routes whose chart is still being read,
    which cannot be counted yet. `message` says it in a sentence."""

    usable: int
    needed: int
    ready: bool
    rated: int
    off_detection: int
    reading: list[str]
    message: str


class PipelineStatus(BaseModel):
    """configured: this planner knows where Airflow is and how to sign
    in; reachable: it answered just now. `training`: whether the ratings
    are enough to retrain on, None where it could not be worked out."""

    airflow_configured: bool
    airflow_reachable: bool
    last_run: PipelineRun | None
    detail: str | None
    training: TrainingReadiness | None = None


class CorridorStatus(BaseModel):
    departure_ident: str
    destination_ident: str
    candidates: int | None
    features_built_at: str | None
    labels: PickSummary
    notes: int


class PyramidPass(BaseModel):
    """A pass of `python -m vfr.charts pyramid` under way: sheets done of
    the sheets it set out to render, and the one it is on."""

    started_at: str
    done: int
    total: int
    current: str | None


class PyramidProgress(BaseModel):
    """One kind of chart's tile pyramid for a cycle. What finished passes
    have left -- the sheets rendered, when the last finished, the tiles
    written -- and the pass under way, if any. `complete` is every sheet
    the FAA publishes of the kind rendered; `missing` names the rest."""

    kind: str
    zooms: list[int]
    sheets: list[str]
    finished_at: str | None
    tiles: int
    current_pass: PyramidPass | None = None
    complete: bool
    missing: list[str] = []


class ChartsStatus(BaseModel):
    """`cycle` is the edition the map draws; `current_cycle` the one
    the FAA is on. They differ while a newer cycle is being fetched
    and rendered (`building`, `refresh_running`); the map switches
    once every tile of the new one is there."""

    cycle: str
    current_cycle: str
    # How many FAA chart zips of each kind are downloaded and ready to
    # draw, any cycle.
    prepared: dict[str, int]
    tiles_cached: int
    pyramid: dict[str, PyramidProgress] = {}
    building: dict[str, PyramidProgress] = {}
    refresh_running: bool = False
    # When the planner's own refresh may start a render ("HH:MM-HH:MM"
    # on its clock, blank for any time) and with how many processes.
    refresh_window: str = ""
    refresh_workers: int = 1


class ChartRefreshStarted(BaseModel):
    started: bool
    current_cycle: str


class RecentError(BaseModel):
    """A failure the planner answered lately (app.errors): when (UNIX
    seconds), the call, its status and its words."""

    at: float
    method: str
    path: str
    status: int
    detail: str


class Status(BaseModel):
    checked_at: str
    services: Services
    faa_files: list[DataFile]
    weather: list[WeatherDataset]
    charts: ChartsStatus
    model: ModelRegistry
    pipeline: PipelineStatus
    corridors: list[CorridorStatus]
    # What the planner failed at lately, the newest first (app.errors).
    recent_errors: list[RecentError] = []


class RetrainStarted(BaseModel):
    dag_run_id: str | None
    state: str | None


class Index(BaseModel):
    service: str
    ui: str
    # Whether the reference data (airspace, obstacles, weather, the
    # corridors' charts) is loaded: false for the first minute or so
    # after a start, longer from a cold cache.
    warm: bool = False


# The unions no route returns, published into the OpenAPI components by
# app.main so web/ gets a TypeScript type for each stream.
STREAM_MESSAGES = {
    "NavLogMessage": NavLogMessage,
    "DetectMessage": DetectMessage,
    "CheckpointNoteMessage": CheckpointNoteMessage,
}


class ClassBAirport(BaseModel):
    """One Class B airport: where it is, and what the weather is doing
    there.

    Every weather field is optional and often absent. A field with no
    current report has no flight category; a field with no TAF issued
    has no forecast. Absent is the honest answer -- a pilot must not
    read "no data" as "nothing to worry about", so the UI shows the gap
    rather than a default.
    """

    ident: str
    name: str
    lat: float
    lon: float
    #: The lowest shelf floor, in feet MSL. Below it a pilot is
    #: underneath the airspace rather than in it, which is what decides
    #: whether a clearance is needed to pass.
    floor_ft_msl: float | None = None
    #: How many altitude tiers the airspace is drawn as.
    shelves: int

    #: The METAR's own category (VFR, MVFR, IFR, LIFR), not this
    #: project's arithmetic.
    flight_category: str | None = None
    metar: str | None = None
    ceiling_ft: float | None = None
    visibility_sm: float | None = None
    wind_dir_true_deg: float | None = None
    wind_speed_kt: float | None = None

    taf: str | None = None
    taf_ceiling_ft: float | None = None
    taf_visibility_sm: float | None = None


class ClassBResponse(BaseModel):
    """Every Class B airport in one answer -- see the router for why it
    is one call rather than one per marker."""

    airports: list[ClassBAirport]


class DevService(BaseModel):
    """One service the developer console links to, and whether it is up.

    `state` is Docker's own word for it -- running, exited, created --
    or "absent" where compose has never created the container at all,
    which needs `docker compose up -d <service>` once rather than a
    start.
    """

    name: str
    label: str
    state: str


class DevServices(BaseModel):
    """`available` is false where there is no Docker socket, which is
    every deployment that is not the local development stack. The
    console stops offering to start anything rather than offering a
    button that cannot work."""

    available: bool
    services: list[DevService]


class DevServiceStarted(BaseModel):
    """`started` is false when there was nothing to do, which is the
    common case: the console asks on every click so the link always
    works."""

    service: str
    state: str
    started: bool


class OralFocus(BaseModel):
    """An ACS element the mock oral examines: its code and its words."""

    code: str = Field(pattern=r"^[A-Z]{2}\.[IVX]+\.[A-Z]\.[KRS]\d+[a-z]?$")
    text: str = Field(max_length=400)


class OralQuestionRequest(BaseModel):
    """The student's flight in a few lines (the page's own summary of its
    plan and briefing), the ACS elements to examine, and the questions
    already asked."""

    plan: str = Field(max_length=6000)
    focus: list[OralFocus] = Field(min_length=1, max_length=12)
    asked: list[Annotated[str, Field(max_length=600)]] = Field(default=[], max_length=20)


class OralCitation(BaseModel):
    """A passage an answer rests on, quoted word for word (checked), with
    its source's title and where to read it."""

    source: str
    title: str
    url: str
    quote: str


class OralEditions(BaseModel):
    """The editions the sources are: the eCFR's issue date and the day the
    AIM was read."""

    cfr_issued: str | None = None
    aim_fetched: str | None = None


class OralQuestion(BaseModel):
    """One examiner's question (app.oral), its answer and key points, the
    citations that survived the check, and the sources to grade from.
    `unsupported` where none did."""

    question: str
    acs_code: str
    model_answer: str
    key_points: list[str]
    citations: list[OralCitation]
    source_ids: list[str]
    unsupported: bool
    editions: OralEditions


class OralGradeRequest(BaseModel):
    question: str = Field(max_length=1000)
    model_answer: str = Field(max_length=4000)
    key_points: list[Annotated[str, Field(max_length=300)]] = Field(default=[], max_length=12)
    source_ids: list[Annotated[str, Field(max_length=40)]] = Field(max_length=12)
    answer: str = Field(min_length=1, max_length=4000)


class OralGrade(BaseModel):
    """The student's answer graded: satisfactory, partial or unsatisfactory,
    in a few sentences, the key points it missed, and the citations."""

    verdict: Literal["satisfactory", "partial", "unsatisfactory"]
    feedback: str
    missed: list[str]
    citations: list[OralCitation]


class DestinationCheck(BaseModel):
    """The destination against 14 CFR 91.169(b)'s "1-2-3": an instrument
    approach published, and its TAF an hour either side of the ETA a
    ceiling of 2,000 ft or more and 3 sm or more -- else an alternate is
    `required`, `reasons` saying why (vfr.alternates)."""

    ident: str
    approach: bool
    ceiling_ft: float | None = None
    visibility_sm: float | None = None
    taf: str | None = None
    required: bool
    reasons: list[str] = []


class AlternateMinimums(BaseModel):
    ceiling_ft: float
    visibility_sm: float


class AlternateCheck(BaseModel):
    """A field as the IFR alternate (14 CFR 91.169(c)): its forecast at the
    ETA there against its minimums -- 600 and 2 with a precision approach,
    800 and 2 without -- `good` True or False, or None where the pilot has
    to look (its own published alternate minimums, no approach, no TAF)."""

    ident: str
    approach: bool
    precision: bool
    minimums: AlternateMinimums | None = None
    alternate_minimums_url: str | None = None
    ceiling_ft: float | None = None
    visibility_sm: float | None = None
    taf: str | None = None
    good: bool | None = None
    #: Its forecast meets the standard minimums; where `good` is None for
    #: minimums of its own, the pilot checks those.
    meets_standard: bool = False
    reasons: list[str] = []
    distance_nm: float | None = None


class Alternates(BaseModel):
    """GET /api/alternate: the destination's check, the pilot's alternate's
    and the nearest fields that will do."""

    destination: DestinationCheck
    alternate: AlternateCheck | None = None
    suggestions: list[AlternateCheck] = []


class AircraftBases(BaseModel):
    """Where airplanes are based (vfr.traffic.based): the field their last
    flights keep to, or None where none; those still being looked up are
    pending, given on a later ask."""

    based: dict[str, PastFlightField | None]
    pending: list[str]
