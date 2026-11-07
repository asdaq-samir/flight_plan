import Foundation
import Testing
@testable import Wingtip

/// The engine through this app's own bridge (Engine.callText: the input
/// written by Engine.written, wt_call, the answer taken back as a Swift
/// string) held to the shared fixtures the engine's Rust tests
/// (native/engine/tests) and the web's vitest tests (through the .wasm)
/// hold it to: web/src/lib/fixtures, bundled into this target in place by
/// project.yml. The Rust and web tests never pass through this bridge, so
/// a bridge that changed a key's case, wrote a number as a string, dropped
/// a null or broke a character outside ASCII would leave them green; here
/// it fails. The answer is compared as the JSON it is, before any decoder
/// of the app's reads it (android's EngineFixturesTest is the twin).
///
/// Each fixture is asked by the rule names the phones call: read_atis,
/// checklist_read and checklist_write, read_clearance, cleared_route,
/// our_call, direct_of, hold_read, hold_write, holding_leg_minutes,
/// logbook_csv_read and logbook_csv_write, readback_check, traffic_marks,
/// and the flight's figures by the names the engine answers them by:
/// wind_triangle, gonogo_density_altitude, magnetic_variation and
/// weather_in_force.
private final class BridgeFixtureBundle {}

private struct BridgeFixtureMissing: Error { let name: String }

private func fixture(_ name: String) throws -> [String: Any] {
    guard let url = Bundle(for: BridgeFixtureBundle.self).url(forResource: name, withExtension: "json"),
          let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
    else { throw BridgeFixtureMissing(name: name) }
    return object
}

/// The rule's answer through the bridge, parsed as JSON: a bare string,
/// number, true or false or null included.
private func ask(_ name: String, _ input: [String: Any?]) throws -> Any {
    let text = try Engine.callText(name, input)
    return try JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed)
}

/// Numbers as close as the Rust and web fixture tests hold them: they
/// compare exactly, the wind triangle's to nine places
/// (flight_rules.rs, flightRules.test.ts); a number that went through text
/// and back is allowed that much.
private let tolerance = 1e-9

private func isBool(_ n: NSNumber) -> Bool { CFGetTypeID(n as CFTypeRef) == CFBooleanGetTypeID() }

/// The first place `got` is not `want`, or nil where they are the same
/// JSON: the same keys (a null is not a key left out), the same order in a
/// list, strings exactly, true and false as themselves and never 1 and 0.
private func difference(_ got: Any?, _ want: Any?, _ path: String = "$") -> String? {
    let got: Any? = got is NSNull ? nil : got
    let want: Any? = want is NSNull ? nil : want
    guard let got, let want else {
        return got == nil && want == nil ? nil : "\(path): \(String(describing: got ?? "null")) is not \(String(describing: want ?? "null"))"
    }
    if let g = got as? String, let w = want as? String {
        return g == w ? nil : "\(path): \"\(g)\" is not \"\(w)\""
    }
    if let g = got as? NSNumber, let w = want as? NSNumber {
        if isBool(g) != isBool(w) { return "\(path): \(g) and \(w) are not both true or false" }
        if isBool(g) { return g.boolValue == w.boolValue ? nil : "\(path): \(g.boolValue) is not \(w.boolValue)" }
        return abs(g.doubleValue - w.doubleValue) <= tolerance ? nil : "\(path): \(g) is not \(w)"
    }
    if let g = got as? [Any], let w = want as? [Any] {
        if g.count != w.count { return "\(path): \(g.count) items, not \(w.count)" }
        for (i, (a, b)) in zip(g, w).enumerated() {
            if let d = difference(a, b, "\(path)[\(i)]") { return d }
        }
        return nil
    }
    if let g = got as? [String: Any], let w = want as? [String: Any] {
        let gk = Set(g.keys), wk = Set(w.keys)
        if gk != wk { return "\(path): keys \(gk.subtracting(wk).sorted()) not wanted, \(wk.subtracting(gk).sorted()) missing" }
        for k in wk.sorted() {
            if let d = difference(g[k], w[k], "\(path).\(k)") { return d }
        }
        return nil
    }
    return "\(path): \(got) is not \(want)"
}

/// Records a difference as an issue named by its case.
private func check(_ got: Any?, _ want: Any?, _ what: String) {
    if let d = difference(got, want) { Issue.record("\(what): \(d)") }
}

private func cases(_ f: [String: Any], _ key: String) -> [[String: Any]] {
    f[key] as? [[String: Any]] ?? []
}

@MainActor
struct BridgeFixturesTests {
    @Test func anAtisReadsThroughTheBridgeAsInTheFixture() throws {
        let all = try cases(fixture("atis"), "cases")
        #expect(all.count >= 12)
        for c in all {
            try check(ask("read_atis", ["text": c["heard"]]), c["reading"], "\(c["name"] ?? "")")
        }
    }

    @Test func aChecklistReadsAndWritesThroughTheBridge() throws {
        let all = try cases(fixture("checklist"), "cases")
        #expect(!all.isEmpty)
        for (i, c) in all.enumerated() {
            try check(ask("checklist_read", ["text": c["text"]]), c["checklist"], "case \(i), read")
            try check(ask("checklist_write", ["checklist": c["checklist"]]), c["written"], "case \(i), written")
        }
    }

    @Test func aClearanceAndTheRouteItGivesReadThroughTheBridge() throws {
        let f = try fixture("clearances")
        let read = cases(f, "read"), routes = cases(f, "routes")
        #expect(!read.isEmpty && !routes.isEmpty)
        for c in read {
            try check(ask("read_clearance", ["text": c["heard"]]), c["clearance"], "\(c["heard"] ?? "")")
        }
        for c in routes {
            let got = try ask("cleared_route", ["text": c["heard"], "found": c["found"], "planned": c["planned"]])
            check(got, ["route": c["route"] as Any, "typed": c["typed"] as Any], "\(c["heard"] ?? "")")
        }
    }

    @Test func aCallToUsIsHeardThroughTheBridge() throws {
        let f = try fixture("heardCalls")
        let all = cases(f, "cases")
        #expect(!all.isEmpty)
        for c in all {
            let heard = "\(c["heard"] ?? "")"
            try check(ask("our_call", ["text": c["heard"], "tail": f["tail"]]), c["forUs"], "\(heard), for us")
            try check(ask("direct_of", ["text": c["heard"]]), c["direct"], "\(heard), direct")
            // The web's maintainFt is read from the whole clearance, where
            // one with none leaves it null.
            let clearance = try ask("read_clearance", ["text": c["heard"]]) as? [String: Any]
            check(clearance?["maintainFt"], c["maintainFt"], "\(heard), maintain")
        }
    }

    @Test func aHoldReadsAndWritesThroughTheBridge() throws {
        let f = try fixture("holds")
        let all = cases(f, "parse")
        #expect(all.count >= 5)
        // The engine's hold is snake_case, the fixture's camelCase; a
        // member it leaves out is null, as route.rs compares them.
        let keys = [("fix", "fix"), ("inbound", "inbound"), ("right", "right"), ("leg_min", "legMin"),
                    ("leg_nm", "legNm"), ("turns", "turns"), ("minutes", "minutes")]
        for c in all {
            let text = "\(c["text"] ?? "")"
            let read = try ask("hold_read", ["text": c["text"]])
            guard let want = c["hold"] as? [String: Any] else {
                check(read, NSNull(), "\(text) read")
                continue
            }
            guard let hold = read as? [String: Any] else {
                Issue.record("\(text): read as \(read), not a hold")
                continue
            }
            for (ours, theirs) in keys { check(hold[ours], want[theirs], "\(text) read, \(ours)") }
            try check(ask("hold_write", ["hold": hold]), c["written"], "\(text) written")
        }
        for c in cases(f, "legMinutes") {
            try check(ask("holding_leg_minutes", ["altitude_ft": c["altitudeFt"]]), c["minutes"], "legs at \(c["altitudeFt"] ?? "") ft")
        }
    }

    @Test func theLogbookIsWrittenAndReadThroughTheBridge() throws {
        let f = try fixture("logbookCsv")
        let exports = cases(f, "export"), imports = cases(f, "import")
        #expect(!exports.isEmpty && !imports.isEmpty)
        for (i, c) in exports.enumerated() {
            try check(ask("logbook_csv_write", ["entries": c["entries"]]), c["csv"], "written out, case \(i)")
        }
        for c in imports {
            let want: [String: Any] = ["entries": c["entries"] as Any, "skipped": c["skipped"] as Any]
            try check(ask("logbook_csv_read", ["text": c["text"]]), want, "\(c["name"] ?? "")")
        }
    }

    @Test func aReadbackIsCheckedThroughTheBridge() throws {
        let f = try fixture("readbacks")
        let all = cases(f, "cases")
        #expect(!all.isEmpty)
        for c in all {
            let got = try ask("readback_check", ["cleared": f["cleared"], "said": c["said"]]) as? [String: Any]
            check(got?["items"], c["items"], "\(c["name"] ?? ""), items")
            check(got?["words"], c["words"], "\(c["name"] ?? ""), words")
        }
        let level = f["flightLevel"] as? [String: Any] ?? [:]
        for c in cases(level, "cases") {
            let got = try ask("readback_check", ["cleared": level["cleared"], "said": c["said"]]) as? [String: Any]
            check(got?["items"], c["items"], "\(c["said"] ?? ""), items")
        }
    }

    @Test func trafficIsMarkedThroughTheBridge() throws {
        let all = try cases(fixture("traffic"), "cases")
        #expect(all.count >= 20)
        for c in all {
            let got = try ask("traffic_marks", ["own_ft": c["ownFt"], "planes": [c["plane"] as Any]])
            check(got, [["label": c["label"] as Any, "near": c["near"] as Any]], "\(c["plane"] ?? "") against \(c["ownFt"] ?? "none")")
        }
    }

    /// The flight's figures in flightRules.json. The fixture's cruising
    /// altitudes (14 CFR 91.159) and reserves (91.151, 91.167) have no name
    /// of their own in wt_call, since no phone asks them alone; the engine's
    /// flight_rules.rs and the planner's test_flight_rules.py hold those.
    @Test func theFlightsFiguresAreWorkedThroughTheBridge() throws {
        let f = try fixture("flightRules")
        let winds = cases(f, "windTriangle")
        #expect(winds.count >= 10)
        for c in winds {
            let got = try ask("wind_triangle", ["tc": c["tc"], "tas": c["tas"], "wind_from_deg": c["windFrom"], "wind_kt": c["windKt"]])
            check(got, c["expected"], "the wind triangle at \(c["tc"] ?? "")° with \(c["windKt"] ?? "") kt from \(c["windFrom"] ?? "")°")
        }
        // Density altitude to a millionth of a foot, as flight_rules.rs
        // holds it: the fixture's last places are the planner's Python's.
        for c in cases(f, "densityAltitude") {
            let got = try ask("gonogo_density_altitude", ["pressure_alt_ft": c["pressureAltitudeFt"], "temp_c": c["oatC"]]) as? NSNumber
            let want = (c["densityAltitudeFt"] as? NSNumber)?.doubleValue ?? .nan
            #expect(abs((got?.doubleValue ?? .nan) - want) < 1e-6, "density altitude at \(c["pressureAltitudeFt"] ?? "") ft, \(c["oatC"] ?? "") °C")
        }
        // magnetic_variation takes a date, so only the fixture's whole
        // years (1 January, decimal year exactly the year) can be asked.
        let years = cases(f, "declination").filter { ($0["year"] as? Double).map { $0 == $0.rounded() } ?? false }
        #expect(years.count >= 3)
        for c in years {
            let year = Int((c["year"] as? Double) ?? 0)
            try check(ask("magnetic_variation", ["lat": c["lat"], "lon": c["lon"], "date": "\(year)-01-01"]), c["deg"],
                      "variation at \(c["lat"] ?? ""), \(c["lon"] ?? "") in \(year)")
        }
        for c in cases(f, "weatherInForce") {
            let got = try ask("weather_in_force", ["product": c["product"], "now": c["now"], "observed": c["observed"],
                                                   "last_routine": c["lastRoutine"], "valid_from": c["validFrom"], "valid_to": c["validTo"]])
            check(got, c["inForce"], "\(c["why"] ?? "")")
        }
    }
}
