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
    /// The airplane by its N-number, where one is picked: its type's
    /// profile is `aircraft`, and the pilot's own figures for it, where
    /// set on the gateway, are flown over the type's.
    var tail: String?
    var figures = Figures()
    /// An altitude of the pilot's own, feet MSL; nil for the planner's
    /// pick, with its warnings said where one is over a limit.
    var ownAltitudeFt: Double?
    /// An own altitude picked off the wheel, one of the planner's legal
    /// ones: flown at each leg's nearest legal altitude.
    var ownAltitudeLegal = false
    /// One of the four plans picked by name; nil for the planner's own.
    var altitudeChoice: String?
    /// The procedures picked for the route's fields, one per field and
    /// kind: a departure out of the departure, an arrival or an approach
    /// into a stop or the destination.
    var procedures: [ProcedurePick] = []
    /// The pilot's own edits of the route beyond its points: altitudes
    /// at points, holds, crossings and a Direct to (RouteEdits).
    var extras = RouteExtras()

    private(set) var course: Course?
    private(set) var checkpoints: [Checkpoint] = []
    private(set) var profile: RouteProfile?
    private(set) var altitude: NavLogAltitude?
    private(set) var briefing: Briefing?
    private(set) var routes: RouteOptions?
    private(set) var routesProblem: String?
    /// The route's stops as the pilot typed them, kept while one of the
    /// planner's ways is flown in their place: "None" on the route line
    /// flies them again.
    private(set) var typedStops: [String] = []
    /// The planner's way flown in place of the typed route, picked on the
    /// route line; nil for the route as typed.
    private(set) var pickedWay: RouteOption?
    /// The route the ways in `routes` were asked for, so a re-plan of the
    /// same route (a new altitude, a procedure) does not ask again.
    private var routesAskedFor: String?
    private(set) var briefingProblem: String?
    /// The legs a hazard tapped in the Brief is on, shown on the map
    /// (BriefLegs.swift); nil when none is.
    var hazardLegs: HazardLegs?
    private(set) var legs: [Leg] = []
    private(set) var altitudeFt: Double?
    private(set) var totals: Totals?
    private(set) var stage: String?
    private(set) var problem: NavLogError?
    private(set) var planning = false
    /// The chart along the route being kept for the air: tiles kept of
    /// tiles wanted; nil when not keeping.
    private(set) var keeping: (kept: Int, wanted: Int)?
    private var keepTask: Task<Void, Never>?

    private var running: Task<Void, Never>?

    /// When the plan shown was made; nil while it is being made now.
    private(set) var plannedAt: Date?

    /// The route's undo and redo (PlanHistory): each change taken in as
    /// it is planned or cleared, whichever button made it.
    private(set) var history = PlanHistory()
    /// What the last change took away, for the Undo bar; nil once it goes.
    private(set) var undoNote: UndoNote?
    /// The window's, from SwiftUI's environment (RootView): shake to undo
    /// and the Edit menu's Undo and Redo, for free.
    @ObservationIgnored weak var undoManager: UndoManager?
    /// Off while a kept plan is put back at launch: that is not the
    /// pilot's change to undo.
    @ObservationIgnored private var remembering = true

    var routed: Bool { !dep.isEmpty && !dest.isEmpty }

    /// What is on the page, kept for the air (Kept): after the nav log
    /// is whole, and as the briefing, checkpoints and side view come.
    func keep() {
        guard routed, course != nil, totals != nil else { return }
        Kept(dep: dep, dest: dest, stops: stops, aircraft: aircraft, ownAltitudeFt: ownAltitudeFt, altitudeChoice: altitudeChoice,
             course: course, checkpoints: checkpoints, profile: profile, altitude: altitude, legs: legs, totals: totals,
             briefing: briefing, plannedAt: plannedAt ?? Date()).save()
    }

    /// The last plan kept, back on the page at launch: planned again when
    /// the planner answers, kept as it was when it does not.
    func restore() {
        guard let kept = Kept.load() else { return }
        dep = kept.dep; dest = kept.dest; stops = kept.stops; aircraft = kept.aircraft
        ownAltitudeFt = kept.ownAltitudeFt; altitudeChoice = kept.altitudeChoice
        course = kept.course; checkpoints = kept.checkpoints; profile = kept.profile; altitude = kept.altitude
        legs = kept.legs; totals = kept.totals; altitudeFt = kept.altitude?.altitudeFt; briefing = kept.briefing
        plannedAt = kept.plannedAt
        remembering = false
        plan()
        remembering = true
        history = PlanHistory(routeState)
    }

    /// The route's idents in order, as the route box shows them.
    var idents: [String] { [dep] + stops + [dest] }

    /// The route cleared at once, no question asked: the Undo bar, shake
    /// or the Edit menu brings it back (PlanHistory).
    func clear() {
        dep = ""; dest = ""; stops = []
        ownAltitudeFt = nil; ownAltitudeLegal = false; altitudeChoice = nil; procedures = []
        extras = RouteExtras()
        typedStops = []; pickedWay = nil; routes = nil; routesProblem = nil; routesAskedFor = nil
        forgetPlanned()
        remember()
    }

    /// What the planner said of the route, gone with it.
    private func forgetPlanned() {
        running?.cancel()
        course = nil; checkpoints = []; profile = nil; altitude = nil; briefing = nil; briefingProblem = nil; hazardLegs = nil
        legs = []; totals = nil; altitudeFt = nil; stage = nil; problem = nil; planning = false; plannedAt = nil
        Kept.forget()
    }

    /// The route as it is now taken into the history: a change is a step
    /// to undo, said in the Undo bar where it took something away.
    private func remember() {
        guard remembering else { return }
        let (pushed, note) = history.observe(routeState)
        guard pushed else { return }
        undoNote = note.map { UndoNote(words: $0) }
        guard let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { plan in MainActor.assumeIsolated { plan.stepBack(registering: true) } }
        undoManager.setActionName(note ?? "Route Change")
    }

    /// One step back, the route as it was planned again; the step to redo
    /// handed to the UndoManager when it asked for this one.
    func stepBack(registering: Bool) {
        guard let state = history.undo() else { return }
        put(state)
        if registering, let undoManager {
            undoManager.registerUndo(withTarget: self) { plan in MainActor.assumeIsolated { plan.stepForward(registering: true) } }
        }
    }

    func stepForward(registering: Bool) {
        guard let state = history.redo() else { return }
        put(state)
        if registering, let undoManager {
            undoManager.registerUndo(withTarget: self) { plan in MainActor.assumeIsolated { plan.stepBack(registering: true) } }
        }
    }

    private func put(_ state: RouteState) {
        undoNote = nil
        dep = state.dep; dest = state.dest; stops = state.stops; procedures = state.procedures; extras = state.extras
        ownAltitudeFt = state.ownAltitudeFt; ownAltitudeLegal = state.ownAltitudeLegal; altitudeChoice = state.altitudeChoice
        if routed { plan() } else { forgetPlanned() }
    }

    /// The Undo bar put away, its time up.
    func dismissUndoNote(_ note: UndoNote) {
        if undoNote == note { undoNote = nil }
    }

    /// No steps back: a signed-out pilot's routes are not the next one's.
    func forgetHistory() {
        history = PlanHistory(routeState)
        undoNote = nil
        undoManager?.removeAllActions(withTarget: self)
    }

    /// The chart along the route kept for the air (KeepRoute), the
    /// zooms a pilot flies at: the chart's lowest to 10.
    func keepForTheAir(template: TileTemplate, minZoom: Int) {
        guard let course else { return }
        keepTask?.cancel()
        let tiles = KeepRoute.tiles(along: course.coordinates, minZoom: max(minZoom, 6), maxZoom: 10)
        keeping = (0, tiles.count)
        keepTask = Task { [weak self] in
            await KeepRoute.keep(tiles, template: template) { kept, wanted in
                Task { @MainActor in self?.keeping = (kept, wanted) }
            }
        }
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

    /// The plan as the gateway saves a flight: the route, its altitude,
    /// totals and the legs' points as checkpoints (SaveFlightRequest).
    func saved() -> SaveFlightRequest? {
        guard routed, let course else { return nil }
        var along = 0.0
        let points = legs.enumerated().map { i, leg -> SaveFlightCheckpoint in
            along += leg.distanceNm
            let point = checkpoints.first { ($0.name ?? $0.waypoint ?? "").uppercased() == leg.to.uppercased() }
            return SaveFlightCheckpoint(
                sequenceNo: i + 1, name: leg.to, category: point?.category ?? "point",
                lat: point?.lat ?? course.destination.lat, lon: point?.lon ?? course.destination.lon, alongTrackNm: along,
                altitudeFt: leg.altitudeFt, legDistanceNm: leg.distanceNm, trueCourseDeg: leg.trueCourseDeg,
                magneticHeadingDeg: leg.magneticHeadingDeg, groundspeedKt: leg.groundspeedKt, eteMin: leg.eteMin, fuelGal: leg.fuelGal)
        }
        return SaveFlightRequest(
            departureIdent: dep, destinationIdent: dest, stops: stops, cruiseAltitudeFt: altitudeFt.map { Int($0) },
            totalDistanceNm: totals?.distanceNm, totalEteMin: totals?.eteMin, totalFuelGal: totals?.fuelGal, checkpoints: points)
    }

    /// A saved flight back on the page: its route, planned again.
    func open(_ flight: SavedFlight) {
        dep = flight.departureIdent; dest = flight.destinationIdent; stops = flight.stops
        ownAltitudeFt = nil; altitudeChoice = nil
        extras = RouteExtras()
        plan()
    }

    /// An airplane by its N-number: one of the pilot's own with its
    /// figures, else the FAA's registry's type on the planner's profile
    /// for it, where it has one; the profile in use stands otherwise.
    func fly(tail: String, own: [OwnAircraft], profiles: [AircraftProfile]) async {
        let tail = tail.uppercased()
        self.tail = tail
        // The figures kept on this device for the N-number first, then the
        // pilot's own airplane's on the gateway, then the type's.
        let kept = TailFigures.load(tail)
        if let mine = own.first(where: { $0.tailNumber.uppercased() == tail }) {
            let wanted = mine.typeDesignator.lowercased().filter { $0.isLetter || $0.isNumber }
            if profiles.contains(where: { $0.name == wanted }) { aircraft = wanted }
            figures = kept.cruiseTasKt == nil && kept.serviceCeilingFt == nil ? Figures(mine) : kept
        } else {
            figures = kept
            if let registered = try? await Planner.registered(tail),
               let profile = Registered.profile(manufacturer: registered.manufacturer, model: registered.model, year: registered.year) {
                aircraft = profile
            }
        }
        if routed { plan() }
    }

    /// A procedure picked for a field, in place of any of its kind there;
    /// nil takes that kind off the field. Planned again.
    func pick(_ procedure: ProcedurePick?, kind: String, at ident: String) {
        procedures.removeAll { $0.ident == ident && $0.kind == kind }
        if let procedure { procedures.append(procedure) }
        plan()
    }

    /// The ways to fly the route as the pilot typed it, for the route
    /// line's chips: asked for once per route, whichever way is flown.
    private func findRoutes(dep: String, dest: String, stops: [String], aircraft: String, asked: String) async {
        do {
            let found = try await Planner.routeOptions(dep: dep, dest: dest, stops: stops, aircraft: aircraft)
            guard routesAskedFor == asked else { return }
            routes = found
        } catch {
            guard routesAskedFor == asked, !(error is CancellationError) else { return }
            routesProblem = error.localizedDescription
        }
    }

    /// A way off the route line flown at once, no asking first: its stops
    /// the route's, the typed ones kept for "None".
    func use(_ way: RouteOption) {
        if pickedWay == nil { typedStops = stops }
        pickedWay = way
        stops = way.stops
        plan()
    }

    /// "None" on the route line: the route as the pilot typed it again.
    func useTyped() {
        guard pickedWay != nil else { return }
        pickedWay = nil
        stops = typedStops
        plan()
    }

    /// The briefing, as the web app fetches it as soon as the route is known
    /// and again as the nav log gives the flight's time.
    func brief(dep: String, dest: String, stops: [String], eteMin: Double?) async {
        // Its hazards placed on the nav log's legs once they are in.
        let legs = BriefLegs.query(course: course, checkpoints: checkpoints, legs: self.legs)
        do {
            briefing = try await Planner.briefing(dep: dep, dest: dest, stops: stops, eteMin: eteMin, legs: legs)
            briefingProblem = nil
            keep()
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
        let own = ownAltitudeFt, legal = ownAltitudeLegal, choice = altitudeChoice, figures = figures
        let picks = procedures.filter { idents.contains($0.ident) }
        let extra = extras.query(procedures: picks)
        self.dep = dep; self.dest = dest; self.stops = stops
        remember()
        // A way picked stands while its stops are the route's; a stop
        // added, taken out or moved makes the route the pilot's own again,
        // and the ways are asked for afresh for it.
        if let way = pickedWay, way.stops.map({ $0.uppercased() }) != stops { pickedWay = nil }
        if pickedWay == nil { typedStops = stops }
        let asked = ([dep, dest, aircraft] + typedStops).joined(separator: " ")
        if asked != routesAskedFor {
            routesAskedFor = asked
            routes = nil; routesProblem = nil
            let typed = typedStops
            Task { [weak self] in await self?.findRoutes(dep: dep, dest: dest, stops: typed, aircraft: aircraft, asked: asked) }
        }
        planning = true
        problem = nil
        stage = "Finding the route…"
        running = Task { [weak self] in
            guard let self else { return }
            do {
                let course = try await Planner.course(dep: dep, dest: dest, stops: stops)
                guard !Task.isCancelled else { return }
                if self.course != course { self.hazardLegs = nil }
                self.course = course
                // The checkpoints beside the nav log, not before it: the
                // first read of a new route's chart takes a while, and the
                // log's legs name the same points as they come.
                Task { [weak self] in
                    if let points = try? await Planner.checkpoints(dep: dep, dest: dest, stops: stops), !Task.isCancelled {
                        self?.checkpoints = points
                        self?.keep()
                    }
                }
                if self.profile == nil || self.profile?.lengthNm != course.distanceNm {
                    Task { [weak self] in
                        if let ground = try? await Planner.routeProfile(dep: dep, dest: dest, stops: stops), !Task.isCancelled {
                            self?.profile = ground
                            self?.keep()
                        }
                    }
                }
                var fresh: [Leg] = []
                for try await message in NavLog.stream(dep: dep, dest: dest, stops: stops, aircraft: aircraft, figures: figures, altitudeFt: own, nearest: legal, choice: choice, procedures: picks, extra: extra) {
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
                        self.plannedAt = Date()
                        self.keep()
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
                    // With no connection the plan kept stands, the planner's
                    // words said with its time; a planner's own refusal is
                    // said as it is.
                    if self.legs.isEmpty || !(error is URLError) {
                        self.problem = NavLogError(detail: error.localizedDescription, brief: nil, reasons: nil, advice: nil)
                    }
                    self.stage = nil
                }
            }
            if !Task.isCancelled { self.planning = false }
        }
    }
}
