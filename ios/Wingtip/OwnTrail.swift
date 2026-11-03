import Foundation
import Observation

/// Own ship's path flown, as ForeFlight's breadcrumbs and the web app's
/// lib/map/ownTrail: a point of the GPS every tenth of a mile or ten
/// seconds while the airplane is at flying speed (the engine's `underway`),
/// to see where it has been, and to keep as the flight's track for its
/// debrief without a GPX file. A new flight starts a new path: a point
/// more than ten minutes after the last is the first of it. Kept on the
/// phone (a file in Application Support, written at most every half
/// minute), so the app put away in the air keeps the path; at most a long
/// day's flying of it. The figures are the web's, to keep the two apps'
/// paths the same.
@MainActor
@Observable
final class OwnTrail {
    static let shared = OwnTrail()

    private static let stepNm = 0.1
    private static let stepS = 10.0
    private static let newFlightS = 10.0 * 60
    private static let most = 5000
    private static let writeEveryS = 30.0

    private(set) var points: [PathPoint] = []
    private var lastWritten: Date = .distantPast
    private var underway = false

    private static var file: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("own-trail.json")
    }

    private init() {
        // The path kept from before, unless the last point is over ten
        // minutes old: that was another flight's, and a new one starts.
        if let data = try? Data(contentsOf: Self.file), let kept = try? JSONDecoder().decode([PathPoint].self, from: data),
           let last = kept.last, Date().timeIntervalSince1970 - last.t < Self.newFlightS {
            points = kept
        }
    }

    /// Whether the airplane is at flying speed, by the engine's rule
    /// (glide's underway, the same as the web's), and so whether the phone
    /// keeps its position with the screen locked (OwnShip).
    func took(_ fix: OwnShip.Fix) -> Bool {
        let flying: Bool = (try? Engine.call("underway", json: ["speed_kt": fix.groundspeedKt])) ?? false
        underway = flying
        guard flying else { return false }
        let point = PathPoint(t: fix.at.timeIntervalSince1970, lat: fix.coordinate.latitude, lon: fix.coordinate.longitude, altFt: fix.altitudeFt)
        if let last = points.last {
            let sinceS = point.t - last.t
            if sinceS < Self.stepS && distanceNm(last, point) < Self.stepNm { return true }
            points = sinceS > Self.newFlightS ? [point] : Array((points + [point]).suffix(Self.most))
        } else {
            points = [point]
        }
        if Date().timeIntervalSince(lastWritten) > Self.writeEveryS { write() }
        return true
    }

    /// The path let go: a new flight's starts empty.
    func clear() {
        points = []
        write()
    }

    /// The path as a saved flight's track (Gateway.saveTrack), where the
    /// phone flew it: t in ms since 1970, as the gateway keeps it.
    var asSavedTrack: SavedTrack {
        SavedTrack(points: points.map { SavedTrackPoint(t: Int64($0.t * 1000), lat: $0.lat, lon: $0.lon, altFt: $0.altFt) }, source: "iphone")
    }

    private func write() {
        lastWritten = Date()
        if let data = try? JSONEncoder().encode(points) { try? data.write(to: Self.file, options: .atomic) }
    }

    /// The great-circle distance between two points, nm, as the engine's
    /// geo works it (one call avoided per fix: a fix comes every second).
    private func distanceNm(_ a: PathPoint, _ b: PathPoint) -> Double {
        let rad = Double.pi / 180
        let (la1, la2) = (a.lat * rad, b.lat * rad)
        let dLon = (b.lon - a.lon) * rad
        let x = sin(la1) * sin(la2) + cos(la1) * cos(la2) * cos(dLon)
        return acos(min(1, max(-1, x))) * 3440.065
    }
}
