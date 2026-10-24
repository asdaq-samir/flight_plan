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
}
