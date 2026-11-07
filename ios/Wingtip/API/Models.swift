import Foundation

// The planner's answers the app reads (planning-service/openapi.json,
// app.schemas). Most are generated from the document into
// Generated/PlannerModels.swift (scripts/api-models-apps.sh, the API
// prefix), as the web's types are, so a field the planner renames fails
// the build rather than a screen; the names the app has always used are
// typealiases of them here, with what the app adds as extensions. Every
// property is the document's, in camel case through Planner.snakeCase; a
// field the document marks nullable or leaves out is optional.
//
// Still by hand: AirportPin and AheadAlert, which the engine also writes
// from the cycle packs on the phone (Engine/InView.swift, Engine/Ahead.swift),
// and ProcedurePick, which is the app's own.

/// Which chart the map draws and where its tiles are, and each kind of
/// FAA chart with the zooms it has tiles for.
typealias ChartInfo = APIChartInfo
typealias ChartLayer = APIChartLayer

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
    /// The class of airspace (B, C or D) this field is the primary airport
    /// of, as the FAA's airspace file names it (the planner's primary_of:
    /// O'Hare for Chicago's Class B, not Midway), for which mark to keep
    /// where two would collide (AirportMarks' tiers). Nil for every other
    /// field.
    var primaryOf: String?

    enum CodingKeys: String, CodingKey {
        case ident, name, lat, lon, kind, flightCategory, airspaceClass, military, primaryOf
        case isPrivate = "private"
    }

    /// The fields the map draws, as the web app's AirportsLayer does: the
    /// armed services' (NASR's military, landed at only with the
    /// service's permission) only when asked for, the private ones
    /// (APT_BASE's facility use PR, only with the owner's) unless put
    /// away (the owner, 2026-10-27). Joint-use fields always.
    static func shown(_ pins: [AirportPin], military: Bool, privateFields: Bool) -> [AirportPin] {
        pins.filter { (military || $0.military != "military") && (privateFields || $0.isPrivate != true) }
    }
}

/// A field near a point, nearest first: its distance and bearing from
/// there, worked out by the planner.
typealias NearestAirport = APINearestAirport

extension NearestAirport: Identifiable {
    var id: String { ident }
}

/// One airplane the receivers hear, as sent: its transponder's code
/// 7500, 7600 and 7700 said in words on its card (AIM 6-2-2, 6-3-4,
/// 6-4-2); and the answer they come in.
typealias TrafficAircraft = APITrafficAircraft
typealias TrafficAnswer = APITraffic

/// A field found by ident or name.
typealias AirportSuggestion = APIAirportSuggestion

extension AirportSuggestion: Identifiable {
    var id: String { ident }
}

/// A METAR as the planner reads it, with the report as sent; the
/// forecast model's weather at a field with no report.
typealias Metar = APIMetar
typealias ModelledWeather = APIModelledWeather

/// A runway, the wind on its better end, a field's frequencies, and the
/// traffic pattern's altitude: the FAA's where it publishes one, else AC
/// 90-66C's 1,000 ft over the field.
typealias Runway = APIRunway
typealias RunwayWind = APIRunwayWind
typealias Frequency = APIFrequency
typealias TrafficPattern = APITrafficPattern

/// One of the planner's airplane types and the handbook figures it flies
/// on (data/aircraft/*.json).
typealias AircraftProfile = APIAircraftProfile

/// A checkpoint off the chart along the route, ranked by the chart model
/// (Candidate): the selected ones are the nav log's fixes.
typealias Checkpoint = APICandidate

extension Checkpoint: Identifiable {}

/// The ground and the airspace under the route's line; an airspace's
/// `class` (B, C, D) is airspaceClass, the name Swift leaves free.
typealias RouteProfile = APIRouteProfile
typealias ProfileGround = APIProfileGround
typealias ProfileAirspace = APIProfileAirspace

extension ProfileAirspace: Identifiable {
    var id: String { "\(name)-\(fromNm)" }
}

/// The briefing for a route: what a flight service briefer says, in the
/// planner's order. Every judgment in it is the planner's; the app shows
/// it and computes none. Where and when the flight meets each hazard is
/// its onRoute (BriefLegs.swift).
typealias Briefing = APIBriefing
typealias Hazard = APIHazard
typealias GAirmet = APIGAirmet
typealias Pirep = APIPirep
typealias Forecast = APIForecast
/// A TAF station near the route: the worst it forecasts over the whole
/// flight (`ceilingFt`, `visibilitySm`), and when the flight gets there.
typealias ForecastStation = APIForecastStation
typealias RouteTfr = APIRouteTfr

extension RouteTfr: Identifiable {
    var id: String { notamId }
}

/// One thing ahead of the airplane (AheadAlert, wingtip.alerts): airspace, a
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
/// wingtip.route_options): the direct line and the ways round what it meets
/// -- storms, weather under minimums, terrain over the ceiling, TFRs --
/// each with its stops, its time, its fuel and what it still crosses.
/// Every judgment in it is the planner's. A way's `crosses` and
/// `marginal` index into the hazards; a chip of the route line, as the
/// planner words and orders it for the web app and the phone alike, has
/// `key` "none" for the route as typed, "fuel" for it with its fuel
/// stops, else the way's kinds.
typealias RouteOptions = APIRouteOptions
typealias RouteOption = APIRouteOption
typealias RouteChip = APIRouteChip
typealias RouteHazard = APIRouteHazard

extension RouteOption: Identifiable {
    var id: String { kind + ":" + stops.joined(separator: ",") }
}

extension RouteChip: Identifiable {
    var id: String { key + ":" + stops.joined(separator: ",") }
}

/// A field's instrument procedures from the FAA's CIFP (wingtip.procedures):
/// departures, arrivals and approaches, each with its transitions, for
/// the pull-downs the route's fields get.
typealias ProcedureList = APIProcedureList
typealias ProcedureSummary = APIProcedureSummary

extension ProcedureSummary: Identifiable {}

/// A procedure picked for a field of the route, as the planner takes it
/// (web lib/procedures proceduresParam): `ident:id[:transition]`.
struct ProcedurePick: Codable, Equatable, Sendable, Identifiable {
    let ident: String
    let id: String
    var kind: String
    var name: String
    var transition: String?

    /// As the planner reads it, "KORD:WYNDE3:ZZIPR".
    var param: String { Self.text([self]) }

    /// Picks as the planner reads them (PlanQuery.procedures), each fix
    /// flown direct, by "FIELD:PROCEDURE" in `direct`, after a fourth
    /// colon: "KELD:I22::BXCMB". The engine's `procedures_write`, as the
    /// web app writes its address.
    static func text(_ picks: [ProcedurePick], direct: [String: String] = [:]) -> String {
        let asked: [[String: String?]] = picks.map {
            ["ident": $0.ident, "id": $0.id, "transition": $0.transition, "direct": direct["\($0.ident):\($0.id)"]]
        }
        let written: String? = try? Engine.call("procedures_write", json: ["picks": asked])
        return written ?? ""
    }
}

/// A field's card: its weather, runways, frequencies and pattern, where
/// it is on the ground, its FAA pages, its radio's notes, a nearby report
/// (AirportExtras.swift says the rest).
typealias AirportPlace = APIAirportPlace
