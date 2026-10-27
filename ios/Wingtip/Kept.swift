import Foundation

/// The last plan kept on the device, whole -- the route, its course,
/// checkpoints, nav log, altitude line, briefing and side view -- so a
/// route planned on the ground is there in the air with no connection,
/// as the web app's service worker keeps the planner's answers. One file
/// in Application Support; the planner's own words with the time they
/// were planned, said on the page when they are old.
struct Kept: Codable, Equatable, Sendable {
    var dep: String
    var dest: String
    var stops: [String]
    var aircraft: String
    var ownAltitudeFt: Double?
    var altitudeChoice: String?
    var course: Course?
    var checkpoints: [Checkpoint] = []
    var profile: RouteProfile?
    var altitude: NavLogAltitude?
    var legs: [Leg] = []
    var totals: Totals?
    var briefing: Briefing?
    var plannedAt: Date

    static let file = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appending(path: "last-plan.json")

    static func load(from file: URL = file) -> Kept? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(Kept.self, from: data)
    }

    func save(to file: URL = Kept.file) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(self) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }

    static func forget(at file: URL = file) {
        try? FileManager.default.removeItem(at: file)
    }
}

/// The small things kept on the device as JSON in UserDefaults -- the
/// favourite and recent fields and airplanes, the figures per N-number,
/// the minimums and loads, the drills' progress -- in and out one way.
extension UserDefaults {
    func decoded<T: Decodable>(_ type: T.Type, forKey key: String) -> T? {
        data(forKey: key).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }

    func setEncoded(_ value: some Encodable, forKey key: String) {
        set(try? JSONEncoder().encode(value), forKey: key)
    }
}
