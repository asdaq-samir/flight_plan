import Foundation
import Testing
@testable import Wingtip

/// The engine through its C functions (Engine, native/ffi), on the
/// Chicago cut's phone packs: at each real tap -- O'Hare, KDPA, Midway and
/// its shelf, Wheeling under O'Hare's shelf -- the planner's own answer,
/// band for band (tests/fixtures/native/phone, bundled by project.yml;
/// tests/test_phone_pack.py holds the same files to the planner's code).
private final class PackBundle {}

private struct Missing: Error { let name: String }

private func resource(_ name: String, _ ext: String) throws -> Data {
    guard let url = Bundle(for: PackBundle.self).url(forResource: name, withExtension: ext) else { throw Missing(name: "\(name).\(ext)") }
    return try Data(contentsOf: url, options: .alwaysMapped)
}

struct CyclePackTests {
    @Test func theRealTapsAreThePlannersAnswer() throws {
        let expected = try Planner.snakeCase.decode([String: AirspaceAt].self, from: try resource("chicago_airspace_at", "json"))
        #expect(expected.count >= 5)
        for (name, want) in expected {
            let pack = try resource(Engine.region(lat: want.lat, lon: want.lon), "pack")
            #expect(Engine.verify(pack), "\(name)")
            let got = Engine.airspaceAt(pack: pack, lat: want.lat, lon: want.lon)
            #expect(got == want, "\(name)")
        }
    }

    @Test func oHareIsClassBInItsVeil() throws {
        let pack = try resource(Engine.region(lat: 41.9786, lon: -87.9048), "pack")
        let here = try #require(Engine.airspaceAt(pack: pack, lat: 41.9786, lon: -87.9048))
        #expect(here.bands.first?.airspaceClass == "B")
        #expect(here.modeCVeil?.ident == "KORD")
        // What only the planner can say is said to be missing, not none.
        #expect(here.tfrsUnavailable == true)
        #expect(here.groundFt == nil && here.point == nil)
    }

    @Test func aRegionWithNoPackHasTheRulesAlone() throws {
        let here = try #require(Engine.airspaceAt(pack: nil, lat: 30, lon: -140))
        #expect(here.bands.map(\.airspaceClass) == ["G", "G", "G", "E", "A"])
        #expect(here.modeCVeil == nil && (here.specialUse ?? []).isEmpty)
    }

    @Test func regionsAreNamedAsThePlannerNamesThem() {
        #expect(Engine.region(lat: 41.9786, lon: -87.9048) == "n40w088")
        #expect(Engine.region(lat: 41.9, lon: -88.25) == "n40w092")
        #expect(Engine.region(lat: -0.5, lon: 0.5) == "s04e000")
        #expect(!Engine.verify(Data("not a pack".utf8)))
    }
}
