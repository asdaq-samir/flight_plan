import Foundation
import Observation

/// The Brief's Go / No-Go and what only the pilot can tell it: their
/// personal minimums and each airplane's loading, kept on this device as
/// the web app keeps them in the browser, and the risk assessment's own
/// checks, ticked for this session (they are about the pilot today, not
/// the route). The answer is the planner's (Planner.goNoGo); nothing here
/// judges the flight.
@MainActor
@Observable
final class Verdict {
    private(set) var minimums: PersonalMinimums
    /// Each airplane's load, by the planner's profile name.
    private(set) var loads: [String: AirplaneLoad]
    private(set) var ticked: Set<String> = []
    private(set) var answer: GoNoGoAnswer?
    private(set) var problem: String?
    private(set) var asking = false
    /// The pilot's currency from their logbook, fetched once signed in.
    private var currency: Currency?
    /// The pilot's own airplanes, for the one flown's records.
    private var records: [OwnAircraftRecord] = []
    private var currencyAsked = false
    private let store: UserDefaults

    static let minimumsKey = "goNoGo.minimums"
    static let loadsKey = "goNoGo.loads"

    init(store: UserDefaults = .standard) {
        self.store = store
        minimums = (store.data(forKey: Self.minimumsKey)).flatMap { try? JSONDecoder().decode(PersonalMinimums.self, from: $0) } ?? PersonalMinimums()
        loads = (store.data(forKey: Self.loadsKey)).flatMap { try? JSONDecoder().decode([String: AirplaneLoad].self, from: $0) } ?? [:]
    }

    func setMinimum(_ key: PersonalMinimums.Key, _ value: Double?) {
        minimums[key] = value
        if let data = try? JSONEncoder().encode(minimums) { store.set(data, forKey: Self.minimumsKey) }
    }

    func load(for aircraft: String) -> AirplaneLoad? { loads[aircraft] }

    func setLoad(_ load: AirplaneLoad, for aircraft: String) {
        loads[aircraft] = load
        if let data = try? JSONEncoder().encode(loads) { store.set(data, forKey: Self.loadsKey) }
    }

    func tick(_ key: String, _ on: Bool) {
        if on { ticked.insert(key) } else { ticked.remove(key) }
    }

    /// The question for the plan on the page: the route as its nav log
    /// was asked, and the pilot's own.
    func ask(for plan: Plan, today: Date = Date()) -> GoNoGoAsk {
        let figures = plan.figures
        return GoNoGoAsk(
            dep: plan.dep, dest: plan.dest, stops: plan.stops.joined(separator: ","), aircraft: plan.aircraft,
            altitudeFt: plan.ownAltitudeFt, altitudeNearest: plan.ownAltitudeFt != nil && plan.ownAltitudeLegal,
            altitudeChoice: plan.altitudeChoice ?? "fastest",
            procedures: plan.procedures.filter { plan.idents.contains($0.ident) }.map(\.param).joined(separator: ","),
            cruiseTasKt: figures.cruiseTasKt, fuelBurnGph: figures.fuelBurnGph, usableFuelGal: figures.usableFuelGal,
            cruisePowerPct: figures.cruisePowerPct, climbTasKt: figures.climbTasKt, climbFuelBurnGph: figures.climbFuelBurnGph,
            serviceCeilingFt: figures.serviceCeilingFt,
            day: GoNoGoAsk.day(today), minimums: minimums, load: loads[plan.aircraft], ticked: ticked.sorted(), currency: currency,
            ownAirplane: records.first { $0.tailNumber == plan.tail }.map(OwnAirplaneAsk.init))
    }

    /// Asks the planner again, once the nav log has come to an end, and
    /// whenever what the pilot set changes; a newer ask replaces an older.
    func refresh(plan: Plan, signedIn: Bool) async {
        guard plan.routed, plan.totals != nil || plan.problem != nil else { return }
        // A moment's pause, so a run of edits is one ask.
        try? await Task.sleep(for: .milliseconds(400))
        guard !Task.isCancelled else { return }
        if signedIn, !currencyAsked {
            currencyAsked = true
            currency = try? await Gateway.currency()
            records = (try? await Gateway.aircraftRecords()) ?? []
        }
        asking = true
        defer { asking = false }
        do {
            let answer = try await Planner.goNoGo(ask(for: plan))
            guard !Task.isCancelled else { return }
            self.answer = answer
            problem = nil
        } catch {
            guard !Task.isCancelled else { return }
            problem = error.localizedDescription
        }
    }

    /// What a new ask turns on: the plan's route and times, and every
    /// input of the pilot's.
    func key(for plan: Plan) -> String {
        let ask = ask(for: plan)
        let body = (try? Planner.snakeEncoder.encode(ask)).map { String(decoding: $0, as: UTF8.self) } ?? ""
        return "\(body)|\(plan.plannedAt?.timeIntervalSince1970 ?? 0)|\(plan.problem?.detail ?? "")"
    }
}
