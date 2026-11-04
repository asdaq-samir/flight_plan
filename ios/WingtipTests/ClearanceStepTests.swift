import Foundation
import Testing
@testable import Wingtip

/// The clearance step's checks (ClearanceStep): the read back's lines
/// from the engine's readback_check, and the cleared route against the
/// filed one, each on the web's shared fixtures (readbacks.json,
/// clearances.json, bundled by project.yml).
private final class FixtureBundle {}

private struct FixtureMissing: Error { let name: String }

private func fixture<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
    guard let url = Bundle(for: FixtureBundle.self).url(forResource: name, withExtension: "json") else { throw FixtureMissing(name: name) }
    return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
}

private struct ReadbacksFixture: Decodable {
    struct Case: Decodable { let name: String; let said: String; let items: [ReadbackCheck.Item]; let words: String }
    let cleared: String
    let cases: [Case]
}

private struct ClearancesFixture: Decodable {
    struct Route: Decodable { let dep: String; let stops: [String]; let dest: String }
    struct Cleared: Decodable { let heard: String; let found: ClearancePlaces; let planned: Route; let route: Route; let typed: [Clearance.Typed] }
    let routes: [Cleared]
}

@MainActor
struct ClearanceStepTests {
    @Test func theReadBackIsCheckedAsTheWebChecksIt() throws {
        let f = try fixture("readbacks", as: ReadbacksFixture.self)
        for c in f.cases {
            let check = try #require(ReadbackCheck.check(cleared: f.cleared, said: c.said), "\(c.name)")
            #expect(check.items == c.items && check.words == c.words, "\(c.name)")
        }
    }

    @Test func aFullReadBackIsOneTickNamingEveryPart() throws {
        let f = try fixture("readbacks", as: ReadbacksFixture.self)
        let clearance = Clearance.read(f.cleared)
        let check = try #require(ReadbackCheck.check(cleared: f.cleared, said: f.cases[0].said))
        let lines = ReadbackCheck.lines(clearance, check)
        #expect(lines.map(\.ok) == [true])
        #expect(lines[0].words == "Limit, route, altitude, expected altitude, frequency and squawk read back")
    }

    @Test func aMissOrADifferenceIsOneLineEach() throws {
        let f = try fixture("readbacks", as: ReadbacksFixture.self)
        let clearance = Clearance.read(f.cleared)
        // The third case: the altitude said differently, the squawk missed.
        let check = try #require(ReadbackCheck.check(cleared: f.cleared, said: f.cases[2].said))
        let lines = ReadbackCheck.lines(clearance, check)
        #expect(lines.map(\.ok) == [true, false, false])
        #expect(lines[0].words == "Limit, route, expected altitude and frequency read back")
        #expect(lines[1].words == "Altitude: 4,000 ft said, 5,000 ft cleared")
        #expect(lines[2].words == "Squawk 4512 not read back")
    }

    @Test func theClearedRouteIsComparedToTheFiledOne() throws {
        let f = try fixture("clearances", as: ClearancesFixture.self)
        func compared(_ c: ClearancesFixture.Cleared) -> ClearanceCompare.Difference {
            ClearanceCompare.describe(plannedStops: c.planned.stops, plannedDest: c.planned.dest,
                                      clearedStops: c.route.stops, clearedDest: c.route.dest, typed: c.typed)
        }
        // "Gopher then as filed" over a filed GEP V2 FAR: the same route.
        #expect(compared(f.routes[0]) == ClearanceCompare.Difference(same: true, words: "The same route as you filed."))
        // A departure typed in, the points as filed.
        #expect(compared(f.routes[1]) == ClearanceCompare.Difference(same: false, words: "with the BUNYN1."))
        // Hibbing instead of Duluth, by way of the airway instead of BRD.
        #expect(compared(f.routes[2]) == ClearanceCompare.Difference(same: false, words: "to KHIB instead of KDLH; GEP V2 FGT PYKLA instead of BRD."))
        // Gopher before the filed BRD: one point added.
        #expect(compared(f.routes[3]) == ClearanceCompare.Difference(same: false, words: "adds GEP."))
    }

    @Test func theSamePointsInAnotherOrderAreSaidSo() {
        let d = ClearanceCompare.describe(plannedStops: ["GEP", "BRD"], plannedDest: "KDLH", clearedStops: ["BRD", "GEP"], clearedDest: "KDLH")
        #expect(d == ClearanceCompare.Difference(same: false, words: "the same points in another order."))
    }
}
