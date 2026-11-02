import Foundation
import Testing
@testable import Wingtip

/// The engine's flight figures through its C functions (FlightRules), held
/// to the fixture the planner, the web and the engine are held to
/// (web/src/lib/fixtures/flightRules.json, bundled by project.yml).
private final class RulesBundle {}

private struct Fixture: Decodable {
    struct Wind: Decodable {
        struct Want: Decodable { let wca: Double; let th: Double; let gs: Double }
        let tc: Double; let tas: Double; let windFrom: Double; let windKt: Double; let expected: Want?
    }
    struct Altitude: Decodable { let floorFt: Double; let courseDeg: Double; let altitudeFt: Double }
    struct Reserve: Decodable { let ifr: Bool; let night: Bool; let minutes: Double }
    struct Density: Decodable { let pressureAltitudeFt: Double; let oatC: Double; let densityAltitudeFt: Double }
    struct Variation: Decodable { let lat: Double; let lon: Double; let year: Double; let deg: Double }
    struct Weather: Decodable {
        let why: String; let product: String; let now: Int64
        let observed: Int64?; let lastRoutine: Int64?; let validFrom: Int64?; let validTo: Int64?; let inForce: Bool
    }
    let windTriangle: [Wind]
    let cruisingAltitude: [Altitude]
    let reserve: [Reserve]
    let densityAltitude: [Density]
    let declination: [Variation]
    let weatherInForce: [Weather]
}

private func load() throws -> Fixture {
    let url = try #require(Bundle(for: RulesBundle.self).url(forResource: "flightRules", withExtension: "json"))
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
}

struct FlightRulesTests {
    @Test func theWindTriangle() throws {
        for c in try load().windTriangle {
            let got = FlightRules.windTriangle(trueCourseDeg: c.tc, tasKt: c.tas, windFromDeg: c.windFrom, windKt: c.windKt)
            guard let want = c.expected else { #expect(got == nil); continue }
            let g = try #require(got)
            #expect(abs(g.wcaDeg - want.wca) < 1e-9 && abs(g.headingDeg - want.th) < 1e-9 && abs(g.groundspeedKt - want.gs) < 1e-9)
        }
    }

    @Test func altitudesReservesAndTheAir() throws {
        let f = try load()
        for c in f.cruisingAltitude {
            #expect(FlightRules.lowestVfrAltitude(floorFt: c.floorFt, magneticCourseDeg: c.courseDeg) == c.altitudeFt)
        }
        for c in f.reserve { #expect(FlightRules.reserveMinutes(ifr: c.ifr, night: c.night) == c.minutes) }
        for c in f.densityAltitude {
            #expect(abs(FlightRules.densityAltitudeFt(pressureAltitudeFt: c.pressureAltitudeFt, oatC: c.oatC) - c.densityAltitudeFt) < 1e-6)
        }
    }

    @Test func variationAndOfflineWeather() throws {
        let f = try load()
        for c in f.declination { #expect(abs(FlightRules.declination(lat: c.lat, lon: c.lon, year: c.year) - c.deg) < 1e-9) }
        let kinds: [String: FlightRules.Product] = ["metar": .metar, "speci": .speci, "taf": .taf, "winds": .winds, "advisory": .advisory]
        for c in f.weatherInForce {
            let got = FlightRules.inForce(try #require(kinds[c.product]), now: c.now, observed: c.observed, lastRoutine: c.lastRoutine,
                                          validFrom: c.validFrom, validTo: c.validTo)
            #expect(got == c.inForce, "\(c.why)")
        }
    }
}
