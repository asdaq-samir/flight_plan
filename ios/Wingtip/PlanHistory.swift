import Foundation

/// The route as the pilot set it, without what the planner said of it:
/// the points, the picks at its fields, its own edits and its altitude.
/// What an Undo puts back, as the web app's lib/planHistory keeps the
/// same keys of its address.
struct RouteState: Equatable, Sendable {
    var dep = ""
    var dest = ""
    var stops: [String] = []
    var procedures: [ProcedurePick] = []
    var extras = RouteExtras()
    var ownAltitudeFt: Double?
    var ownAltitudeLegal = false
    var altitudeChoice: String?

    var hasPoints: Bool { !dep.isEmpty || !dest.isEmpty || !stops.isEmpty }
}

/// Undo and redo for the route: the owner's rule is to make the pilot
/// aware and never stop them, so a Direct to, a route replaced, a stop
/// removed or the route cleared goes through at once and can be taken
/// back, with no question asked first. The same history as the web app's
/// (lib/planHistory), with the same words for what an edit took away.
struct PlanHistory: Equatable, Sendable {
    /// As many steps back as a pilot would take; the oldest go first.
    static let limit = 50

    private(set) var past: [RouteState] = []
    private(set) var now: RouteState
    private(set) var future: [RouteState] = []

    init(_ now: RouteState = RouteState()) { self.now = now }

    var canUndo: Bool { !past.isEmpty }
    var canRedo: Bool { !future.isEmpty }

    /// The route as it is now, taken in: a change is a step back (`pushed`),
    /// with what it took away in words where it took something (`note`,
    /// for the Undo bar). The same route again is no step.
    mutating func observe(_ next: RouteState) -> (pushed: Bool, note: String?) {
        guard next != now else { return (false, nil) }
        let note = Self.note(from: now, to: next)
        past.append(now)
        if past.count > Self.limit { past.removeFirst(past.count - Self.limit) }
        now = next
        future = []
        return (true, note)
    }

    /// One step back: the route to put back, or nil with none.
    mutating func undo() -> RouteState? {
        guard let back = past.popLast() else { return nil }
        future.insert(now, at: 0)
        now = back
        return back
    }

    /// The step taken back, again.
    mutating func redo() -> RouteState? {
        guard !future.isEmpty else { return nil }
        let again = future.removeFirst()
        past.append(now)
        now = again
        return again
    }

    /// What a change took away, in the bar's words ("Route cleared", "KMSN
    /// removed"); nil for one that only added or changed a figure, which
    /// shake and the Edit menu still undo.
    static func note(from before: RouteState, to after: RouteState) -> String? {
        if before.hasPoints && !after.hasPoints { return "Route cleared" }
        if let direct = after.extras.direct, direct != before.extras.direct { return "Direct to \(direct)" }
        if !before.dep.isEmpty, !before.dest.isEmpty, after.dep != before.dep || after.dest != before.dest { return "Route replaced" }
        let gone = before.stops.filter { !after.stops.contains($0) }
        if gone.count == 1 { return "\(gone[0]) removed" }
        if gone.count > 1 { return "Stops removed" }
        if after.procedures.count < before.procedures.count { return "Procedure removed" }
        if after.extras.holds.count < before.extras.holds.count { return "Hold removed" }
        return nil
    }
}

/// The words of the edit the Undo bar offers to take back; each its own,
/// so the same words twice is a bar put up again.
struct UndoNote: Equatable, Identifiable, Sendable {
    let id = UUID()
    let words: String
}

extension Plan {
    /// The route as the pilot has set it now.
    var routeState: RouteState {
        RouteState(dep: dep, dest: dest, stops: stops, procedures: procedures, extras: extras,
                   ownAltitudeFt: ownAltitudeFt, ownAltitudeLegal: ownAltitudeLegal, altitudeChoice: altitudeChoice)
    }

    /// The last change taken back: through the window's UndoManager where
    /// there is one, so shake and the Edit menu stay in step with the bar.
    func undo() {
        if let undoManager, undoManager.canUndo { undoManager.undo() } else { stepBack(registering: false) }
    }

    func redo() {
        if let undoManager, undoManager.canRedo { undoManager.redo() } else { stepForward(registering: false) }
    }
}
