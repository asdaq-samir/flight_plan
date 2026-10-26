import CoreLocation
import Foundation
import Observation

/// A flown track played again, as the web app's past flight replay
/// (lib/map/pastFlight): the airplane flown along its reports at one, ten
/// or sixty times, from where the pilot left it, its height and ground
/// speed riding the profile under it. A tracked airplane's past flight
/// (PastFlightCard) or the pilot's own flown track (FlownTrackView); the
/// map draws it with the dry run's own airplane (PlaneAnnotation).
@MainActor
@Observable
final class Replay {
    static let shared = Replay()

    /// A report of the flight: when (s since 1970), where, its height, and
    /// its ground speed and track where they are known.
    struct Point: Equatable, Sendable {
        let t: Double
        let lat: Double
        let lon: Double
        var altFt: Double?
        var gsKt: Double?
        var trackDeg: Double?

        var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
    }

    /// How many times faster than it was flown: the dry run's speeds.
    static let speeds: [Double] = [1, 10, 60]

    private(set) var points: [Point] = []
    /// The replay's moment, s since 1970; nil before it has been played,
    /// and after it is stopped.
    private(set) var at: Double?
    private(set) var playing = false
    var speed = 10.0
    /// Which flight is loaded, so a card shown again keeps its moment.
    private(set) var key: String?
    private var ticking: Task<Void, Never>?

    init() {}

    var start: Double? { points.first?.t }
    var end: Double? { points.last?.t }
    /// Where the airplane is at the moment, between its reports.
    var here: Point? { at.flatMap { Self.position(points, at: $0) } }

    /// The moment as a fix, for the map's airplane.
    var fix: OwnShip.Fix? {
        here.map {
            OwnShip.Fix(coordinate: $0.coordinate, altitudeFt: $0.altFt, trackDeg: $0.trackDeg, groundspeedKt: $0.gsKt,
                        accuracyM: 0, at: Date(timeIntervalSince1970: $0.t))
        }
    }

    /// A flight's reports, ready to play; the one already loaded is kept
    /// as it was left.
    func load(_ points: [Point], key: String) {
        guard key != self.key || points != self.points else { return }
        stop()
        self.points = points
        self.key = key
    }

    /// Its card put away: the airplane off the map.
    func clear(_ key: String) {
        guard key == self.key else { return }
        stop()
        points = []
        self.key = nil
    }

    /// Played from where it was left, or from the start once it has ended.
    func play() {
        guard let start, let end, end > start else { return }
        if at.map({ $0 >= end }) ?? true { at = start }
        playing = true
        ticking?.cancel()
        // Moved on by the time that has passed, not by the ticks counted,
        // so a late tick does not slow it.
        ticking = Task { [weak self] in
            let clock = ContinuousClock()
            var last = clock.now
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard let self, self.playing else { return }
                let now = clock.now
                self.step((now - last) / .seconds(1))
                last = now
            }
        }
    }

    func pause() {
        playing = false
        ticking?.cancel()
        ticking = nil
    }

    /// Back to before it was played: the airplane off the map.
    func stop() {
        pause()
        at = nil
    }

    /// The moment dragged to on the scrubber or the profile, kept inside
    /// the flight.
    func scrub(to t: Double) {
        guard let start, let end else { return }
        at = min(end, max(start, t))
    }

    /// The replay `seconds` of the phone's time on, at its speed; stopped
    /// at the end.
    func step(_ seconds: Double) {
        guard playing, let at, let end else { return }
        let next = min(end, at + seconds * speed)
        self.at = next
        if next >= end { pause() }
    }

    /// Where the airplane was at `t`, between the reports either side of
    /// it: its position and height in proportion, its track and speed the
    /// earlier report's, as the web app's positionAt. Nil outside the
    /// flight.
    nonisolated static func position(_ points: [Point], at t: Double) -> Point? {
        guard let first = points.first, let last = points.last, t >= first.t, t <= last.t else { return nil }
        var lo = 0, hi = points.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if points[mid].t <= t { lo = mid } else { hi = mid }
        }
        let a = points[lo], b = points[hi]
        let f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
        var alt = a.altFt
        if let x = a.altFt, let y = b.altFt { alt = x + (y - x) * f }
        return Point(t: t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, altFt: alt, gsKt: a.gsKt, trackDeg: a.trackDeg)
    }

    /// A tracked airplane's past flight, its speed and track as sent.
    nonisolated static func points(_ flown: [PastFlightPoint]) -> [Point] {
        flown.map { Point(t: $0.t, lat: $0.lat, lon: $0.lon, altFt: $0.altFt, gsKt: $0.gsKt, trackDeg: $0.trackDeg) }
    }

    /// The pilot's own track, which keeps no speed or track (a GPX file's
    /// points have only where and when): each point's from the way to the
    /// next, the distance over the time between them, as a GPS works its
    /// own out from its fixes. A measurement of the flight, not a rule.
    nonisolated static func points(_ saved: [SavedTrackPoint]) -> [Point] {
        let plain = saved.map { Point(t: Double($0.t) / 1000, lat: $0.lat, lon: $0.lon, altFt: $0.altFt) }
        guard plain.count >= 2 else { return plain }
        var out = plain
        for i in plain.indices {
            let (a, b) = i + 1 < plain.count ? (plain[i], plain[i + 1]) : (plain[i - 1], plain[i])
            let hours = (b.t - a.t) / 3600
            guard hours > 0 else { continue }
            out[i].gsKt = Flight.nm(from: a.coordinate, to: b.coordinate) / hours
            out[i].trackDeg = bearing(from: a.coordinate, to: b.coordinate)
        }
        // A point at the same second as the next takes the one before's.
        for i in out.indices.dropFirst() where out[i].gsKt == nil {
            out[i].gsKt = out[i - 1].gsKt
            out[i].trackDeg = out[i - 1].trackDeg
        }
        return out
    }

    /// The true bearing from one point to the other, the great circle's
    /// initial course.
    nonisolated static func bearing(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> Double {
        let lat1 = a.latitude * .pi / 180, lat2 = b.latitude * .pi / 180, dLon = (b.longitude - a.longitude) * .pi / 180
        let y = sin(dLon) * cos(lat2), x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }
}
