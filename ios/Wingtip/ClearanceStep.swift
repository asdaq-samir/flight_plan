import Foundation

/// The clearance step's two checks, each a plain function on what the
/// engine says, so the sheet (ClearanceSheet) lays them out and nothing
/// is judged in a view: the pilot's read back held against the clearance
/// heard, and the route cleared held against the one filed.

/// The pilot's read back checked against the clearance (AIM 4-4-7 b:
/// the altitudes, the vectors and the runways are read back, and 4-4-7
/// b.3 the altimeter, the frequencies and the codes) by the engine's
/// `readback_check`, the web's lib/readback, both held to the shared
/// fixture (readbacks.json): what was missed or said differently, and
/// the engine's line for it.
struct ReadbackCheck: Decodable, Equatable, Sendable {
    struct Item: Decodable, Equatable, Sendable, Identifiable {
        /// "limit", "route", "altitude", "expect", "frequency" or "squawk".
        let item: String
        let cleared: String
        /// What the read back had for it; nil where it was not read back.
        let said: String?
        var id: String { item + cleared }
    }
    var items: [Item] = []
    var words = ""

    /// The read back `said` against the clearance `cleared`, both as
    /// heard; nil where the engine cannot answer.
    static func check(cleared: String, said: String) -> ReadbackCheck? {
        try? Engine.call("readback_check", ["cleared": cleared, "said": said])
    }

    /// The parts of a clearance in the order they are read back, with each
    /// one's name on the screen.
    static let parts: [(item: String, name: String)] = [
        ("limit", "limit"), ("route", "route"), ("altitude", "altitude"), ("expect", "expected altitude"),
        ("frequency", "frequency"), ("squawk", "squawk"),
    ]

    /// The parts a clearance has, for the tick to name.
    static func parts(of clearance: Clearance) -> [String] {
        var has: [String] = []
        if clearance.limit != nil || clearance.classB { has.append("limit") }
        if !clearance.route.isEmpty || clearance.asFiled { has.append("route") }
        if clearance.maintainFt != nil { has.append("altitude") }
        if clearance.expectFt != nil { has.append("expect") }
        if clearance.frequency != nil { has.append("frequency") }
        if clearance.squawk != nil { has.append("squawk") }
        return has
    }

    /// One line under the read back: a tick for what was read back, a
    /// mark for each part missed or said differently.
    struct Line: Equatable, Identifiable, Sendable {
        let ok: Bool
        let words: String
        var id: String { words }
    }

    /// The lines for a read back of `clearance`: the parts read back in
    /// one tick ("Limit, route and squawk read back"), then one line for
    /// each part missed ("Squawk 4512 not read back") or said differently
    /// ("Altitude: 4,000 ft said, 5,000 ft cleared").
    static func lines(_ clearance: Clearance, _ check: ReadbackCheck) -> [Line] {
        let missed = Set(check.items.map(\.item))
        let read = parts.filter { parts(of: clearance).contains($0.item) && !missed.contains($0.item) }.map(\.name)
        var lines: [Line] = []
        if !read.isEmpty {
            let list = read.count == 1 ? read[0] : read.dropLast().joined(separator: ", ") + " and " + read.last!
            lines.append(Line(ok: true, words: list.prefix(1).uppercased() + list.dropFirst() + " read back"))
        }
        for item in check.items {
            let name = parts.first { $0.item == item.item }?.name ?? item.item
            let named = name.prefix(1).uppercased() + name.dropFirst()
            if let said = item.said {
                lines.append(Line(ok: false, words: "\(named): \(said) said, \(item.cleared) cleared"))
            } else {
                lines.append(Line(ok: false, words: "\(named) \(item.cleared) not read back"))
            }
        }
        return lines
    }
}

/// The route cleared against the one filed: only the points that differ,
/// since the cleared points are idents the phone has no positions for
/// until they are planned, so the extra miles and minutes would want the
/// planner, and the step is read before the route goes in.
enum ClearanceCompare {
    struct Difference: Equatable, Sendable {
        let same: Bool
        /// What differs, for after "Differs from what you filed:", or the
        /// line that nothing does.
        let words: String
    }

    static func describe(plannedStops: [String], plannedDest: String, clearedStops: [String], clearedDest: String,
                         typed: [Clearance.Typed] = []) -> Difference {
        var parts: [String] = []
        if clearedDest != plannedDest, !clearedDest.isEmpty {
            parts.append(plannedDest.isEmpty ? "to \(clearedDest)" : "to \(clearedDest) instead of \(plannedDest)")
        }
        let added = clearedStops.filter { !plannedStops.contains($0) }
        let dropped = plannedStops.filter { !clearedStops.contains($0) }
        switch (added.isEmpty, dropped.isEmpty) {
        case (false, false): parts.append("\(added.joined(separator: " ")) instead of \(dropped.joined(separator: " "))")
        case (false, true): parts.append("adds \(added.joined(separator: " "))")
        case (true, false): parts.append("leaves out \(dropped.joined(separator: " "))")
        case (true, true):
            if clearedStops != plannedStops, parts.isEmpty { parts.append("the same points in another order") }
        }
        if !typed.isEmpty { parts.append("with the \(typed.map(\.name).joined(separator: " and "))") }
        guard !parts.isEmpty else { return Difference(same: true, words: "The same route as you filed.") }
        return Difference(same: false, words: parts.joined(separator: "; ") + ".")
    }
}
