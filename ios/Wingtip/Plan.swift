import Foundation
import Observation

/// The route being planned and what the planner has said of it so far:
/// the course as soon as its ends are found, then the nav log's lines as
/// they stream. The log before a re-plan stays on the page until the new
/// one is whole, as the web app keeps it (usePlan), so the pilot is never
/// looking at a blank list.
@MainActor
@Observable
final class Plan {
    var dep = ""
    var dest = ""
    var stops: [String] = []
    /// The planner's aircraft profile; the airplane by N-number comes in
    /// phase 3.
    var aircraft = "c172"
    /// An altitude of the pilot's own, feet MSL; nil for the planner's
    /// pick, with its warnings said where one is over a limit.
    var ownAltitudeFt: Double?

    private(set) var course: Course?
    private(set) var legs: [Leg] = []
    private(set) var altitudeFt: Double?
    private(set) var totals: Totals?
    private(set) var stage: String?
    private(set) var problem: NavLogError?
    private(set) var planning = false

    private var running: Task<Void, Never>?

    var routed: Bool { !dep.isEmpty && !dest.isEmpty }

    /// The route's idents in order, as the route box shows them.
    var idents: [String] { [dep] + stops + [dest] }

    func clear() {
        running?.cancel()
        dep = ""; dest = ""; stops = []
        course = nil; legs = []; totals = nil; altitudeFt = nil; stage = nil; problem = nil; planning = false
    }

    /// Plans the route as entered: the course first, for the map, then
    /// the nav log streamed in.
    func plan() {
        guard routed else { return }
        running?.cancel()
        let dep = dep.uppercased(), dest = dest.uppercased(), stops = stops.map { $0.uppercased() }, aircraft = aircraft, own = ownAltitudeFt
        self.dep = dep; self.dest = dest; self.stops = stops
        planning = true
        problem = nil
        stage = "Finding the route…"
        running = Task { [weak self] in
            guard let self else { return }
            do {
                let course = try await Planner.course(dep: dep, dest: dest, stops: stops)
                guard !Task.isCancelled else { return }
                self.course = course
                var fresh: [Leg] = []
                for try await message in NavLog.stream(dep: dep, dest: dest, stops: stops, aircraft: aircraft, altitudeFt: own) {
                    guard !Task.isCancelled else { return }
                    switch message {
                    case .stage(let detail): self.stage = detail
                    case .altitude(let altitude): self.altitudeFt = altitude.altitudeFt
                    case .leg(let leg):
                        fresh.append(leg)
                        // Each leg as it comes, once the first is in: the
                        // old log stands until then.
                        self.legs = fresh
                    case .done(let totals):
                        self.legs = fresh
                        self.totals = totals
                        self.stage = nil
                    case .error(let error):
                        self.problem = error
                        self.stage = nil
                    }
                }
            } catch {
                if !Task.isCancelled {
                    self.problem = NavLogError(detail: error.localizedDescription, brief: nil, reasons: nil, advice: nil)
                    self.stage = nil
                }
            }
            if !Task.isCancelled { self.planning = false }
        }
    }
}
