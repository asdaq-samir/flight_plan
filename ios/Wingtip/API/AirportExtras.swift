import Foundation

// The planner's answers an airport's card and the map read beyond the
// card itself (planning-service/openapi.json, app.schemas), as Codable by
// hand in the document's own names, as Models.swift has them. A property
// the document may leave out or send as null is optional.

/// The nearest station's report, for a field with none of its own
/// (NearbyMetar, vfr.weather.nearest_report): within 30 nm, `near` where
/// within the ten statute miles a report is said of.
struct NearbyMetar: Codable, Equatable, Sendable {
    let ident: String
    let distanceNm: Double
    let bearingDeg: Int
    let near: Bool
    let metar: Metar
}

/// One of a field's charts in the d-TPP (TerminalChart, vfr.publications):
/// `kind` the FAA's chart code -- APD the airport diagram, HOT its hot
/// spots, LAH land and hold short, IAP an approach, DP and ODP a
/// departure, STR an arrival, MIN the takeoff or alternate minimums --
/// `name` its title as the FAA prints it, `url` its PDF.
struct TerminalChart: Codable, Equatable, Sendable, Identifiable {
    let kind: String
    let name: String
    let url: String

    var id: String { url }
}

/// A runway's end (RunwayEnd): its true heading, and the side its traffic
/// pattern turns to.
struct RunwayEnd: Codable, Equatable, Sendable {
    let ident: String
    var headingTrueDeg: Double?
    var lat: Double?
    var lon: Double?
    var traffic: String?
}

/// The pictures behind the card's diagram (AirportPhotos): the USGS's
/// aerial of every field, and a free photo from the ground where
/// Wikipedia has one, with its photographer and licence.
struct GroundPhoto: Codable, Equatable, Sendable {
    let url: String
    let credit: String
    var width: Int?
    var height: Int?
    var license: String?
    var sourceUrl: String?
}

struct AirportPhotos: Codable, Equatable, Sendable {
    let aerialUrl: String
    var photo: GroundPhoto?
}

/// A place to eat, sleep or hire a car near a field (NearbyPlace,
/// Overture Maps via vfr.nearby).
struct NearbyPlace: Codable, Equatable, Sendable, Identifiable {
    let name: String
    let kind: String
    let lat: Double
    let lon: Double
    let distanceM: Int
    var walkMin: Int?
    var phone: String?
    var website: String?

    var id: String { "\(name)-\(lat)-\(lon)" }
}

/// What a field offers a pilot who lands there (AirportServices): from
/// its Chart Supplement entry the fuel, fees, parking, repair and oxygen,
/// and from Overture the places within five miles. `nearbyUnavailable`
/// where Overture could not be read, which is not the same as nothing near.
struct AirportServices: Codable, Equatable, Sendable {
    let ident: String
    var fuelTypes: [String]?
    var fuelNotes: [String]?
    var groundNotes: [String]?
    var courtesyCar: Bool?
    var tieDown: Bool?
    var hangar: Bool?
    var oxygen: Bool?
    var landingFee: Bool?
    var airframeRepair: String?
    var powerplantRepair: String?
    var food: [NearbyPlace]?
    var lodging: [NearbyPlace]?
    var cars: [NearbyPlace]?
    var nearbyUnavailable: Bool?
}

/// 91.155's VFR weather minimums for a band, by day or by night
/// (VfrMinimums), as the planner reads them for the class and height.
struct VfrMinimums: Codable, Equatable, Sendable {
    let visibilitySm: Double
    let clearOfClouds: Bool
    var belowFt: Double?
    var aboveFt: Double?
    var horizontalFt: Double?
}

struct DayNightMinimums: Codable, Equatable, Sendable {
    let day: VfrMinimums
    let night: VfrMinimums
}

/// One class of airspace over a point, floor to ceiling in feet MSL
/// (AirspaceBand), with what it takes to go in, in the planner's words.
struct AirspaceBand: Codable, Equatable, Sendable, Identifiable {
    /// A to G: the document's `class`, which Swift keeps for itself.
    let airspaceClass: String
    let floorFt: Double
    let ceilingFt: Double
    let entry: String
    var name: String?
    var equipment: String?
    var speedKt: Int?
    var minimums: DayNightMinimums?

    var id: String { "\(floorFt)-\(airspaceClass)" }

    enum CodingKeys: String, CodingKey {
        case floorFt, ceilingFt, entry, name, equipment, speedKt, minimums
        case airspaceClass = "class"
    }
}

/// A Class B's Mode C veil the point is in (ModeCVeil).
struct ModeCVeil: Codable, Equatable, Sendable {
    let ident: String
    let distanceNm: Double
    var name: String?
}

/// The point named off its nearest fix, "VPBNG/095/14.2" (PointOffFix,
/// vfr.fixes.frd_near).
struct PointOffFix: Codable, Equatable, Sendable {
    let ident: String
    let name: String
    let base: String
    let courseDeg: Int
    let distanceNm: Double
    let radial: Bool
}

/// A special-use area over the point (SpecialUse), as the FAA's file has it.
struct SpecialUse: Codable, Equatable, Sendable, Identifiable {
    let name: String
    let kind: String
    let type: String
    var floorFt: Double?
    var floorRef: String?
    var ceilingFt: Double?
    var ceilingRef: String?
    var timesOfUse: String?
    var timeZone: String?
    var controllingAgency: String?

    var id: String { name }
}

/// A TFR over the point now or to come (TfrHere).
struct TfrHere: Codable, Equatable, Sendable, Identifiable {
    let notamId: String
    let activeNow: Bool
    var kind: String?
    var title: String?
    var purpose: String?
    var effective: String?
    var expires: String?

    var id: String { notamId }
}

/// The airspace over a point the pilot held a finger on (AirspaceAt).
struct AirspaceAt: Codable, Equatable, Sendable {
    let lat: Double
    let lon: Double
    var groundFt: Double?
    let bands: [AirspaceBand]
    var modeCVeil: ModeCVeil?
    var point: PointOffFix?
    var specialUse: [SpecialUse]?
    var specialUseUnavailable: Bool?
    var tfrs: [TfrHere]?
    var tfrsUnavailable: Bool?
}

/// A town, a street address or an airport found by what was typed
/// (PlaceFound, the Census geocoder through the planner).
struct PlaceFound: Codable, Equatable, Sendable, Identifiable, Hashable {
    let kind: String
    let label: String
    let lat: Double
    let lon: Double

    var id: String { "\(label)-\(lat)-\(lon)" }
}

/// A VFR waypoint in the map's view (WaypointPin).
struct WaypointPin: Codable, Equatable, Sendable {
    let ident: String
    let lat: Double
    let lon: Double
    var description: String?
}

/// A Class B airport and what it reports now (ClassBAirport).
struct ClassBAirport: Codable, Equatable, Sendable {
    let ident: String
    let name: String
    let lat: Double
    let lon: Double
    var flightCategory: String?
    var metar: String?
    var taf: String?
}

/// Where the planner places an approach plate's plan view on the chart,
/// by the FAA's own georeference in it (PlateOverlay, vfr.plates).
struct PlateOverlay: Codable, Equatable, Sendable {
    let cycle: String
    let name: String
    let south: Double
    let west: Double
    let north: Double
    let east: Double
    var circling: Bool?
}

/// One page of an FAA chart, drawn by the planner as a picture
/// (ChartPage): a plate, the airport diagram, a Chart Supplement page.
struct ChartPage: Codable, Equatable, Sendable {
    let source: String
    let edition: String
    let pdf: String
    let page: Int
    let width: Int
    let height: Int

    /// The page's picture, through the gateway (web lib/diagram chartPagePicture).
    var path: String {
        let parts = [source, edition, pdf].map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? $0 }
        return "/api/faa-chart/page/\(parts[0])/\(parts[1])/\(parts[2])/\(page).png"
    }
}

extension Planner {
    /// The address of a picture the planner serves: its own paths
    /// (`/api/…`) through the gateway's proxy, and the ones it already
    /// gives as the gateway's (`/api/planner/…`, the photos') as they are.
    static func address(of path: String) -> URL {
        if let absolute = URL(string: path), absolute.scheme != nil { return absolute }
        if path.hasPrefix(Config.plannerPrefix + "/") {
            return URL(string: path, relativeTo: Config.gateway)?.absoluteURL ?? Config.gateway
        }
        return URL(string: Config.plannerPath(path), relativeTo: Config.gateway)?.absoluteURL ?? Config.gateway
    }

    /// A picture's bytes, or the planner's answer why not.
    static func picture(_ path: String) async throws -> Data {
        var request = URLRequest(url: address(of: path))
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Failure(status: status, detail: detail(of: data)) }
        return data
    }

    /// The field from the air and from the ground (/api/airport/{ident}/photos).
    static func photos(_ ident: String) async throws -> AirportPhotos {
        try await fetch(AirportPhotos.self, "/api/airport/\(ident)/photos")
    }

    /// What the field offers on the ground (/api/airport/{ident}/services).
    static func services(_ ident: String) async throws -> AirportServices {
        try await fetch(AirportServices.self, "/api/airport/\(ident)/services")
    }

    /// The airspace over a point, from the ground up (/api/airspace/at).
    static func airspaceAt(lat: Double, lon: Double) async throws -> AirspaceAt {
        try await fetch(AirspaceAt.self, "/api/airspace/at", ["lat": String(format: "%.5f", lat), "lon": String(format: "%.5f", lon)])
    }

    /// Towns, addresses and airports by what was typed (/api/places/search).
    static func places(_ q: String) async throws -> [PlaceFound] {
        struct Answer: Decodable { let places: [PlaceFound] }
        return try await fetch(Answer.self, "/api/places/search", ["q": q]).places
    }

    /// The VFR waypoints in a box (/api/waypoints/in-view).
    static func waypoints(south: Double, west: Double, north: Double, east: Double) async throws -> [WaypointPin] {
        struct Answer: Decodable { let waypoints: [WaypointPin] }
        let box = ["south": String(south), "west": String(west), "north": String(north), "east": String(east)]
        return try await fetch(Answer.self, "/api/waypoints/in-view", box).waypoints
    }

    /// Every Class B airport and its weather now (/api/class-b).
    static func classB() async throws -> [ClassBAirport] {
        struct Answer: Decodable { let airports: [ClassBAirport] }
        return try await fetch(Answer.self, "/api/class-b").airports
    }

    /// Where an approach's plate lies on the chart (/api/airport/{ident}/procedures/{id}/plate).
    static func plate(_ ident: String, procedure: String) async throws -> PlateOverlay {
        try await fetch(PlateOverlay.self, "/api/airport/\(ident)/procedures/\(procedure)/plate")
    }

    /// The plate's plan view as a picture (/api/approach-plate/{cycle}/{ident}/{id}.png).
    static func platePicturePath(cycle: String, ident: String, procedure: String) -> String {
        "/api/approach-plate/\(cycle)/\(ident)/\(procedure).png"
    }

    /// One of the FAA's charts as the planner draws its pages
    /// (/api/faa-chart): of a region's booklet, the field's pages alone.
    static func faaChart(url: String, airport: String) async throws -> [ChartPage] {
        struct Answer: Decodable { let pages: [ChartPage] }
        return try await fetch(Answer.self, "/api/faa-chart", ["url": url, "airport": airport]).pages
    }

    /// The airport diagram for the cycle, whole or cropped to its runways
    /// (/api/airport-diagram/{cycle}/…).
    static func diagramPath(ident: String, cycle: String, runwaysOnly: Bool = false) -> String {
        "/api/airport-diagram/\(cycle)/\(runwaysOnly ? "runways/" : "")\(ident).png"
    }
}
