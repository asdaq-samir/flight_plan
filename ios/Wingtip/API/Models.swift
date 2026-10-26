import Foundation

// The planner's answers the app reads (planning-service/openapi.json,
// app.schemas), as Codable by hand. Apple's generator was tried first and
// left out every property the document gives as `anyOf` string and null
// (FastAPI's way of saying optional): flight_category, municipality,
// elevation_ft, the METAR itself. These follow the document's names in
// camel case through Planner.snakeCase; a field the document marks
// nullable is optional here. Only the properties a screen shows are
// listed: JSONDecoder ignores the rest, and a screen adds what it needs.

/// One kind of FAA chart and the zooms it has tiles for (ChartLayer).
struct ChartLayer: Codable, Equatable, Sendable {
    let kind: String
    let label: String
    var base: Bool = false
    let minZoom: Int
    let maxZoom: Int
    var over: [String] = []
}

/// Which chart the map draws and where its tiles are (ChartInfo).
struct ChartInfo: Codable, Equatable, Sendable {
    let chartCycle: String
    var chartRevision: Int? = 0
    var chartTilesBase: String?
    let chartLayers: [ChartLayer]
    let minZoom: Int
    let maxZoom: Int
}

/// A field in the map's view (AirportPin).
struct AirportPin: Codable, Equatable, Sendable {
    let ident: String
    let name: String
    let lat: Double
    let lon: Double
    let kind: String
    var flightCategory: String?
    var airspaceClass: String?
    var military: String?
    var isPrivate: Bool? = false

    enum CodingKeys: String, CodingKey {
        case ident, name, lat, lon, kind, flightCategory, airspaceClass, military
        case isPrivate = "private"
    }
}

/// A field found by ident or name (AirportSuggestion).
/// A field near a point, nearest first (NearestAirport): its distance
/// and bearing from there, worked out by the planner.
struct NearestAirport: Codable, Equatable, Sendable, Identifiable {
    let ident: String
    let name: String
    let lat: Double
    let lon: Double
    let kind: String
    let distanceNm: Double
    let bearingDeg: Double
    var municipality: String?
    var flightCategory: String?
    var longestRunwayFt: Int?
    var elevationFt: Double?

    var id: String { ident }
}

/// One airplane the receivers hear (TrafficAircraft), as sent.
struct TrafficAircraft: Codable, Equatable, Sendable {
    let hex: String
    let lat: Double
    let lon: Double
    var callsign: String?
    var registration: String?
    var type: String?
    var altitudeFt: Double?
    var trackDeg: Double?
    var speedKt: Double?
    var verticalFpm: Double?
    var seenS: Double?
    /// Its transponder's code, where it sends one: 7500, 7600 and 7700
    /// said in words on its card (AIM 6-2-2, 6-3-4, 6-4-2).
    var squawk: String?
}

struct TrafficAnswer: Codable, Equatable, Sendable {
    var aircraft: [TrafficAircraft]
    var source: String?
    var ageS: Double?
}

struct AirportSuggestion: Codable, Equatable, Sendable, Identifiable {
    let ident: String
    let name: String
    var kind: String?
    var municipality: String?
    var region: String?

    var id: String { ident }
}

/// A METAR as the planner reads it, with the report as sent (Metar).
struct Metar: Codable, Equatable, Sendable {
    var raw: String?
    var observedAt: String?
    var flightCategory: String?
    var windDirTrueDeg: Double?
    var windSpeedKt: Double?
    var windGustKt: Double?
    var visibilitySm: Double?
    var ceilingFt: Double?
    var tempC: Double?
    var dewpointC: Double?
    var altimeterInHg: Double?
}

/// The forecast model's weather at a field with no report (ModelledWeather).
struct ModelledWeather: Codable, Equatable, Sendable {
    let flightCategory: String
    let visibilitySm: Double
    var ceilingFt: Double?
    let validAt: String
}

/// The wind on a runway's better end (RunwayWind).
struct RunwayWind: Codable, Equatable, Sendable {
    let end: String
    let headwindKt: Double
    let crosswindKt: Double
    var gustCrosswindKt: Double?
    var inUse: Bool?
}

struct Runway: Codable, Equatable, Sendable {
    var ends: String?
    var lengthFt: Int?
    var widthFt: Int?
    var surface: String?
    var lighted: Bool = false
    var closed: Bool = false
    var wind: RunwayWind?
    /// Its ends' headings and pattern sides (the airport card's rows).
    var runwayEnds: [RunwayEnd]?
}

struct Frequency: Codable, Equatable, Sendable {
    var type: String?
    var description: String?
    var frequencyMhz: Double?
}

/// The traffic pattern's altitude: the FAA's where it publishes one, else
/// AC 90-66C's 1,000 ft over the field (TrafficPattern).
struct TrafficPattern: Codable, Equatable, Sendable {
    let aglFt: Double
    var altitudeFt: Double?
    var published: Bool = false
}

/// One of the planner's airplane types and the handbook figures it flies
/// on (AircraftProfile, data/aircraft/*.json).
struct AircraftProfile: Codable, Equatable, Sendable {
    let name: String
    var type: String?
    var designator: String?
    let cruiseTasKt: Double
    let fuelBurnGph: Double
    let serviceCeilingFt: Double
    var usableFuelGal: Double?
    var cruisePowerPct: Double?
    var climbTasKt: Double?
}

/// A checkpoint off the chart along the route, ranked by the chart model
/// (Candidate): the selected ones are the nav log's fixes.
struct Checkpoint: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let category: String
    let lat: Double
    let lon: Double
    let predictedScore: Double
    let alongTrackNm: Double
    var selected: Bool = false
    var name: String?
    var waypoint: String?
    var hop: Int? = 0
}

/// The ground and the airspace under the route's line (RouteProfile).
struct ProfileGround: Codable, Equatable, Sendable {
    let alongNm: Double
    let groundFt: Double
}

struct ProfileAirspace: Codable, Equatable, Sendable, Identifiable {
    let name: String
    /// B, C, D: the document's `class`, which Swift keeps for itself.
    let airspaceClass: String
    let fromNm: Double
    let toNm: Double
    let floorFt: Double
    var ceilingFt: Double?
    var ident: String?

    var id: String { "\(name)-\(fromNm)" }

    enum CodingKeys: String, CodingKey {
        case name, fromNm, toNm, floorFt, ceilingFt, ident
        case airspaceClass = "class"
    }
}

struct RouteProfile: Codable, Equatable, Sendable {
    let lengthNm: Double
    let terrain: [ProfileGround]
    let airspace: [ProfileAirspace]
}

/// The briefing for a route (Briefing): what a flight service briefer
/// says, in the planner's order. Every judgment in it is the planner's;
/// the app shows it and computes none.
struct Hazard: Codable, Equatable, Sendable {
    var type: String?
    var hazard: String?
    var raw: String?
    var altitudeLowFt: Double?
    var altitudeHighFt: Double?
    /// Where and when the flight meets it (BriefLegs.swift).
    var onRoute: OnRoute?
}

struct GAirmet: Codable, Equatable, Sendable {
    let hazard: String
    var severity: String?
    var dueTo: String?
    var validAt: String?
    var altitudeLowFt: Double?
    var altitudeHighFt: Double?
    var fromFreezingLevel: Bool? = false
    var onRoute: OnRoute?
}

struct RouteTfr: Codable, Equatable, Sendable, Identifiable {
    let notamId: String
    let alongTrackNm: Double
    var crosses: Bool = false
    var activeNow: Bool = false
    var title: String?
    var kind: String?
    var purpose: String?
    var effective: String?
    var expires: String?
    var floorFt: Double?
    var ceilingFt: Double?
    var onRoute: OnRoute?

    var id: String { notamId }
}

struct Pirep: Codable, Equatable, Sendable {
    let alongTrackNm: Double
    var raw: String?
    var aircraft: String?
    var altitudeFt: Double?
    var turbulence: String?
    var icing: String?
    var urgent: Bool? = false
    var observedAt: String?
    var onRoute: OnRoute?
}

struct ForecastStation: Codable, Equatable, Sendable {
    var ident: String?
    var raw: String?
    var minCeilingFt: Double?
    var minVisibilitySm: Double?
}

struct Forecast: Codable, Equatable, Sendable {
    var minCeilingFt: Double?
    var minVisibilitySm: Double?
    var stations: [ForecastStation] = []
}

struct Briefing: Codable, Equatable, Sendable {
    var hazards: [Hazard] = []
    var forecast: Forecast?
    var metars: [String: Metar?] = [:]
    var gairmets: [GAirmet]? = []
    var pireps: [Pirep]? = []
    var tfrs: [RouteTfr]? = []
    var vfrNotRecommended: [String]? = []
    var weatherUnavailable: [String] = []
    /// The fields below VFR where the flight meets them, and the fixes
    /// the hazards' legs run between (BriefLegs.swift).
    var fieldsBelowVfr: [FieldBelowVfr]?
    var legFixes: [RoutePoint]?
    var legsFrom: String?
}

/// One thing ahead of the airplane (AheadAlert, vfr.alerts): airspace, a
/// special-use area or a TFR its track goes into in the next five
/// minutes, or the ground or an obstacle it comes within 500 ft of in the
/// next minute. The planner's judgment; the app says it.
struct AheadAlert: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let kind: String
    let level: String
    let name: String
    let need: String
    let seconds: Double
    let distanceNm: Double
    let lat: Double
    let lon: Double
    var inside: Bool? = false
    var airspaceClass: String?
    var floorFt: Double?
    var ceilingFt: Double?
    var clearanceFt: Double?
    var notamId: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, level, name, need, seconds, distanceNm, lat, lon, inside, floorFt, ceilingFt, clearanceFt, notamId
        case airspaceClass = "class"
    }
}

/// The ways to fly a route, as Maps offers its routes (RouteOptions,
/// vfr.route_options): the direct line and the ways round what it meets
/// -- storms, weather under minimums, terrain over the ceiling, TFRs --
/// each with its stops, its time, its fuel and what it still crosses.
/// Every judgment in it is the planner's.
struct RouteHazard: Codable, Equatable, Sendable {
    var kind: String?
    var name: String?
    var title: String?
    var detail: String?
}

struct RouteOption: Codable, Equatable, Sendable, Identifiable {
    let kind: String
    var kinds: [String] = []
    let title: String
    var stops: [String] = []
    var fuel: [String] = []
    /// The way as pairs of latitude and longitude.
    var path: [[Double]] = []
    let distanceNm: Double
    let airMin: Double
    var groundMin: Double = 0
    let fuelGal: Double
    var landings: Int = 0
    /// Indexes into the hazards this way still crosses, and those it
    /// passes near.
    var crosses: [Int] = []
    var marginal: [Int] = []
    var tailKt: Double?
    var floorFt: Int?
    /// The chip's words as the planner gives them, the same on the web
    /// and the phone; an older planner leaves it out.
    var label: String?

    var id: String { kind + ":" + stops.joined(separator: ",") }
}

struct RouteOptions: Codable, Equatable, Sendable {
    var options: [RouteOption] = []
    var own: RouteOption?
    var hazards: [RouteHazard] = []
    var unchecked: [String] = []
    /// What the direct line crosses, and the ends.
    var direct: [Int] = []
    var ends: [Int] = []
}

/// A field's instrument procedures from the FAA's CIFP (ProcedureList,
/// vfr.procedures): departures, arrivals and approaches, each with its
/// transitions, for the pull-downs the route's fields get.
struct ProcedureSummary: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let kind: String
    let name: String
    var runway: String?
    var transitions: [String] = []
    var runwayTransitions: [String] = []
}

struct ProcedureList: Codable, Equatable, Sendable {
    let airport: String
    let cycle: String
    var procedures: [ProcedureSummary] = []
    var stale: Bool? = false
}

/// A procedure picked for a field of the route, as the planner takes it
/// (web lib/procedures proceduresParam): `ident:id[:transition]`.
struct ProcedurePick: Codable, Equatable, Sendable, Identifiable {
    let ident: String
    let id: String
    var kind: String
    var name: String
    var transition: String?

    var param: String { [ident, id].joined(separator: ":") + (transition.map { ":" + $0 } ?? "") }
}

/// A field's card (AirportPlace).
struct AirportPlace: Codable, Equatable, Sendable {
    let ident: String
    let name: String
    let lat: Double
    let lon: Double
    let kind: String
    var towered: Bool = false
    var runways: [Runway] = []
    var frequencies: [Frequency] = []
    var elevationFt: Double?
    var municipality: String?
    var region: String?
    var airspaceClass: String?
    var military: String?
    var phone: String?
    var lighting: [String]? = []
    var metar: Metar?
    var modelledWeather: ModelledWeather?
    var pattern: TrafficPattern?
    // The rest of the card (AirportExtras.swift): where it is on the
    // ground, its FAA pages, its radio's notes, a nearby report.
    var address: String?
    var `private`: Bool?
    var airportDiagramUrl: String?
    var airportDiagramCycle: String?
    var chartSupplementUrl: String?
    var procedures: [TerminalChart]?
    var radioNotes: [String]?
    var standardKeying: Bool?
    var weatherUnavailable: Bool?
    var nearbyMetar: NearbyMetar?
}
