import SwiftUI

/// FPL: the route box, the figures for the whole flight, and the nav log
/// as the planner streams it.
struct FPLView: View {
    @Environment(Plan.self) private var plan
    @Environment(Charts.self) private var charts
    @FocusState private var focused: Field?

    enum Field { case dep, dest, altitude }
    @State private var altitude = ""
    /// The fields' widths follow the type size, so three figures or an
    /// ident still fit at the larger sizes.
    @ScaledMetric(relativeTo: .body) private var identWidth = 110.0
    @ScaledMetric(relativeTo: .body) private var altitudeWidth = 64.0

    /// The hundreds typed, flown; nothing typed, the planner's own pick.
    private func flyAltitude() {
        focused = nil
        let digits = altitude.filter(\.isNumber)
        plan.ownAltitudeFt = digits.isEmpty ? nil : Double(digits).map { $0 * 100 }
        plan.plan()
    }

    var body: some View {
        @Bindable var plan = plan
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 8) {
                        routeField("From", text: $plan.dep, field: .dep)
                        Image(systemName: "arrow.right").foregroundStyle(.secondary)
                        routeField("To", text: $plan.dest, field: .dest)
                        // A clearance heard into the route (ClearanceSheet).
                        Button { focused = nil; ClearanceListener.shared.sheetText = nil; ClearanceListener.shared.sheetShown = true } label: {
                            Image(systemName: ClearanceListener.shared.listening ? "mic.fill" : "mic")
                                // The 44-point hit area round the glyph, which does not grow.
                                .contentShape(Rectangle().inset(by: -10))
                        }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(ClearanceListener.shared.listening ? "Listening to the radio" : "Listen to the radio")
                        Button("Plan") { focused = nil; plan.plan() }
                            .buttonStyle(.borderedProminent)
                            .disabled(!plan.routed || plan.planning)
                    }
                    if plan.routed && plan.course != nil && RouteLine.shows(plan.routes, picked: plan.pickedChip, problem: plan.routesProblem) {
                        // The ways to fly it, right under the route's
                        // ends, folding as a runway line does.
                        RouteLineRow()
                    }
                    if let stage = plan.stage {
                        Label(stage, systemImage: "ellipsis").font(.footnote).foregroundStyle(.secondary)
                    } else if let at = plan.plannedAt, !plan.planning, Date().timeIntervalSince(at) > 3600 {
                        // A plan an hour old or more, as the web app says it:
                        // the winds and the weather were read then.
                        Label("Planned \(at.formatted(.relative(presentation: .named)))", systemImage: "clock").font(.footnote).foregroundStyle(.secondary)
                    }
                    if let problem = plan.problem {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(problem.brief ?? problem.detail).font(.subheadline.weight(.semibold))
                            ForEach(problem.reasons ?? [], id: \.self) { Text($0).font(.footnote) }
                            if let advice = problem.advice { Text(advice).font(.footnote).foregroundStyle(.secondary) }
                            // The ways round the planner found: a Class B's
                            // waypoint, or the way round high ground.
                            ForEach(problem.detours ?? []) { detour in
                                Button {
                                    plan.goRound(detour)
                                } label: {
                                    Label(detour.via?.isEmpty == false ? "Go Round · +\(Int(detour.addedNm.rounded())) nm" : "Fly via \(detour.ident) · +\(Int(detour.addedNm.rounded())) nm",
                                          systemImage: "arrow.triangle.turn.up.right.diamond")
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .foregroundStyle(Color.orange)
                    }
                    // Where the tanks do not hold a flight, said; the
                    // fuel stops themselves are the route line's "Your
                    // Route" chip.
                    ForEach(plan.totals?.fuelStops ?? []) { suggestion in
                        Label("\(suggestion.departure) → \(suggestion.destination) needs fuel on the way", systemImage: "fuelpump")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(.orange)
                    }
                }
                if plan.routed {
                    // The altitude beside the airplane, as the web app has
                    // them: the planner's pick until one is typed, in
                    // hundreds of feet ("065" for 6,500 ft, the owner's
                    // FL-style figure); cleared, the planner's again.
                    HStack {
                        Text(plan.tail ?? plan.aircraft.uppercased()).font(.body.monospaced())
                        Spacer()
                        Text("Altitude").foregroundStyle(.secondary)
                        TextField(plan.altitudeFt.map { String(format: "%03d", Int($0) / 100) } ?? "—", text: $altitude)
                            .textFieldStyle(.roundedBorder).keyboardType(.numberPad).font(.body.monospaced())
                            .frame(width: altitudeWidth).multilineTextAlignment(.trailing)
                            .focused($focused, equals: .altitude)
                            .onSubmit(flyAltitude)
                            .accessibilityLabel("Altitude, hundreds of feet")
                            .accessibilityValue(plan.altitudeFt.map(SpokenFigures.feet) ?? "the planner's pick")
                        // The profile, with the altitude's warning tick where
                        // the pilot's own breaks a limit: in the inspector
                        // on the iPad (CardLink), as the brief is.
                        let cautioned = !(plan.altitude?.cautions.isEmpty ?? true)
                        CardLink(.profile) {
                            Image(systemName: cautioned ? "exclamationmark.triangle.fill" : "chart.xyaxis.line")
                                .foregroundStyle(cautioned ? Color.orange : Color.accentColor)
                                .contentShape(Rectangle().inset(by: -10))
                        }
                        .accessibilityLabel(cautioned ? "Profile, with cautions on the altitude" : "Profile")
                        .buttonStyle(.plain)
                        // The Brief, marked where the planner says VFR is
                        // not recommended: in the glyph too, for a pilot who
                        // does not see the red.
                        let notRecommended = !(plan.briefing?.vfrNotRecommended?.isEmpty ?? true)
                        CardLink(.brief) {
                            Image(systemName: notRecommended ? "doc.text.fill" : "doc.text")
                                .foregroundStyle(notRecommended ? Color.red : Color.accentColor)
                                .contentShape(Rectangle().inset(by: -10))
                        }
                        .accessibilityLabel(notRecommended ? "Brief, VFR flight not recommended" : "Brief")
                        .buttonStyle(.plain)
                    }
                    .toolbar {
                        if focused == .altitude {
                            ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Fly") { flyAltitude() } }
                        }
                    }
                }
                if !plan.stops.isEmpty {
                    // The stops in order, each a swipe from going and all
                    // of them draggable into another order, as the web
                    // app's route list has them.
                    Section("Stops") {
                        ForEach(Array(plan.stops.enumerated()), id: \.offset) { _, stop in
                            RoutePointMenu(ident: stop)
                        }
                        .onDelete { at in plan.stops.remove(atOffsets: at); plan.plan() }
                        .onMove { from, to in plan.stops.move(fromOffsets: from, toOffset: to); plan.plan() }
                    }
                }
                // The route's own edits and the flight in the air.
                RouteExtrasSection()
                if let totals = plan.totals {
                    Section {
                        HStack {
                            stripFigure("TO", plan.dest)
                            stripFigure("DIST", totals.distanceNm.map(AirportWords.nm) ?? "—", spoken: totals.distanceNm.map(SpokenFigures.nauticalMiles))
                            stripFigure("ETE", totals.eteMin.map(hoursMinutes) ?? "—", spoken: totals.eteMin.map(SpokenFigures.minutes))
                            stripFigure("FUEL", totals.fuelGal.map(AirportWords.gal) ?? "—", spoken: totals.fuelGal.map(SpokenFigures.gallons),
                                   warn: (totals.fuelMarginGal ?? 0) < 0)
                        }
                        .accessibilityElement(children: .combine)
                        // As the sheet's strip: four across stop at this size.
                        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
                    }
                }
                if plan.course != nil {
                    // Each field's procedures, pull-downs as the web app's
                    // route list has them: the departure's departures, every
                    // landing's arrivals and approaches.
                    Section("Procedures") {
                        ProceduresRow(ident: plan.dep, kinds: ["departure"])
                        ForEach(plan.stops + [plan.dest], id: \.self) { field in
                            ProceduresRow(ident: field, kinds: ["arrival", "approach"])
                        }
                    }
                }
                if plan.course != nil, let template = charts.template {
                    // The chart along the route for the air, as the web app's
                    // KeepRoute keeps it: tapped once, the count as it goes.
                    Section {
                        Button {
                            plan.keepForTheAir(template: template, minZoom: charts.base?.minZoom ?? 6)
                        } label: {
                            if let keeping = plan.keeping {
                                Label(keeping.kept >= keeping.wanted ? "Kept for the air: \(keeping.wanted) tiles" : "Keeping for the air: \(keeping.kept) of \(keeping.wanted)", systemImage: keeping.kept >= keeping.wanted ? "checkmark.icloud" : "icloud.and.arrow.down")
                            } else {
                                Label("Keep for the air", systemImage: "icloud.and.arrow.down")
                            }
                        }
                        .disabled(plan.keeping.map { $0.kept < $0.wanted } ?? false)
                    }
                }
                if !plan.legs.isEmpty {
                    Section(plan.altitudeFt.map { "Nav log · \(Int($0).formatted()) ft" } ?? "Nav log") {
                        ForEach(plan.legs) { leg in
                            NavigationLink(value: leg) { LegRow(leg: leg) }
                        }
                    }
                }
            }
            .navigationTitle("Flight plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    // The pilot's saved flights, and the plan saved among them.
                    NavigationLink(value: "flights") { Label("Flights", systemImage: "tray.full") }
                }
            }
            .navigationDestination(for: Leg.self) { leg in LegDetailView(leg: leg) }
            .navigationDestination(for: String.self) { page in
                switch page {
                case "profile": ProfileCard()
                case "brief": BriefView()
                case "flights": FlightsView()
                default: FlightPage(name: page)
                }
            }
            .toolbar { RouteToolbar(plan: plan) }
            .sheet(isPresented: Binding(get: { ClearanceListener.shared.sheetShown }, set: { ClearanceListener.shared.sheetShown = $0 })) {
                ClearanceSheet().presentationDetents([.medium, .large])
            }
        }
    }

    private func routeField(_ label: String, text: Binding<String>, field: Field) -> some View {
        TextField(label, text: text)
            .textFieldStyle(.roundedBorder)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .font(.body.monospaced())
            .frame(maxWidth: identWidth)
            .focused($focused, equals: field)
            .onSubmit { if field == .dep { focused = .dest } else { plan.plan() } }
    }
}

/// A leg's row: where to, the magnetic heading, the distance, the time
/// and the fuel, the figures the kneeboard wants at a glance.
struct LegRow: View {
    let leg: Leg

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(leg.to).font(.headline)
                HStack(spacing: 10) {
                    Text(AirportWords.degrees(leg.magneticHeadingDeg))
                    if let gs = leg.groundspeedKt { Text(AirportWords.kt(gs)) }
                    if let wind = leg.wind, let dir = wind.directionDeg, let kt = wind.speedKt {
                        Text(String(format: "%03.0f/%.0f", dir, kt))
                    }
                }
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(AirportWords.nm(leg.distanceNm)).font(.subheadline.monospacedDigit())
                HStack(spacing: 8) {
                    if let ete = leg.eteMin { Text(hoursMinutes(ete)) }
                    if let fuel = leg.fuelGal { Text(AirportWords.gal(fuel)) }
                }
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    /// The row as a pilot reads a nav log aloud: "To KHIB, heading zero
    /// nine zero, ninety-eight knots, wind two seven zero at twelve, twenty
    /// nautical miles, twelve minutes, one point four gallons".
    private var spoken: String {
        var parts = ["To \(leg.to)", "heading \(SpokenFigures.degrees(leg.magneticHeadingDeg))"]
        if let gs = leg.groundspeedKt { parts.append(SpokenFigures.knots(gs)) }
        if let wind = leg.wind, let dir = wind.directionDeg, let kt = wind.speedKt {
            parts.append("wind \(SpokenFigures.digits(String(format: "%03.0f", dir))) at \(SpokenFigures.number(kt))")
        }
        parts.append(SpokenFigures.nauticalMiles(leg.distanceNm))
        if let ete = leg.eteMin { parts.append(SpokenFigures.minutes(ete)) }
        if let fuel = leg.fuelGal { parts.append(SpokenFigures.gallons(fuel)) }
        return parts.joined(separator: ", ")
    }
}

/// Minutes as the web app shows them: "2h 06m".
func hoursMinutes(_ minutes: Double) -> String {
    let whole = Int(minutes.rounded())
    return String(format: "%dh %02dm", whole / 60, whole % 60)
}
