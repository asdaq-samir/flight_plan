import SwiftUI

/// A finding's mark and colour, the one scale the Brief says every check
/// on (the web's lib/status): nothing against it, something to look at,
/// something to fix before the flight goes as planned, not worked out,
/// or still being worked out.
enum FindingStyle {
    static func symbol(_ finding: String) -> String {
        switch finding {
        case "ok": "checkmark.circle.fill"
        case "caution": "exclamationmark.triangle.fill"
        case "stop": "xmark.octagon.fill"
        case "pending": "clock"
        default: "questionmark.circle"
        }
    }

    static func colour(_ finding: String) -> Color {
        switch finding {
        case "ok": .green
        case "caution": .orange
        case "stop": .red
        default: .secondary
        }
    }
}

/// Where a finding opens: a section of the Brief by its anchor, or a page
/// of its own (the loading, the risk); nil where the Brief has no part of
/// its own for it yet.
enum VerdictTarget: Equatable {
    case section(String)
    case loading
    case risk

    /// The Brief's anchors the weather's and the airspace's findings open.
    static let weatherAnchor = "brief-weather"
    static let airspaceAnchor = "brief-tfrs"

    static func of(_ item: VerdictItem) -> VerdictTarget? {
        switch item.key {
        case "weather": return .section(weatherAnchor)
        case "airspace": return .section(airspaceAnchor)
        case "balance": return .loading
        case "risk": return .risk
        default: return nil
        }
    }
}

/// The Go / No-Go at the top of the Brief: the planner's line over its
/// findings, then each finding in its colour with what was found, each
/// opening where the Brief says it in full; the pilot's minimums under
/// them, which the weather is held to.
struct GoNoGoSection: View {
    @Environment(Verdict.self) private var verdict
    /// Scrolls the Brief to one of its sections.
    var open: (String) -> Void

    var body: some View {
        Section {
            if let answer = verdict.answer {
                Label {
                    Text(answer.line.words).font(.headline)
                } icon: {
                    Image(systemName: FindingStyle.symbol(answer.line.finding))
                }
                .foregroundStyle(FindingStyle.colour(answer.line.finding))
                ForEach(answer.items) { item in row(item) }
            } else if let problem = verdict.problem {
                Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
            } else {
                ProgressView("Checking the flight…")
            }
            NavigationLink { MinimumsView() } label: {
                Label("Personal minimums", systemImage: "slider.horizontal.3")
            }
        } header: {
            HStack {
                Text("Go / No-Go")
                if verdict.asking, verdict.answer != nil { ProgressView().controlSize(.mini) }
            }
        }
    }

    @ViewBuilder private func row(_ item: VerdictItem) -> some View {
        let content = VerdictRow(item: item)
        switch VerdictTarget.of(item) {
        case .section(let anchor)?:
            Button { open(anchor) } label: { content }.buttonStyle(.plain)
        case .loading?:
            NavigationLink { LoadingView() } label: { content }
        case .risk?:
            NavigationLink { RiskView() } label: { content }
        case nil:
            content
        }
    }
}

/// One finding: its mark, its name and what was found.
struct VerdictRow: View {
    let item: VerdictItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: FindingStyle.symbol(item.finding)).foregroundStyle(FindingStyle.colour(item.finding))
            VStack(alignment: .leading, spacing: 2) {
                Text(item.label).font(.body.weight(.semibold))
                Text(item.detail).font(.subheadline)
                    .foregroundStyle(item.finding == "stop" ? Color.red : Color.secondary)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The pilot's personal minimums: the weather they will not take off or
/// land in, each a menu, Off until picked (the web's MinimumsPanel). Kept
/// on this phone; the planner says where the briefing is under them.
struct MinimumsView: View {
    @Environment(Verdict.self) private var verdict

    var body: some View {
        Form {
            Section {
                ForEach(PersonalMinimums.Key.allCases) { key in
                    Picker(key.title, selection: Binding(
                        get: { verdict.minimums[key] },
                        set: { verdict.setMinimum(key, $0) }
                    )) {
                        Text("Off").tag(Double?.none)
                        ForEach(key.choices, id: \.self) { value in
                            Text(key.words(value)).tag(Double?.some(value))
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
        }
        .navigationTitle("Personal Minimums")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The airplane's loading: its own empty weight and arm, each station's
/// pounds and the fuel aboard (the web's Weight & Balance), and the
/// planner's weight and balance for them. Kept on this phone for each
/// airplane; until set, the POH's sample airplane and a pilot.
struct LoadingView: View {
    @Environment(Verdict.self) private var verdict
    @Environment(Plan.self) private var plan
    @Environment(Session.self) private var session

    var body: some View {
        Form {
            if let loading = verdict.answer?.loading, let load = verdict.load(for: plan.aircraft) ?? verdict.answer?.balance?.load {
                Section("The airplane") {
                    figure("Empty weight", unit: "lb", value: load.emptyWeightLb) { var l = load; l.emptyWeightLb = $0; save(l) }
                    figure("Empty arm", unit: "in", value: load.emptyArmIn) { var l = load; l.emptyArmIn = $0; save(l) }
                }
                Section("Loaded") {
                    ForEach(Array(loading.stations.enumerated()), id: \.offset) { i, station in
                        figure(station.name, unit: "lb", value: i < load.stationsLb.count ? load.stationsLb[i] : 0,
                               note: station.maxLb.map { "\(Int($0).formatted()) lb at most" }) { value in
                            var l = load
                            l.stationsLb = loading.stations.indices.map { k in k == i ? value : (k < load.stationsLb.count ? load.stationsLb[k] : 0) }
                            save(l)
                        }
                    }
                    figure("Fuel", unit: "gal", value: load.fuelGal, note: "\(loading.fuelMaxGal.formatted()) gal usable") { var l = load; l.fuelGal = $0; save(l) }
                }
                if let balance = verdict.answer?.balance {
                    Section("Balance") {
                        LabeledContent("Takeoff", value: balance.takeoff.words)
                        LabeledContent("Landing", value: balance.landing.words)
                        let problems = balance.problems ?? []
                        if problems.isEmpty {
                            Label("Within the weight and the envelope", systemImage: FindingStyle.symbol("ok"))
                                .foregroundStyle(FindingStyle.colour("ok"))
                        } else {
                            ForEach(problems, id: \.self) { problem in
                                Label(problem, systemImage: FindingStyle.symbol("stop")).foregroundStyle(FindingStyle.colour("stop"))
                            }
                        }
                    }
                }
            } else if verdict.answer != nil {
                Text("The weight and balance is worked out for an airplane whose loading is built in: the Cessna 172S, from its POH.")
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Weight & Balance")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: verdict.key(for: plan)) { await verdict.refresh(plan: plan, signedIn: session.signedIn) }
    }

    private func save(_ load: AirplaneLoad) { verdict.setLoad(load, for: plan.aircraft) }

    /// One figure the pilot types, its unit beside it.
    private func figure(_ title: String, unit: String, value: Double, note: String? = nil, set: @escaping (Double) -> Void) -> some View {
        LabeledContent {
            HStack(spacing: 4) {
                TextField(title, value: Binding(get: { value }, set: { set(max(0, $0)) }), format: .number.precision(.fractionLength(0...2)))
                    .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 96)
                Text(unit).foregroundStyle(.secondary)
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let note { Text(note).font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }
}

/// The risk assessment (the web's RiskAssessment): the planner's level and
/// points, what the briefing, the nav log and the logbook raised, then
/// what only the pilot can say, ticked where it is so.
struct RiskView: View {
    @Environment(Verdict.self) private var verdict
    @Environment(Plan.self) private var plan
    @Environment(Session.self) private var session

    var body: some View {
        List {
            if let risk = verdict.answer?.risk {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(risk.line).font(.headline).foregroundStyle(colour(risk.level))
                        Text(risk.words)
                    }
                }
                let own = Set((verdict.answer?.selfChecks ?? []).map(\.key))
                let raised = (risk.factors ?? []).filter { !own.contains($0.key) }
                Section("From the briefing and your logbook") {
                    if raised.isEmpty {
                        Text("Nothing raised").foregroundStyle(.secondary)
                    } else {
                        ForEach(raised) { factor in
                            LabeledContent {
                                Text(factor.value)
                            } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(factor.label)
                                        if let why = factor.why { Text(why).font(.footnote).foregroundStyle(.secondary) }
                                    }
                                } icon: {
                                    Image(systemName: FindingStyle.symbol(factor.finding ?? "caution"))
                                        .foregroundStyle(FindingStyle.colour(factor.finding ?? "caution"))
                                }
                            }
                        }
                    }
                }
            } else if let problem = verdict.problem {
                Text(problem).foregroundStyle(.secondary)
            } else {
                ProgressView("Waiting on the briefing…")
            }
            let checks = verdict.answer?.selfChecks ?? []
            ForEach(groups(checks), id: \.self) { group in
                Section(group) {
                    ForEach(checks.filter { $0.group == group }) { check in
                        Toggle(isOn: Binding(get: { verdict.ticked.contains(check.key) }, set: { verdict.tick(check.key, $0) })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(check.label)
                                Text([check.why, check.value].compactMap { $0 }.joined(separator: " · "))
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Risk Assessment")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: verdict.key(for: plan)) { await verdict.refresh(plan: plan, signedIn: session.signedIn) }
    }

    /// The groups in the order the checks come.
    private func groups(_ checks: [RiskCheck]) -> [String] {
        var seen: [String] = []
        for check in checks where !seen.contains(check.group) { seen.append(check.group) }
        return seen
    }

    private func colour(_ level: String) -> Color {
        switch level {
        case "low": FindingStyle.colour("ok")
        case "caution": FindingStyle.colour("caution")
        default: FindingStyle.colour("stop")
        }
    }
}
