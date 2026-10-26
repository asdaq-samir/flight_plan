import Foundation
import Testing
@testable import Wingtip

/// The route line's chips and what tapping them flies, from an answer
/// shaped as /api/route-options sends it (RouteOptions, the planner's
/// own KLAF to KOKC answer of 2026-10-26 cut short).
struct RouteLineTests {
    static let answer = #"""
    {"options":[
     {"kind":"fastest","kinds":["fastest","stops","land"],"title":"Fastest","stops":["KVIH"],"fuel":["KVIH"],"path":[[40.41287,-86.93936],[38.12743,-91.76951],[35.39339,-97.59825]],"distance_nm":587.9,"air_min":319.9,"ground_min":30.0,"fuel_gal":44.8,"landings":1,"crosses":[],"marginal":[1],"bands":[{"kind":"vfr","min":101.7},{"kind":"mvfr","min":26.8},{"kind":"vfr","min":191.4}],"tail_kt":-4.7,"floor_ft":2500,"water_nm":0},
     {"kind":"weather","kinds":["weather"],"title":"Best weather","stops":["CHUUC","KAOV"],"fuel":["KAOV"],"path":[[40.41287,-86.93936],[38.08913,-90.56766],[36.97189,-92.68195],[35.39339,-97.59825]],"distance_nm":596.2,"air_min":329.6,"ground_min":30.0,"fuel_gal":46.1,"landings":1,"crosses":[],"marginal":[],"bands":[{"kind":"vfr","min":329.6}],"tail_kt":-1.4,"floor_ft":2700,"water_nm":0}],
     "own":{"kind":"own","kinds":["own"],"title":"Your Route","stops":["KVIH"],"fuel":["KVIH"],"path":[[40.41287,-86.93936],[38.12743,-91.76951],[35.39339,-97.59825]],"distance_nm":587.9,"air_min":319.9,"ground_min":30.0,"fuel_gal":44.8,"landings":1,"crosses":[],"marginal":[1],"tail_kt":-4.7,"floor_ft":2500,"water_nm":0},
     "direct":[0],"ends":[],"current":[0],"current_marginal":[],
     "current_along":{},"current_path":[[40.41287,-86.93936],[35.39339,-97.59825]],
     "chips":[
      {"key":"none","label":"None","stops":[],"fuel":[],"crosses":[0]},
      {"key":"fuel","label":"Your Route · KVIH","stops":["KVIH"],"fuel":["KVIH"],"crosses":[]},
      {"key":"weather","label":"Avoid Weather · CHUUC KAOV","stops":["CHUUC","KAOV"],"fuel":["KAOV"],"crosses":[]}],
     "hazards":[{"kind":"storm","name":"Convective SIGMET WSUS32 KKCI 262155"},{"kind":"marginal","name":"KMVN forecast marginal (ceiling 25,000 ft, visibility 3 sm)"}],
     "unchecked":[]}
    """#

    static func routes() throws -> RouteOptions {
        try Planner.snakeCase.decode(RouteOptions.self, from: Data(answer.utf8))
    }

    @Test func theChipsAreThePlannersWordsInItsOrder() throws {
        let chips = RouteLine.chips(try Self.routes())
        #expect(chips.map(\.label) == ["None", "Your Route · KVIH", "Avoid Weather · CHUUC KAOV"])
        #expect(chips[2].stops == ["CHUUC", "KAOV"] && chips[2].fuel == ["KAOV"])
        // What "None" crosses is the typed route's, by index into the
        // answer's hazards.
        let hazards = try Self.routes().hazards
        #expect(chips[0].crosses == [0] && hazards[0].kind == "storm")
    }

    @Test func beforeTheAnswerOnlyNoneIsOfferedAndNothingButTheRouteHidesTheLine() throws {
        #expect(RouteLine.chips(nil).map(\.label) == ["None"])
        #expect(RouteLine.shows(nil, picked: nil, problem: nil))
        var bare = try Self.routes()
        bare.chips = []
        #expect(!RouteLine.shows(bare, picked: nil, problem: nil))
        #expect(RouteLine.shows(try Self.routes(), picked: nil, problem: nil))
        // A way flown keeps the line, so "None" can bring the route back.
        #expect(RouteLine.shows(bare, picked: RouteChip(key: "fuel", label: "Your Route · KVIH", stops: ["KVIH"]), problem: nil))
    }

    @MainActor @Test func aChipIsFlownAtOnceAndNoneRestoresTheTypedRoute() throws {
        let plan = Plan()
        plan.dep = "KLAF"; plan.dest = "KOKC"; plan.stops = ["KSTL"]
        plan.plan()
        #expect(plan.typedStops == ["KSTL"] && plan.pickedChip == nil)
        let chips = RouteLine.chips(try Self.routes())
        plan.use(chips[1])
        #expect(plan.stops == ["KVIH"] && plan.pickedChip == chips[1])
        // The typed route is kept while the way is flown.
        #expect(plan.typedStops == ["KSTL"])
        #expect(RouteLine.picked(chips, chip: plan.pickedChip).label == "Your Route · KVIH")
        // Another way after it still comes back to the typed route, and
        // "None" flies the typed stops, not the chip's own.
        plan.use(chips[2])
        #expect(plan.stops == ["CHUUC", "KAOV"] && plan.typedStops == ["KSTL"])
        plan.use(chips[0])
        #expect(plan.stops == ["KSTL"] && plan.pickedChip == nil)
        #expect(RouteLine.picked(chips, chip: plan.pickedChip).label == "None")
    }

    @MainActor @Test func aStopEditedMakesTheRouteThePilotsOwnAgain() throws {
        let plan = Plan()
        plan.dep = "KLAF"; plan.dest = "KOKC"
        plan.use(RouteLine.chips(try Self.routes())[1])
        plan.stops.append("KICT")
        plan.plan()
        #expect(plan.pickedChip == nil && plan.typedStops == ["KVIH", "KICT"])
        plan.clear()
        #expect(plan.typedStops.isEmpty && plan.pickedChip == nil && plan.routes == nil)
    }
}
