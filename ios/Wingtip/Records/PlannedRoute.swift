import Foundation
import SwiftData

/// A route the pilot planned, as the route box held it: the points, the
/// altitude, when. The plan history the pilot keeps across their devices
/// -- the route planned on the iPad at home, on the iPhone in the
/// cockpit -- apart from PlanHistory's undo steps, which are this
/// device's and this session's. The stops are one line of idents, as the
/// web app's route address writes them, since a store carries words.
@Model
final class PlannedRoute {
    var dep: String = ""
    var dest: String = ""
    var stopsLine: String = ""
    var altitudeFt: Double?
    var altitudeChoice: String?
    var plannedAt: Date = Date()

    init(dep: String, dest: String, stops: [String], altitudeFt: Double?, altitudeChoice: String?, plannedAt: Date) {
        self.dep = dep
        self.dest = dest
        stopsLine = stops.joined(separator: " ")
        self.altitudeFt = altitudeFt
        self.altitudeChoice = altitudeChoice
        self.plannedAt = plannedAt
    }

    var stops: [String] { stopsLine.split(separator: " ").map(String.init) }

    /// The route as it goes back into the route box.
    var routeState: RouteState {
        RouteState(dep: dep, dest: dest, stops: stops, ownAltitudeFt: altitudeFt, altitudeChoice: altitudeChoice)
    }
}

extension PlanHistory {
    /// A route planned, kept (Plan.keep): the same points and altitude
    /// planned again move to the top with the new time rather than
    /// repeat, and the list stays at `limit`, the oldest let go.
    @MainActor
    static func planned(_ state: RouteState, at: Date, in context: ModelContext = Records.container.mainContext) {
        guard state.hasPoints else { return }
        let stopsLine = state.stops.joined(separator: " ")
        let (dep, dest, altitudeFt) = (state.dep, state.dest, state.ownAltitudeFt)
        let same = FetchDescriptor<PlannedRoute>(predicate: #Predicate {
            $0.dep == dep && $0.dest == dest && $0.stopsLine == stopsLine && $0.altitudeFt == altitudeFt
        })
        if let had = (try? context.fetch(same))?.first {
            guard had.plannedAt != at else { return }
            had.plannedAt = at
            had.altitudeChoice = state.altitudeChoice
        } else {
            context.insert(PlannedRoute(dep: dep, dest: dest, stops: state.stops, altitudeFt: altitudeFt,
                                        altitudeChoice: state.altitudeChoice, plannedAt: at))
        }
        for old in routes(in: context).dropFirst(limit) { context.delete(old) }
        try? context.save()
    }

    /// The routes planned, newest first.
    @MainActor
    static func routes(in context: ModelContext = Records.container.mainContext) -> [PlannedRoute] {
        (try? context.fetch(FetchDescriptor<PlannedRoute>(sortBy: [SortDescriptor(\.plannedAt, order: .reverse)]))) ?? []
    }
}
