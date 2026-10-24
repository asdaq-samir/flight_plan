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
    /// An own altitude picked off the wheel, one of the planner's legal
    /// ones: flown at each leg's nearest legal altitude.
    var ownAltitudeLegal = false
    /// One of the four plans picked by name; nil for the planner's own.
    var altitudeChoice: String?

    private(set) var course: Course?
    private(set) var checkpoints: [Checkpoint] = []
    private(set) var profile: RouteProfile?
    private(set) var altitude: NavLogAltitude?
    private(set) var briefing: Briefing?
    private(set) var briefingProblem: String?
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
        course = nil; checkpoints = []; profile = nil; altitude = nil; briefing = nil; briefingProblem = nil
        legs = []; totals = nil; altitudeFt = nil; stage = nil; problem = nil; planning = false
        ownAltitudeFt = nil; ownAltitudeLegal = false; altitudeChoice = nil
    }

    /// The planner's fuel stops put into the route, the whole chain before
    /// the flight's destination, at the owner's ask ("suggest fuel stops
    /// just like Tesla suggests").
    func addFuelStops(_ suggestion: FuelStopSuggestion) {
        let before = (stops.firstIndex(of: suggestion.destination) ?? stops.count)
        stops.insert(contentsOf: suggestion.stops.map(\.ident), at: before)
        plan()
    }

    /// A way round what stops the route put in: the points to fly by,
    /// before the stop they are for.
    func goRound(_ detour: Detour) {
        let points = (detour.via?.isEmpty == false) ? detour.via! : [detour.ident]
        stops.insert(contentsOf: points, at: min(detour.stopIndex, stops.count))
        plan()
    }

    /// The briefing, as the web app fetches it as soon as the route is known
    /// and again as the nav log gives the flight's time.
    func brief(dep: String, dest: String, stops: [String], eteMin: Double?) async {
        do {
            briefing = try await Planner.briefing(dep: dep, dest: dest, stops: stops, eteMin: eteMin)
            briefingProblem = nil
        } catch {
            briefingProblem = error.localizedDescription
        }
    }

    /// Plans the route as entered: the course first, for the map, then
    /// the nav log streamed in.
    func plan() {
        guard routed else { return }
        running?.cancel()
        let dep = dep.uppercased(), dest = dest.uppercased(), stops = stops.map { $0.uppercased() }, aircraft = aircraft
        let own = ownAltitudeFt, legal = ownAltitudeLegal, choice = altitudeChoice
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
                // The checkpoints beside the nav log, not before it: the
                // first read of a new route's chart takes a while, and the
                // log's legs name the same points as they come.
                Task { [weak self] in
                    if let points = try? await Planner.checkpoints(dep: dep, dest: dest, stops: stops), !Task.isCancelled {
                        self?.checkpoints = points
                    }
                }
                if self.profile == nil || self.profile?.lengthNm != course.distanceNm {
                    Task { [weak self] in
                        if let ground = try? await Planner.routeProfile(dep: dep, dest: dest, stops: stops), !Task.isCancelled {
                            self?.profile = ground
                        }
                    }
                }
                var fresh: [Leg] = []
                for try await message in NavLog.stream(dep: dep, dest: dest, stops: stops, aircraft: aircraft, altitudeFt: own, nearest: legal, choice: choice) {
                    guard !Task.isCancelled else { return }
                    switch message {
                    case .stage(let detail): self.stage = detail
                    case .altitude(let altitude):
                        self.altitude = altitude
                        self.altitudeFt = altitude.altitudeFt
                    case .leg(let leg):
                        fresh.append(leg)
                        // Each leg as it comes, once the first is in: the
                        // old log stands until then.
                        self.legs = fresh
                    case .done(let totals):
                        self.legs = fresh
                        self.totals = totals
                        self.stage = nil
                        // The briefing for the flight's own hours, once
                        // the nav log says how long it takes.
                        Task { [weak self] in await self?.brief(dep: dep, dest: dest, stops: stops, eteMin: totals.eteMin) }
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
