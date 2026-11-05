import Foundation

/// An ATC clearance as the phone heard it, read into its items by the
/// engine (wingtip_engine::clearance, `read_clearance`) -- the web app's
/// lib/clearance, both held to the same fixture (clearances.json, the
/// engine's tests/clearance.rs and SharedFixturesTests): its limit, its
/// departure procedure, the route, the altitudes, the frequency and the
/// beacon code, as AIM 4-4-3 lists what a clearance holds. The places it
/// names are found by the planner (/api/clearance/places, wingtip.spoken), or
/// with no signal by the engine in the kept packs, and the route goes in
/// only from the sheet, the pilot having read it (ClearanceSheet).
struct Clearance: Codable, Equatable, Sendable {
    /// The clearance limit as said ("duluth airport").
    var limit: String?
    var route: [ClearedItem] = []
    /// "...then as filed" (AIM 5-2-6): the filed route after what was
    /// said, which leaves out the filed altitude.
    var asFiled = false
    var maintainFt: Int?
    /// "at or below" or "at or above".
    var maintainLimit: String?
    var vfr = false
    var expectFt: Int?
    /// Minutes after departure the expected altitude comes.
    var expectMin: Int?
    var frequency: String?
    /// Whose frequency: "departure", "center", "approach".
    var facility: String?
    var squawk: String?
    /// "Cleared into the Class Bravo airspace" (14 CFR 91.131(a)(1)).
    var classB = false

    /// Whether anything of a clearance was heard at all.
    var heardAny: Bool {
        limit != nil || !route.isEmpty || asFiled || maintainFt != nil || expectFt != nil || frequency != nil || squawk != nil || classB
    }
}

/// A part of the route, in the order it was said: "vectors", "heading",
/// "airway", "departure", "arrival", or "places" (words naming one place
/// or more, for the planner to find).
struct ClearedItem: Codable, Equatable, Sendable {
    var kind: String
    var degrees: Int?
    var ident: String?
    var name: String?
    var number: String?
    var transition: String?
    var said: String?
}

extension Clearance {
    /// The clearance in what was heard, read by the engine
    /// (`read_clearance`, the web's lib/clearance), with no signal
    /// needed; nothing heard where the engine cannot answer.
    static func read(_ text: String) -> Clearance {
        let read: Clearance? = try? Engine.call("read_clearance", ["text": text])
        return read ?? Clearance()
    }
}

/// What the planner found of a clearance's places (ClearancePlaces).
struct ClearancePlaces: Codable, Equatable, Sendable {
    struct Place: Codable, Equatable, Sendable {
        var said: String
        var ident: String?
        var name: String?
        var kind: String?
        var sure: Bool?
    }
    struct Procedure: Codable, Equatable, Sendable {
        var id: String
        var transition: String?
    }
    var limit: Place?
    var route: [[Place]]?
    var departure: Procedure?
    var arrival: Procedure?
}

/// What the planner is asked to find (ClearanceAsk).
struct ClearanceAsk: Encodable, Sendable {
    struct Procedure: Encodable, Sendable { let name: String; let number: String; let transition: String? }
    var near = ""
    var dep: String?
    var dest: String?
    var limit: String?
    var route: [String] = []
    var departure: Procedure?
    var arrival: Procedure?
}

extension Clearance {
    /// The planner's question for the clearance's places.
    func asked(near: String, dep: String, dest: String) -> ClearanceAsk {
        func named(_ kind: String) -> ClearanceAsk.Procedure? {
            route.first { $0.kind == kind }.map { ClearanceAsk.Procedure(name: $0.name ?? "", number: $0.number ?? "", transition: $0.transition) }
        }
        return ClearanceAsk(near: near, dep: dep.isEmpty ? nil : dep, dest: dest.isEmpty ? nil : dest, limit: limit,
                            route: route.compactMap { $0.kind == "places" ? $0.said : nil },
                            departure: named("departure"), arrival: named("arrival"))
    }

    /// A procedure to pick, as the web's typed one: its name and the
    /// points either side of it.
    struct Typed: Codable, Equatable, Sendable {
        let name: String
        let before: String?
        let after: String?
    }

    /// The route a clearance heard gives, from the one planned: its
    /// destination the limit where that is an airport; its stops the
    /// places and airways said in order, the SID's transition after the
    /// departure and the STAR's before the destination; with "then as
    /// filed" the filed stops after the last one said that is among them,
    /// or all of them where none is (AIM 5-2-6). The engine's
    /// `cleared_route`, the web's clearedRoute, from the words heard and
    /// the places found for them; the route as planned where the engine
    /// cannot answer.
    static func clearedRoute(_ heard: String, _ found: ClearancePlaces, dep: String, stops planned: [String],
                             dest plannedDest: String) -> (dep: String, stops: [String], dest: String, typed: [Typed]) {
        struct Planned: Codable { let dep: String; let stops: [String]; let dest: String }
        struct Ask: Encodable { let text: String; let found: ClearancePlaces; let planned: Planned }
        struct Answer: Decodable { let route: Planned; let typed: [Typed] }
        let ask = Ask(text: heard, found: found, planned: Planned(dep: dep, stops: planned, dest: plannedDest))
        guard let answer: Answer = try? Engine.call("cleared_route", ask) else { return (dep, planned, plannedDest, []) }
        return (answer.route.dep, answer.route.stops, answer.route.dest, answer.typed)
    }
}
