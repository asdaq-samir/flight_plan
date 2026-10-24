import CoreLocation
import Foundation

/// The figures of flying a planned route from where the airplane is, as
/// the web app's dry run works them out (navlog/dryRun.ts dryRunAt): how
/// far along the course line the position is, what is left to the next
/// landing, the time at the groundspeed now, and the fuel burnt so far
/// taken off what the planner required. Arithmetic on the planner's
/// figures, no rule of its own.
enum Flight {
    struct Left: Equatable, Sendable {
        /// Miles along the course line to the position's nearest point.
        let alongNm: Double
        let totalNm: Double
        var leftNm: Double { max(0, totalNm - alongNm) }
    }

    /// Where on the course line the position is: the nearest point on the
    /// line's segments, measured along the line from its start.
    static func along(_ position: CLLocationCoordinate2D, line: [CLLocationCoordinate2D]) -> Left? {
        guard line.count >= 2 else { return nil }
        var best: (distance: Double, along: Double)?
        var cursor = 0.0
        let lengths = zip(line, line.dropFirst()).map { nm(from: $0, to: $1) }
        for (i, (a, b)) in zip(line, line.dropFirst()).enumerated() {
            // The nearest point on the segment, on a flat patch of the earth
            // round it, which a leg of a few miles is.
            let scale = cos(a.latitude * .pi / 180)
            let ax = a.longitude * scale, ay = a.latitude, bx = b.longitude * scale, by = b.latitude
            let px = position.longitude * scale, py = position.latitude
            let dx = bx - ax, dy = by - ay
            let t = dx == 0 && dy == 0 ? 0 : max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
            let near = CLLocationCoordinate2D(latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t)
            let off = nm(from: position, to: near)
            if best == nil || off < best!.distance { best = (off, cursor + lengths[i] * t) }
            cursor += lengths[i]
        }
        guard let best else { return nil }
        return Left(alongNm: best.along, totalNm: cursor)
    }

    /// The fuel the legs burn up to `alongNm` miles along the route, each
    /// leg's own burn spread over its miles.
    static func burnt(legs: [Leg], alongNm: Double) -> Double {
        var left = alongNm, gal = 0.0
        for leg in legs {
            guard left > 0 else { break }
            let share = min(1, left / max(leg.distanceNm, 0.001))
            gal += (leg.fuelGal ?? 0) * share
            left -= leg.distanceNm
        }
        return gal
    }

    /// How far off the line the position is, nm, to the nearest point.
    static func off(_ position: CLLocationCoordinate2D, line: [CLLocationCoordinate2D]) -> Double {
        guard let left = along(position, line: line) else { return .infinity }
        let at = point(alongNm: left.alongNm, line: line)
        return nm(from: position, to: at)
    }

    /// The point `alongNm` miles along the line.
    static func point(alongNm: Double, line: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D {
        var left = alongNm
        for (a, b) in zip(line, line.dropFirst()) {
            let length = nm(from: a, to: b)
            if left <= length || length == 0 {
                let t = length == 0 ? 0 : max(0, min(1, left / length))
                return CLLocationCoordinate2D(latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t)
            }
            left -= length
        }
        return line.last ?? CLLocationCoordinate2D()
    }

    static func nm(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> Double {
        CLLocation(latitude: a.latitude, longitude: a.longitude).distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude)) / 1852
    }
}
