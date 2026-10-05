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
    the pattern altitude of the field landed at, or the next leg's lower
    level -- at `fpm`, three to one at the leg's ground speed, or steeper
    where the climb before it left less room (vfr.navlog.with_descents)."""

    to_ft: float
    # Whether `to_ft` is the pattern altitude at the field the flight
    # lands at, rather than a lower level on the way.
    pattern: bool
    fpm: float


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


class Totals(BaseModel):
    """The trip's sums, and the fuel check: the legs' fuel plus the VFR
    reserve (30 minutes by day, 45 at night -- `night` is None when no
    departure time said which) against the aeroplane's usable fuel,
    when it has one. `fuel_margin_gal` below zero is a flight the tanks
    do not hold."""

    distance_nm: float
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
    #: A route with stops: each flight between two landings with its own
    #: fuel check, the tanks filled at each stop -- the route's own fuel
    #: figures are None then (app.planning.route_totals). Empty without.
    hops: list["HopTotals"] = []


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


class AltitudeBreakdown(BaseModel):
    """The full reasoning behind one recommended cruise altitude.
    `low_ceiling_or_visibility` is None, not False, when the forecast
    call itself failed: unknown must not read as confirmed fine.
    `candidates_ft` are every legal altitude for the whole route;
    `segments` the same leg by leg, present when the nav log's fixes
    were known."""

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
    aircraft: AircraftProfile
    max_zoom: int
    min_zoom: int
    chart_cycle: str
    chart_revision: int = 0
    chart_tiles_base: str | None = None
    chart_layers: list[ChartLayer]


# --- the briefing -------------------------------------------------------


class ForecastStation(BaseModel):
    icaoId: str
    ceiling_ft: float | None
    visibility_sm: float | None


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


class RunwayWind(BaseModel):
    """The reported wind on the end of a runway it favours, the one with
    the most headwind (vfr.runway_wind): the headwind negative for a
    tailwind, the crosswind positive from the right, and the crosswind
    in the gusts where the report has them."""

    end: str
    headwind_kt: float
    crosswind_kt: float
    gust_crosswind_kt: float | None = None


class RunwayEnd(BaseModel):
    """One end of a runway (vfr.pattern): its true heading, None for a
    helipad, and which way its traffic pattern is flown -- left unless
    the FAA flags it right (14 CFR 91.126(b)(1))."""

    ident: str
    heading_true_deg: float | None = None
    traffic: Literal["left", "right"] = "left"


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
    # The FAA's airport diagram and Chart Supplement page (vfr.publications).
    airport_diagram_url: str | None = None
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


class NavLogError(BaseModel):
    """The stream's failure. `retry` False where asking again gets the
    same answer -- a route with no legal altitude -- so the page offers
    no Try again for it. For that one `detail` is the headline, and
    `reasons` and `advice` say why and what to do: the page lists them in
    the nav log (app.planning.no_altitude)."""

    type: Literal["error"] = "error"
    detail: str
    retry: bool = True
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


class AirportPin(BaseModel):
    """A landing field the map can open a card for: the ident pilots use,
    where it is, and its size -- the bigger ones are kept when a wide
    view holds more than the map asks for. `flight_category` is the
    field's METAR's (VFR, MVFR, IFR, LIFR), for the map's weather chip:
    None where it has no reporting station, or the weather could not be
    asked."""

    ident: str
    name: str
    lat: float
    lon: float
    kind: Literal["large", "medium", "small", "other"]
    flight_category: str | None = None


class NearestAirport(AirportPin):
    """A field near a position: how far and which way (true), its town,
    elevation and longest open runway."""

    municipality: str | None = None
    elevation_ft: float | None = None
    distance_nm: float
    bearing_deg: float
    longest_runway_ft: int | None = None


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
    weather_unavailable: bool = False
    # The FAA's airport diagram and Chart Supplement page for the current
    # editions (vfr.publications); None where the field has none.
    airport_diagram_url: str | None = None
    chart_supplement_url: str | None = None


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
