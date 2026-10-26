import Foundation
import Testing
@testable import Wingtip

/// The route line's chips and what tapping them flies, from an answer
/// shaped as /api/route-options sends it (RouteOptions).
struct RouteLineTests {
    static let answer = #"""
    {"options":[
     {"kind":"weather","kinds":["weather"],"title":"Best weather","stops":["KMVN","KJLN"],"fuel":["KJLN"],"path":[[40.41,-86.94],[38.32,-88.86],[37.15,-94.5],[35.39,-97.6]],"distance_nm":650.0,"air_min":400.0,"ground_min":31.0,"fuel_gal":60.0,"landings":1,"crosses":[],"marginal":[1]},
     {"kind":"fastest","kinds":["fastest","stops"],"title":"Fastest","stops":["KTBN"],"fuel":["KTBN"],"path":[[40.41,-86.94],[37.74,-92.14],[35.39,-97.6]],"distance_nm":628.0,"air_min":327.0,"ground_min":31.0,"fuel_gal":52.0,"landings":1,"crosses":[0],"marginal":[]},
     {"kind":"land","kinds":["land"],"title":"Over land","stops":["KTBN"],"fuel":["KTBN"],"path":[[40.41,-86.94],[37.74,-92.14],[35.39,-97.6]],"distance_nm":628.0,"air_min":327.0,"ground_min":31.0,"fuel_gal":52.0,"landings":1,"crosses":[0],"marginal":[]}],
     "own":{"kind":"own","kinds":["own"],"title":"Your Route","stops":["KCOU"],"fuel":["KCOU"],"path":[[40.41,-86.94],[38.82,-92.22],[35.39,-97.6]],"distance_nm":620.0,"air_min":354.0,"ground_min":31.0,"fuel_gal":55.0,"landings":1,"crosses":[0,2],"marginal":[]},
     "direct":[0],"ends":[],
     "hazards":[{"kind":"storm","name":"Thunderstorms near KSGF"},{"kind":"mvfr","name":"Marginal VFR"},{"kind":"fuel","name":"Fuel"}],
     "unchecked":[]}
    """#

    static func routes() throws -> RouteOptions {
        try Planner.snakeCase.decode(RouteOptions.self, from: Data(answer.utf8))
    }

    @Test func theChipsAreNoneThenEachWayByItsTitleAndStops() throws {
        let chips = RouteLine.chips(try Self.routes(), typed: [])
        #expect(chips.map(\.label) == ["None", "Your Route · KCOU", "Best weather · KMVN KJLN", "Fastest · KTBN", "Over land · KTBN"])
        #expect(chips.first?.way == nil)
    }

    @Test func yourRouteAddingNothingIsLeftOutAsItIsNone() throws {
        let chips = RouteLine.chips(try Self.routes(), typed: ["kcou"])
        #expect(!chips.map(\.label).contains("Your Route · KCOU"))
        #expect(chips.first?.label == "None")
    }

    @Test func thePlannersOwnLabelIsUsedWhereItSendsOne() throws {
        let json = #"{"kind":"weather","kinds":["weather"],"title":"Best weather","label":"Avoid Weather · KMVN KJLN","stops":["KMVN","KJLN"],"fuel":[],"path":[],"distance_nm":650.0,"air_min":400.0,"ground_min":0.0,"fuel_gal":60.0,"landings":0,"crosses":[],"marginal":[]}"#
        let way = try Planner.snakeCase.decode(RouteOption.self, from: Data(json.utf8))
        #expect(RouteLine.label(way) == "Avoid Weather · KMVN KJLN")
        // Without one, the title and the stops.
        #expect(RouteLine.label(try Self.routes().options[1]) == "Fastest · KTBN")
    }

    @Test func beforeTheAnswerOnlyNoneIsOffered() {
        #expect(RouteLine.chips(nil, typed: []).map(\.label) == ["None"])
    }

    @MainActor @Test func aChipIsFlownAtOnceAndNoneRestoresTheTypedRoute() throws {
        let plan = Plan()
        plan.dep = "KLAF"; plan.dest = "KOKC"; plan.stops = ["KSTL"]
        plan.plan()
        #expect(plan.typedStops == ["KSTL"] && plan.pickedWay == nil)
        let fastest = try Self.routes().options[1]
        plan.use(fastest)
        #expect(plan.stops == ["KTBN"] && plan.pickedWay == fastest)
        // The typed route is kept while the way is flown.
        #expect(plan.typedStops == ["KSTL"])
        let chips = RouteLine.chips(try Self.routes(), typed: plan.typedStops)
        #expect(RouteLine.picked(chips, way: plan.pickedWay).label == "Fastest · KTBN")
        // Another way after it still comes back to the typed route.
        plan.use(try Self.routes().options[0])
        #expect(plan.stops == ["KMVN", "KJLN"] && plan.typedStops == ["KSTL"])
        plan.useTyped()
        #expect(plan.stops == ["KSTL"] && plan.pickedWay == nil)
        #expect(RouteLine.picked(chips, way: plan.pickedWay).label == "None")
    }

    @MainActor @Test func aStopEditedMakesTheRouteThePilotsOwnAgain() throws {
        let plan = Plan()
        plan.dep = "KLAF"; plan.dest = "KOKC"
        plan.use(try Self.routes().options[1])
        plan.stops.append("KICT")
        plan.plan()
        #expect(plan.pickedWay == nil && plan.typedStops == ["KTBN", "KICT"])
        plan.clear()
        #expect(plan.typedStops.isEmpty && plan.pickedWay == nil && plan.routes == nil)
    }
}
