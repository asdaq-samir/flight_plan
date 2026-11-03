import CoreLocation
import Foundation
import Observation

/// The route flown on the ground, as the web app's dry run flies it
/// (navlog/dryRun.ts): the engine's `dry_run` flies the plan on paper
/// once -- each leg in its own time on its true course at its ground
/// speed, along the course line the map draws, at the heights of the
/// plan's profile -- and the airplane is moved between its reports
/// faster than real time, the figures counting down as they would in the
/// air. Where it is between two reports is worked out here each tick, as
/// the web app does each frame (Replay.position). A rehearsal of the
/// plan, not a fix: own ship's own position is left alone.
@MainActor
@Observable
final class DryRun {
    private(set) var running = false
    /// Seconds of flight flown so far.
    private(set) var flownS = 0.0
    /// How much faster than real time: 1, 10 or 60.
    var speed = 10.0
    private(set) var fix: OwnShip.Fix?

    /// The flight flown on paper, its reports' times from its start, s.
    private var points: [Replay.Point] = []
    private var ticking: Task<Void, Never>?

    var totalS: Double { points.last?.t ?? 0 }
    var done: Bool { !points.isEmpty && flownS >= totalS }

    /// The plan flown from its departure; nothing where its rows cannot be
    /// laid out from the legs the nav log has (one still on its way).
    func start(course: Course, checkpoints: [Checkpoint], legs: [Leg]) {
        guard let run = Self.run(course: course, checkpoints: checkpoints, legs: legs), run.count >= 2 else { return }
        points = run
        flownS = 0
        running = true
        place()
        tick()
    }

    func pause() { running = false }

    func resume() {
        guard !done, !points.isEmpty else { return }
        running = true
        tick()
    }

    func stop() {
        ticking?.cancel()
        running = false
        fix = nil
        flownS = 0
        points = []
    }

    private func tick() {
        ticking?.cancel()
        ticking = Task { [weak self] in
            while let self, !Task.isCancelled, self.running {
                try? await Task.sleep(for: .milliseconds(500))
                self.flownS = min(self.totalS, self.flownS + 0.5 * self.speed)
                self.place()
                if self.done { self.running = false }
            }
        }
    }

    /// Where the airplane is `flownS` into the flight, between the run's
    /// reports either side: its height in proportion, its track and speed
    /// the earlier report's.
    private func place() {
        guard let at = Replay.position(points, at: min(flownS, totalS)) else { return }
        fix = OwnShip.Fix(coordinate: at.coordinate, altitudeFt: at.altFt, trackDeg: at.trackDeg, groundspeedKt: at.gsKt, accuracyM: 0, at: Date())
    }

    // MARK: - The run, the engine's

    /// A row of the nav log as the web app's navLogRows lays it out and the
    /// engine reads it: the departure, each hop's checkpoints, the stop it
    /// lands at, the destination, each after the departure with the leg
    /// arriving at it; and where a climb tops out or a descent starts on a
    /// leg, a row of its own before it, each row with the piece of the leg
    /// that arrives there (`part`).
    struct Row: Encodable {
        let kind: String
        var airport: CourseEnd?
        var cp: Checkpoint?
        var point: Turn?
        var leg: Leg?
        var part: Leg?
    }

    /// A top of climb or descent as the engine reads a row's point.
    struct Turn: Encodable {
        let alongNm: Double
        let altitudeFt: Double
        let lat: Double
        let lon: Double
        var toFt: Double?
        var pattern: Bool?
    }

    private struct Ask: Encodable {
        let rows: [Row]
        let startS: Double
        let line: [[Double]]
    }

    private struct Answer: Decodable {
        let points: [PastFlightPoint]
    }

    /// The rows for the legs the nav log has, as BriefLegs lays them out;
    /// nil where they do not make one row a leg.
    static func rows(course: Course, checkpoints: [Checkpoint], legs: [Leg]) -> [Row]? {
        let stops = course.stops ?? []
        var ends: [Row] = []
        for hop in 0...stops.count {
            ends += checkpoints.filter { ($0.hop ?? 0) == hop }.map { Row(kind: "checkpoint", cp: $0) }
            if hop < stops.count { ends.append(Row(kind: "stop", airport: stops[hop])) }
        }
        ends.append(Row(kind: "destination", airport: course.destination))
        guard !legs.isEmpty, ends.count == legs.count else { return nil }
        var rows = [Row(kind: "departure", airport: course.departure)]
        for (end, leg) in zip(ends, legs) {
            let (turns, part) = arriving(leg)
            rows += turns
            var row = end
            row.leg = leg
            row.part = part
            rows.append(row)
        }
        return rows
    }

    /// A leg's tops of climb and descent as rows, in the order flown, each
    /// with the piece of the leg up to it -- up to a top of climb at the
    /// climb's own speeds -- and the piece that arrives at the row the leg
    /// ends at (navLogRows' arriving). A point the plan gave no place or
    /// time for is left out, as a plan kept from before they were read has
    /// none.
    static func arriving(_ leg: Leg) -> (turns: [Row], part: Leg?) {
        typealias On = (kind: String, turn: Turn, eteMin: Double, fuelGal: Double?, tasKt: Double?, groundspeedKt: Double?)
        var on: [On] = []
        if let t = leg.toc, let along = t.alongNm, let ft = t.altitudeFt, let lat = t.lat, let lon = t.lon, let ete = t.eteMin {
            on.append(("toc", Turn(alongNm: along, altitudeFt: ft, lat: lat, lon: lon), ete, t.fuelGal, t.tasKt, t.groundspeedKt))
        }
        if let t = leg.tod, let along = t.alongNm, let ft = t.altitudeFt, let lat = t.lat, let lon = t.lon, let ete = t.eteMin {
            on.append(("tod", Turn(alongNm: along, altitudeFt: ft, lat: lat, lon: lon, toFt: t.toFt, pattern: t.pattern), ete, t.fuelGal, nil, nil))
        }
        guard !on.isEmpty else { return ([], nil) }
        var turns: [Row] = []
        var from = (nm: 0.0, min: 0.0, gal: 0.0)
        for o in on.sorted(by: { $0.turn.alongNm < $1.turn.alongNm }) {
            var part = piece(leg, from: from, to: (o.turn.alongNm, o.eteMin, o.fuelGal))
            if o.kind == "toc" {
                if let tas = o.tasKt { part.tasKt = tas }
                part.groundspeedKt = o.groundspeedKt
            }
            turns.append(Row(kind: o.kind, point: o.turn, leg: leg, part: part))
            from = (o.turn.alongNm, o.eteMin, o.fuelGal ?? 0)
        }
        return (turns, piece(leg, from: from, to: (leg.distanceNm, leg.eteMin, leg.fuelGal)))
    }

    /// The piece of `leg` from one point on it to the next: the miles,
    /// minutes and fuel between them.
    private static func piece(_ leg: Leg, from: (nm: Double, min: Double, gal: Double), to: (nm: Double, min: Double?, gal: Double?)) -> Leg {
        var part = leg
        part.distanceNm = max(0, to.nm - from.nm)
        part.eteMin = to.min.map { max(0, $0 - from.min) }
        part.fuelGal = to.gal.map { max(0, $0 - from.gal) }
        return part
    }

    /// The engine's run of the plan from 0 s, as a replay's reports. Its
    /// heights only where the plan's climb is in the rows: with no top of
    /// climb (a plan kept from before they were read) the profile would
    /// hold the field's elevation the whole way, and traffic would be
    /// labelled against that, so the height is left unknown, as the old
    /// run left it.
    static func run(course: Course, checkpoints: [Checkpoint], legs: [Leg]) -> [Replay.Point]? {
        guard let rows = rows(course: course, checkpoints: checkpoints, legs: legs) else { return nil }
        let ask = Ask(rows: rows, startS: 0, line: course.courseLine)
        guard let answer: Answer = try? Engine.call("dry_run", ask, encoder: Planner.snakeEncoder, decoder: Planner.snakeCase) else { return nil }
        let heights = rows.contains { $0.kind == "toc" }
        return Replay.points(answer.points).map { point in
            var point = point
            if !heights { point.altFt = nil }
            return point
        }
    }
}
