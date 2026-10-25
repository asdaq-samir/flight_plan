import CoreLocation
import Foundation
import Observation

/// The route flown on the ground, as the web app's dry run flies it
/// (navlog/dryRun.ts): the airplane moved along the course line at each
/// leg's planned groundspeed, faster than real time, the figures
/// counting down as they would in the air. A rehearsal of the plan, not
/// a fix: own ship's own position is left alone.
@MainActor
@Observable
final class DryRun {
    private(set) var running = false
    /// Seconds of flight flown so far.
    private(set) var flownS = 0.0
    /// How much faster than real time: 1, 10 or 60.
    var speed = 10.0
    private(set) var fix: OwnShip.Fix?

    private var line: [CLLocationCoordinate2D] = []
    private var legs: [Leg] = []
    private var ticking: Task<Void, Never>?

    var totalS: Double { legs.reduce(0) { $0 + ($1.eteMin ?? 0) * 60 } }
    var done: Bool { !legs.isEmpty && flownS >= totalS }

    func start(line: [CLLocationCoordinate2D], legs: [Leg]) {
        guard line.count >= 2, !legs.isEmpty else { return }
        self.line = line
        self.legs = legs
        flownS = 0
        running = true
        place()
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

    func pause() { running = false }

    func resume() {
        guard !done, !legs.isEmpty else { return }
        running = true
        start(line: line, legs: legs, keeping: flownS)
    }

    private func start(line: [CLLocationCoordinate2D], legs: [Leg], keeping flown: Double) {
        start(line: line, legs: legs)
        flownS = flown
        place()
    }

    func stop() {
        ticking?.cancel()
        running = false
        fix = nil
        flownS = 0
        legs = []
    }

    /// Where the airplane is `flownS` into the flight: the leg it is on by
    /// its planned minutes, and how far along it at that leg's groundspeed.
    private func place() {
        var left = flownS, along = 0.0, gs = 0.0, course = 0.0
        for leg in legs {
            let legS = (leg.eteMin ?? 0) * 60
            gs = leg.groundspeedKt ?? leg.tasKt
            course = leg.trueCourseDeg
            if left <= legS || legS == 0 {
                along += legS == 0 ? leg.distanceNm : leg.distanceNm * (left / legS)
                break
            }
            left -= legS
            along += leg.distanceNm
        }
        let at = Flight.point(alongNm: along, line: line)
        fix = OwnShip.Fix(coordinate: at, altitudeFt: nil, trackDeg: course, groundspeedKt: gs, accuracyM: 0, at: Date())
    }
}
