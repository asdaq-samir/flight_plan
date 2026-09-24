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
    ident: str
    name: str
    lat: float
    lon: float
    elevation_ft: float | None = None


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


class Course(BaseModel):
    departure: AirportEnd
    destination: AirportEnd
    distance_nm: float
    bearing_deg: float
    course_line: list[tuple[float, float]]
    chart_layers: list[ChartLayer]
    # The zooms the sectional layer draws at, and the ones the optional
    # terminal-area-chart overlay does (one level further in, and only
    # close up).
    max_zoom: int
    min_zoom: int
    tac_max_zoom: int
    tac_min_zoom: int
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


class Candidate(BaseModel):
    """A scored OSM candidate. `selected` is set by the server's greedy pass."""

    osm_id: str
    name: str | None = None
    category: str
    lat: float
    lon: float
    predicted_score: float
    along_track_nm: float
    selected: bool


class Checkpoints(BaseModel):
    departure: AirportEnd
    destination: AirportEnd
    candidates: list[Candidate]
    selected: list[Candidate]


class Wind(BaseModel):
    wind_dir_true_deg: float
    wind_speed_kt: float


class Leg(BaseModel):
    """One dead-reckoning leg. `wind` is None when no winds-aloft station
    is near enough, which is not the same as calm: groundspeed then falls
    back to true airspeed. groundspeed/ETE/fuel are None when the wind
    exceeds true airspeed, i.e. the leg cannot be flown."""

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
    # How much of the leg's time is climb -- from the field on the first
    # leg, and up to a new level where a plan steps -- flown at climb
    # speed and burn, and already in `ete_min` and `fuel_gal`.
    climb_min: float = 0.0


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
    fuel_required_gal: float | None = None
    usable_fuel_gal: float | None = None
    fuel_margin_gal: float | None = None
    night: bool | None = None


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


class AltitudeSegment(BaseModel):
    """One leg's own band: its floor, the shelf over it alone, and the
    legal cruising altitudes between -- what lets a plan step down under
    a Class B shelf and climb again past it."""

    from_nm: float
    to_nm: float
    floor_ft: float
    airspace_ceiling_ft: float | None
    band_ceiling_ft: float | None
    candidates_ft: list[float]


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
    floor_ft: float
    airspace_ceiling_ft: float | None
    airspace_transits: list[AirspaceTransit]
    freezing_level_ft: float | None
    band_ceiling_ft: float | None
    min_ceiling_ft: float | None
    min_visibility_sm: float | None
    hazards: list[Hazard]
    low_ceiling_or_visibility: bool | None
    weather_unavailable: list[Literal["freezing_level", "ceiling_visibility", "hazards"]] = []
    segments: list[AltitudeSegment] = []


AltitudeChoice = Literal["lowest", "highest", "fastest"]


class AltitudeStep(BaseModel):
    """Consecutive legs flown at one altitude."""

    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    altitude_ft: float
    distance_nm: float


class AltitudeOption(BaseModel):
    """One of the three plans -- lowest, highest, fastest -- as its steps
    and what it costs. `total_min` is the flying time with every climb
    flown (`climb_penalty_min` is how many of those minutes are climb),
    the figure the plans are compared on; `tailwind_kt` the
    distance-weighted wind component along the course, positive helping,
    over the legs that had wind data."""

    kind: AltitudeChoice
    steps: list[AltitudeStep]
    ete_min: float | None
    fuel_gal: float | None
    climb_penalty_min: float
    total_min: float | None
    tailwind_kt: float | None
    unflyable_legs: int
    legs_without_wind: int
    # Whether any step is above 12,500 ft, where more than 30 minutes
    # needs supplemental oxygen (14 CFR 91.211). A plan goes there only
    # where a leg has no legal altitude under it, or the profile says
    # the aeroplane carries oxygen or is pressurised.
    needs_oxygen: bool


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
    climb_rate_fpm_sea_level: float | None = None
    climb_tas_kt: float | None = None
    usable_fuel_gal: float | None = None
    supplemental_oxygen: bool | None = None
    pressurized: bool | None = None


class Plan(BaseModel):
    departure: AirportEnd
    destination: AirportEnd
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
    # Which winds-aloft forecast period the legs were flown on: 06, 12
    # or 24 hours out, from the departure time given.
    winds_forecast_hr: str = "06"
    aircraft: AircraftProfile
    max_zoom: int
    min_zoom: int
    tac_max_zoom: int
    tac_min_zoom: int
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
    flight_category: str | None = None
    ceiling_ft: float | None = None
    visibility_sm: float | None = None
    wind_dir_true_deg: float | None = None
    wind_speed_kt: float | None = None
    temp_c: float | None = None
    dewpoint_c: float | None = None


class Runway(BaseModel):
    ends: str | None
    length_ft: int | None
    width_ft: int | None
    surface: str | None
    lighted: bool
    closed: bool


class Frequency(BaseModel):
    type: str | None = None
    description: str | None = None
    frequency_mhz: float | None = None


class AirportFacilities(BaseModel):
    runways: list[Runway]
    frequencies: list[Frequency]


class Briefing(BaseModel):
    """`weather_unavailable` names which of hazards/forecast/metars come
    from a call that failed rather than one that found nothing: an empty
    `hazards` must not read the same as "no hazards reported"."""

    hazards: list[Hazard]
    forecast: Forecast
    metars: dict[str, Metar | None]
    airports: dict[str, AirportFacilities]
    weather_unavailable: list[Literal["hazards", "forecast", "metars"]]
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


class PicksResponse(BaseModel):
    route: str
    picks: list[Pick]
    summary: PickSummary


class PickSaved(BaseModel):
    ok: bool
    pick: Pick
    summary: PickSummary


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
    until a pick claims it."""

    lat: float
    lon: float
    category: str
    area_m2: float
    score: float
    along_track_nm: float
    cross_track_nm: float
    rating: Rating | None
    role: Role | None
    rated: bool


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


class NavLogError(BaseModel):
    type: Literal["error"] = "error"
    detail: str


class NavLogAltitude(BaseModel):
    """`altitude_ft` is the first leg's; a plan may step. `options` are
    the three plans and `choice` the one the legs that follow fly --
    both empty when the pilot supplied an altitude."""

    type: Literal["altitude"] = "altitude"
    altitude_ft: float
    altitude_selection: AltitudeBreakdown | None
    options: list[AltitudeOption] = []
    choice: AltitudeChoice | None = None
    winds_forecast_hr: str = "06"
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
    osm_id: str
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


class BuildJob(BaseModel):
    job_id: str | None
    state: Literal["queued", "running", "done", "failed"]
    step: str
    route: str | None = None
    detail: str | None = None


class BuiltRoute(BaseModel):
    model_config = ConfigDict(extra="allow")

    departure_ident: str
    destination_ident: str


class BuiltRoutes(BaseModel):
    routes: list[BuiltRoute]
    features_dir: str | None = None


class AirportSuggestion(BaseModel):
    ident: str
    name: str
    municipality: str | None = None
    region: str | None = None


class AirportSearch(BaseModel):
    airports: list[AirportSuggestion]


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
    trained_at: str | None = None
    models: dict[str, bool] = {}


class Services(BaseModel):
    """None for an agent this planner was not told the address of."""

    model_service: ModelServiceStatus
    nav_log_agent: ServiceStatus | None
    crewai_agent: ServiceStatus | None


class DataFile(BaseModel):
    name: str
    downloaded_at: str | None


class WeatherDataset(BaseModel):
    name: str
    fetched_at: str | None
    age_s: float | None


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


class ModelRegistry(BaseModel):
    current: ModelSnapshot | None
    versions: list[ModelVersion]
    candidates: list[CandidateModel]


class PipelineRun(BaseModel):
    dag_run_id: str | None
    state: str | None
    start_date: str | None
    end_date: str | None


class PipelineStatus(BaseModel):
    """configured: this planner knows where Airflow is and how to sign
    in; reachable: it answered just now."""

    airflow_configured: bool
    airflow_reachable: bool
    airflow_url: str | None
    # The training DAG's id, for a link to it in Airflow's own UI.
    dag_id: str | None = None
    last_run: PipelineRun | None
    detail: str | None


class CorridorStatus(BaseModel):
    departure_ident: str
    destination_ident: str
    candidates: int | None
    features_built_at: str | None
    labels: PickSummary
    notes: int


class PreparedChart(BaseModel):
    """One FAA chart zip downloaded and ready to draw: `rasters` are
    the sheets inside it (a TAC zip can carry two)."""

    name: str
    kind: str
    cycle: str
    prepared_at: str | None
    rasters: list[str]


class PyramidProgress(BaseModel):
    """How far `python -m vfr.charts pyramid` has got for one kind of
    chart: sheets done of the sheets it set out to render."""

    kind: str
    zooms: list[int]
    started_at: str | None
    finished_at: str | None
    rasters_total: int
    rasters_done: int
    tiles_written: int
    current: str | None


class ChartsStatus(BaseModel):
    """`cycle` is the edition the map draws; `current_cycle` the one
    the FAA is on. They differ while a newer cycle is being fetched
    and rendered (`building`, `refresh_running`); the map switches
    once every tile of the new one is there."""

    cycle: str
    current_cycle: str
    charts: list[PreparedChart]
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


class Status(BaseModel):
    checked_at: str
    services: Services
    faa_files: list[DataFile]
    weather: list[WeatherDataset]
    charts: ChartsStatus
    model: ModelRegistry
    pipeline: PipelineStatus
    corridors: list[CorridorStatus]


class RetrainStarted(BaseModel):
    dag_run_id: str | None
    state: str | None


class Index(BaseModel):
    service: str
    ui: str


# The unions no route returns, published into the OpenAPI components by
# app.main so web/ gets a TypeScript type for each stream.
STREAM_MESSAGES = {
    "NavLogMessage": NavLogMessage,
    "DetectMessage": DetectMessage,
    "CheckpointNoteMessage": CheckpointNoteMessage,
}


class ClassBAirport(BaseModel):
    """One Class B airport: where it is, what the weather is doing
    there, and which terminal area chart covers it.

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
    #: The terminal area chart covering this airport, by the label the
    #: map's layer picker uses. None where the FAA publishes none.
    tac: str | None = None

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
