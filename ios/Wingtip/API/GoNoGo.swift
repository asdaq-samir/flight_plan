import Foundation

/// The Brief's Go / No-Go as the planner works it out (POST
/// /api/go-no-go, app.gonogo): the web app's lib/verdict rules on the
/// planner, so the phone shows the answer and computes none of it. The
/// question is the route as the nav log was asked it and what only the
/// pilot knows; the answer is each finding, the line over them, and the
/// risk assessment and weight and balance the Brief's own pages show.

/// The pilot's personal minimums (app.gonogo.schemas.PersonalMinimums,
/// the web's lib/minimums): each nil, Off, until picked.
struct PersonalMinimums: Codable, Equatable, Sendable {
    var ceilingFt: Double?
    var visibilitySm: Double?
    var crosswindKt: Double?
    var windKt: Double?

    /// One minimum by its key, for the menus.
    enum Key: String, CaseIterable, Identifiable, Sendable {
        case ceilingFt, visibilitySm, crosswindKt, windKt
        var id: String { rawValue }

        /// Its row's title, as the web's MinimumsPanel names it.
        var title: String {
            switch self {
            case .ceilingFt: "Ceiling"
            case .visibilitySm: "Visibility"
            case .crosswindKt: "Crosswind"
            case .windKt: "Wind, with gusts"
            }
        }

        /// The choices it is picked from, the web's MINIMUM_CHOICES and the
        /// planner's (app.gonogo.minimums): menus, not sliders.
        var choices: [Double] {
            switch self {
            case .ceilingFt: [1000, 1500, 2000, 2500, 3000, 4000, 5000]
            case .visibilitySm: [3, 4, 5, 6, 8, 10]
            case .crosswindKt: [5, 8, 10, 12, 15, 17, 20]
            case .windKt: [10, 15, 20, 25, 30, 35]
            }
        }

        /// A choice as its menu reads: "1,500 ft", "5 sm", "12 kt".
        func words(_ value: Double) -> String {
            let n = Int(value.rounded())
            switch self {
            case .ceilingFt: return "\(AirportWords.grouped(value)) ft"
            case .visibilitySm: return "\(n) sm"
            case .crosswindKt, .windKt: return "\(n) kt"
            }
        }
    }

    subscript(key: Key) -> Double? {
        get {
            switch key {
            case .ceilingFt: ceilingFt
            case .visibilitySm: visibilitySm
            case .crosswindKt: crosswindKt
            case .windKt: windKt
            }
        }
        set {
            switch key {
            case .ceilingFt: ceilingFt = newValue
            case .visibilitySm: visibilitySm = newValue
            case .crosswindKt: crosswindKt = newValue
            case .windKt: windKt = newValue
            }
        }
    }
}

/// What the pilot loads (AirplaneLoad): the airplane's own empty weight
/// and arm, each station's pounds in the loading's order, and the fuel
/// at the start, gallons.
struct AirplaneLoad: Codable, Equatable, Sendable {
    var emptyWeightLb: Double
    var emptyArmIn: Double
    var stationsLb: [Double]
    var fuelGal: Double
}

/// POST /api/go-no-go's question (GoNoGoAsk), encoded in snake case:
/// the route as the nav log was asked it, then the pilot's own.
struct GoNoGoAsk: Encodable, Equatable, Sendable {
    var dep: String
    var dest: String
    var stops: String = ""
    var aircraft: String
    var altitudeFt: Double?
    var altitudeNearest = false
    var altitudeChoice = "fastest"
    var procedures = ""
    var cruiseTasKt: Double?
    var fuelBurnGph: Double?
    var usableFuelGal: Double?
    var cruisePowerPct: Double?
    var climbTasKt: Double?
    var climbFuelBurnGph: Double?
    var serviceCeilingFt: Double?
    /// The flight's day where the pilot is, "yyyy-MM-dd": the logbook's
    /// dates are read on it.
    var day: String
    var minimums = PersonalMinimums()
    var load: AirplaneLoad?
    var ticked: [String] = []
    var currency: Currency?
    /// The pilot's own airplane's records, for the risk assessment's
    /// airworthiness checks; none for a stock profile.
    var ownAirplane: OwnAirplaneAsk?
}

/// The planner's OwnAirplane: the gateway's records of the airplane
/// flown, in the planner's names. The gateway works out each good-through
/// day (14 CFR 91.409, 91.411, 91.413, 91.207, 91.171); this only carries
/// them over.
struct OwnAirplaneAsk: Encodable, Equatable, Sendable {
    struct Due: Encodable, Equatable, Sendable {
        var annualGoodThrough: String?
        var staticCheckGoodThrough: String?
        var transponderCheckGoodThrough: String?
        var eltInspectionGoodThrough: String?
        var eltBatteryDueOn: String?
        var hoursNow: Double?
        var hundredHourDueAtHours: Double?
    }
    struct Open: Encodable, Equatable, Sendable {
        var text: String
        var inoperative: Bool
        var deferredFor: String?
    }
    struct Vor: Encodable, Equatable, Sendable {
        var goodThrough: String
        var withinLimit: Bool
    }

    var inspections: Due?
    var squawks: [Open] = []
    var vorCheck: Vor?

    init(_ record: OwnAircraftRecord) {
        inspections = record.inspections.map {
            Due(annualGoodThrough: $0.annualGoodThrough, staticCheckGoodThrough: $0.staticCheckGoodThrough,
                transponderCheckGoodThrough: $0.transponderCheckGoodThrough, eltInspectionGoodThrough: $0.eltInspectionGoodThrough,
                eltBatteryDueOn: $0.eltBatteryDueOn, hoursNow: $0.hoursNow, hundredHourDueAtHours: $0.hundredHourDueAtHours)
        }
        // Only the squawks still open: a fixed one grounds nothing.
        squawks = (record.openSquawks ?? []).filter { $0.fixedOn == nil }.map { Open(text: $0.text, inoperative: $0.inoperative, deferredFor: $0.deferredFor) }
        vorCheck = record.vorCheck.map { Vor(goodThrough: $0.goodThrough, withinLimit: $0.withinLimit) }
    }
}

/// What the findings come to, in a line (VerdictLine).
struct VerdictLine: Codable, Equatable, Sendable {
    let finding: String
    let words: String
}

/// One finding (VerdictItem): the weather, the TFRs and special use, the
/// altitude, the fuel, the runways, the weight and balance or the risk,
/// and where the web app says it in full.
struct VerdictItem: Codable, Equatable, Sendable, Identifiable {
    let key: String
    let label: String
    let finding: String
    let detail: String
    let tab: String
    var section: String?

    var id: String { key }
}

/// What raised the risk (RiskFactor), with its mark.
struct RiskFactor: Codable, Equatable, Sendable, Identifiable {
    let key: String
    let label: String
    var why: String?
    let points: Int
    var stop: Bool?
    var finding: String?

    var id: String { key }
    /// What it adds, as the web's row says it: "No-go" or "+3".
    var value: String { stop == true ? "No-go" : "+\(points)" }
}

/// A check only the pilot can answer (RiskCheck), in its group.
struct RiskCheck: Codable, Equatable, Sendable, Identifiable {
    let key: String
    let group: String
    let label: String
    var why: String?
    let points: Int
    var stop: Bool?

    var id: String { key }
    var value: String { stop == true ? "No-go" : "+\(points)" }
}

/// The risk assessment (RiskAssessment): its line, what to do at its
/// level, and every factor counted.
struct RiskAssessment: Codable, Equatable, Sendable {
    let score: Int
    let level: String
    let line: String
    let words: String
    var factors: [RiskFactor]?
}

/// One of the loading's stations (LoadingStation).
struct LoadingStation: Codable, Equatable, Sendable {
    let name: String
    let armIn: Double
    var maxLb: Double?
}

/// The airplane's POH loading (Loading), the parts the Loading page asks
/// for.
struct PohLoading: Codable, Equatable, Sendable {
    var source: String?
    let stations: [LoadingStation]
    let fuelMaxGal: Double
}

struct LoadCondition: Codable, Equatable, Sendable {
    let weightLb: Double
    let armIn: Double

    /// "2,407 lb · 41.2 in", as the web's Balance rows.
    var words: String {
        "\(AirportWords.grouped(weightLb)) lb · \(String(format: "%.1f", armIn)) in"
    }
}

/// The weight and balance worked out for the load used (LoadBalance).
struct LoadBalance: Codable, Equatable, Sendable {
    let load: AirplaneLoad
    let takeoff: LoadCondition
    let landing: LoadCondition
    var problems: [String]?
}

/// POST /api/go-no-go's answer (GoNoGo).
struct GoNoGoAnswer: Codable, Equatable, Sendable {
    let line: VerdictLine
    let items: [VerdictItem]
    var risk: RiskAssessment?
    var selfChecks: [RiskCheck]?
    var loading: PohLoading?
    var balance: LoadBalance?
}

extension Planner {
    /// The Go / No-Go for the route (POST /api/go-no-go).
    static func goNoGo(_ ask: GoNoGoAsk) async throws -> GoNoGoAnswer {
        try await postRead(GoNoGoAnswer.self, "/api/go-no-go", ask)
    }
}
