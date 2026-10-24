import SwiftUI

/// FPL: the route box, the figures for the whole flight, and the nav log
/// as the planner streams it.
struct FPLView: View {
    @Environment(Plan.self) private var plan
    @FocusState private var focused: Field?

    enum Field { case dep, dest, altitude }
    @State private var altitude = ""

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
                        Button("Plan") { focused = nil; plan.plan() }
                            .buttonStyle(.borderedProminent)
                            .disabled(!plan.routed || plan.planning)
                    }
                    if let stage = plan.stage {
                        Label(stage, systemImage: "ellipsis").font(.footnote).foregroundStyle(.secondary)
                    }
                    if let problem = plan.problem {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(problem.brief ?? problem.detail).font(.subheadline.weight(.semibold))
                            ForEach(problem.reasons ?? [], id: \.self) { Text($0).font(.footnote) }
                            if let advice = problem.advice { Text(advice).font(.footnote).foregroundStyle(.secondary) }
                        }
                        .foregroundStyle(Color.orange)
                    }
                }
                if plan.routed {
                    // The altitude beside the airplane, as the web app has
                    // them: the planner's pick until one is typed, in
                    // hundreds of feet ("065" for 6,500 ft, the owner's
                    // FL-style figure); cleared, the planner's again.
                    HStack {
                        Text(plan.aircraft.uppercased()).font(.body.monospaced())
                        Spacer()
                        Text("Altitude").foregroundStyle(.secondary)
                        TextField(plan.altitudeFt.map { String(format: "%03d", Int($0) / 100) } ?? "—", text: $altitude)
                            .textFieldStyle(.roundedBorder).keyboardType(.numberPad).font(.body.monospaced())
                            .frame(width: 64).multilineTextAlignment(.trailing)
                            .focused($focused, equals: .altitude)
                            .onSubmit(flyAltitude)
                        // The profile, with the altitude's warning tick where
                        // the pilot's own breaks a limit.
                        NavigationLink(value: "profile") {
                            Image(systemName: (plan.altitude?.cautions.isEmpty ?? true) ? "chart.xyaxis.line" : "exclamationmark.triangle.fill")
                                .foregroundStyle((plan.altitude?.cautions.isEmpty ?? true) ? Color.accentColor : Color.orange)
                        }
                        .accessibilityLabel("Profile")
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
                            Text(stop).font(.body.monospaced())
                        }
                        .onDelete { at in plan.stops.remove(atOffsets: at); plan.plan() }
                        .onMove { from, to in plan.stops.move(fromOffsets: from, toOffset: to); plan.plan() }
                    }
                }
                if let totals = plan.totals {
                    Section {
                        HStack {
                            figure("TO", plan.dest)
                            figure("DIST", totals.distanceNm.map { String(format: "%.1f nm", $0) } ?? "—")
                            figure("ETE", totals.eteMin.map(hoursMinutes) ?? "—")
                            figure("FUEL", totals.fuelGal.map { String(format: "%.1f gal", $0) } ?? "—",
                                   warn: (totals.fuelMarginGal ?? 0) < 0)
                        }
                    }
                }
                if !plan.legs.isEmpty {
                    Section(plan.altitudeFt.map { "Nav log · \(Int($0).formatted()) ft" } ?? "Nav log") {
                        ForEach(plan.legs) { leg in
                            LegRow(leg: leg)
                        }
                    }
                }
            }
            .navigationTitle("Flight plan")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { page in
                if page == "profile" { ProfileCard() }
            }
            .toolbar {
                if !plan.stops.isEmpty {
                    ToolbarItem(placement: .topBarLeading) { EditButton() }
                }
                if plan.routed {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Clear", role: .destructive) { plan.clear() }
                    }
                }
            }
        }
    }

    private func routeField(_ label: String, text: Binding<String>, field: Field) -> some View {
        TextField(label, text: text)
            .textFieldStyle(.roundedBorder)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .font(.body.monospaced())
            .frame(maxWidth: 110)
            .focused($focused, equals: field)
            .onSubmit { if field == .dep { focused = .dest } else { plan.plan() } }
    }

    private func figure(_ name: String, _ value: String, warn: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(name).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.headline.monospacedDigit()).foregroundStyle(warn ? Color.red : Color.primary)
        }
        .frame(maxWidth: .infinity)
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
                    Text(String(format: "%03.0f°", leg.magneticHeadingDeg))
                    if let gs = leg.groundspeedKt { Text(String(format: "%.0f kt", gs)) }
                    if let wind = leg.wind, let dir = wind.directionDeg, let kt = wind.speedKt {
                        Text(String(format: "%03.0f/%.0f", dir, kt))
                    }
                }
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.1f nm", leg.distanceNm)).font(.subheadline.monospacedDigit())
                HStack(spacing: 8) {
                    if let ete = leg.eteMin { Text(hoursMinutes(ete)) }
                    if let fuel = leg.fuelGal { Text(String(format: "%.1f gal", fuel)) }
                }
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Minutes as the web app shows them: "2h 06m".
func hoursMinutes(_ minutes: Double) -> String {
    let whole = Int(minutes.rounded())
    return String(format: "%dh %02dm", whole / 60, whole % 60)
}
