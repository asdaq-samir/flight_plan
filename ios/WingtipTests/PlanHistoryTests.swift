import Foundation
import Testing
@testable import Wingtip

/// The route's undo and redo (PlanHistory): every change a step back, the
/// cleared route given back whole, what was redone dropped by a new
/// change, and the bar's words the web app's (lib/planHistory).
struct PlanHistoryTests {
    private let route = RouteState(dep: "KMSN", dest: "KDPA", stops: ["KJVL", "KRFD"])

    private func pick(_ ident: String, _ id: String) -> ProcedurePick {
        ProcedurePick(ident: ident, id: id, kind: "IAP", name: id, transition: nil)
    }

    @Test func aClearedRouteComesBackAndGoesAgain() {
        var history = PlanHistory(route)
        let cleared = history.observe(RouteState())
        #expect(cleared.pushed && cleared.note == "Route cleared")
        #expect(history.undo() == route)
        #expect(history.undo() == nil)
        #expect(history.redo() == RouteState())
        #expect(history.redo() == nil)
        #expect(history.canUndo && !history.canRedo)
    }

    @Test func theSameRouteIsNoStep() {
        var history = PlanHistory(route)
        let again = history.observe(route)
        #expect(!again.pushed && again.note == nil)
        #expect(!history.canUndo)
    }

    @Test func aNewChangeDropsWhatWasRedone() {
        var history = PlanHistory(route)
        var shorter = route
        shorter.stops = ["KJVL"]
        _ = history.observe(shorter)
        _ = history.undo()
        var elsewhere = route
        elsewhere.dest = "KUGN"
        _ = history.observe(elsewhere)
        #expect(!history.canRedo)
        #expect(history.undo() == route)
    }

    @Test func itDoesNotGrowWithoutEnd() {
        var history = PlanHistory(RouteState(dep: "A0"))
        for i in 1...(PlanHistory.limit + 10) { _ = history.observe(RouteState(dep: "A\(i)")) }
        #expect(history.past.count == PlanHistory.limit)
    }

    @Test func itSaysWhatWasTakenAway() {
        var oneLess = route
        oneLess.stops = ["KJVL"]
        #expect(PlanHistory.note(from: route, to: oneLess) == "KRFD removed")
        #expect(PlanHistory.note(from: route, to: RouteState(dep: "KMSN", dest: "KDPA")) == "Stops removed")

        var direct = RouteState(dep: "@42.1000,-88.2000", dest: "KDPA", stops: ["KRFD"])
        direct.extras.direct = "KRFD"
        direct.extras.was = RouteWas(dep: "KMSN", stops: ["KJVL", "KRFD"], dest: "KDPA")
        #expect(PlanHistory.note(from: route, to: direct) == "Direct to KRFD")
        #expect(PlanHistory.note(from: route, to: RouteState(dep: "KMSN", dest: "KUGN", stops: route.stops)) == "Route replaced")

        var two = route, one = route
        two.procedures = [pick("KDPA", "R02R"), pick("KMSN", "ACKER4")]
        one.procedures = [pick("KMSN", "ACKER4")]
        #expect(PlanHistory.note(from: two, to: one) == "Procedure removed")

        var held = route
        held.extras.holds = [Hold(fix: "KJVL", inbound: 90, right: true, legMin: 1, turns: 2)]
        #expect(PlanHistory.note(from: held, to: route) == "Hold removed")

        // Adding is not taking away: no bar, shake still undoes it.
        var more = route
        more.stops.append("KUES")
        #expect(PlanHistory.note(from: route, to: more) == nil)
        #expect(PlanHistory.note(from: RouteState(dep: "KMSN"), to: RouteState(dep: "KMSN", dest: "KDPA")) == nil)
    }
}
