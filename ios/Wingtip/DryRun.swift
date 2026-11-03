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
    /// arriving at it. The tops of climb and descent are not rows of their
    /// own here: the app's legs do not carry their points' figures.
    struct Row: Encodable {
        let kind: String
        var airport: CourseEnd?
        var cp: Checkpoint?
        var leg: Leg?
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
        var rows = [Row(kind: "departure", airport: course.departure)]
        for hop in 0...stops.count {
            rows += checkpoints.filter { ($0.hop ?? 0) == hop }.map { Row(kind: "checkpoint", cp: $0) }
            if hop < stops.count { rows.append(Row(kind: "stop", airport: stops[hop])) }
        }
        rows.append(Row(kind: "destination", airport: course.destination))
        guard !legs.isEmpty, rows.count == legs.count + 1 else { return nil }
        for (i, leg) in legs.enumerated() { rows[i + 1].leg = leg }
        return rows
    }

    /// The engine's run of the plan from 0 s, as a replay's reports.
    static func run(course: Course, checkpoints: [Checkpoint], legs: [Leg]) -> [Replay.Point]? {
        guard let rows = rows(course: course, checkpoints: checkpoints, legs: legs) else { return nil }
        let ask = Ask(rows: rows, startS: 0, line: course.courseLine)
        let answer: Answer? = try? Engine.call("dry_run", ask, encoder: Planner.snakeEncoder, decoder: Planner.snakeCase)
        return answer.map { Replay.points($0.points) }
    }
}
