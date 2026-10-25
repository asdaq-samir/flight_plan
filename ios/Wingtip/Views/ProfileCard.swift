import SwiftUI

/// The route from the side, as the web app's Profile card has it: the
/// ground and the airspace under the line, the altitude flown across
/// them, a wheel of altitudes to fly instead -- the planner's legal ones
/// named for their plans, and every 500 ft besides, "Outside the limits",
/// flown with its warnings, never refused (the owner's rule) -- the four
/// plans by name, and the altitude's cautions.
struct ProfileCard: View {
    @Environment(Plan.self) private var plan
    @Environment(DryRun.self) private var dryRun
    @State private var picked: Double?

    private static let ladder: [Double] = stride(from: 1000.0, through: 17_500.0, by: 500.0).map { $0 }

    /// The wheel's rows, highest first: the planner's legal altitudes and
    /// the 500 ft ladder under Class A (14 CFR 71.33).
    private var altitudes: [Double] {
        let legal = Set(plan.altitude?.altitudeFigures.map(\.altitudeFt) ?? [])
        var all = Set(Self.ladder).union(legal)
        if let flown = plan.altitudeFt { all.insert(flown) }
        return all.sorted(by: >)
    }

    private var legal: Set<Double> { Set(plan.altitude?.altitudeFigures.map(\.altitudeFt) ?? []) }

    private func name(of altitude: Double) -> String? {
        if let option = plan.altitude?.options.first(where: { $0.altitudeFt == altitude && !$0.steps.isEmpty }) {
            return option.kind.prefix(1).uppercased() + option.kind.dropFirst()
        }
        if !legal.contains(altitude) { return "Outside the limits" }
        return nil
    }

    var body: some View {
        List {
            Section {
                ProfileChart(profile: plan.profile, legs: plan.legs, altitudeFt: picked ?? plan.altitudeFt, selection: plan.altitude?.altitudeSelection)
                    .frame(height: 200)
                    .listRowInsets(EdgeInsets())
            }
            Section("Altitude") {
                Picker("Cruise altitude", selection: Binding(get: { picked ?? plan.altitudeFt ?? altitudes.last ?? 0 }, set: { fly($0) })) {
                    ForEach(altitudes, id: \.self) { altitude in
                        HStack {
                            Text(flightLevel(altitude)).monospacedDigit().bold()
                            if let name = name(of: altitude) {
                                Text(name).foregroundStyle(legal.contains(altitude) ? Color.secondary : Color.orange)
                            }
                            if let figure = plan.altitude?.altitudeFigures.first(where: { $0.altitudeFt == altitude }), let ete = figure.eteMin {
                                Spacer()
                                Text(hoursMinutes(ete)).foregroundStyle(.secondary).monospacedDigit()
                            }
                        }
                        .tag(altitude)
                    }
                }
                .pickerStyle(.wheel)
                .frame(height: 160)
                if let options = plan.altitude?.options, !options.isEmpty {
                    Picker("Plan", selection: Binding(get: { plan.altitudeChoice ?? (plan.ownAltitudeFt == nil ? "fastest" : "") }, set: { choose($0) })) {
                        ForEach(options.filter { !$0.steps.isEmpty }) { option in
                            Text("\(option.kind.prefix(1).uppercased() + option.kind.dropFirst()) · \(flightLevel(option.altitudeFt ?? 0))").tag(option.kind)
                        }
                        if plan.ownAltitudeFt != nil { Text("Your altitude").tag("") }
                    }
                }
            }
            if let cautions = plan.altitude?.cautions, !cautions.isEmpty {
                Section {
                    ForEach(cautions) { caution in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(flightLevel(caution.altitudeFt)) \(caution.fromIdent) → \(caution.toIdent)").font(.subheadline.weight(.semibold))
                            ForEach(caution.reasons, id: \.self) { Text("• \($0)").font(.footnote) }
                        }
                        .foregroundStyle(Color.orange)
                    }
                } header: {
                    Label("Cautions", systemImage: "exclamationmark.triangle")
                }
            }
            if let selection = plan.altitude?.altitudeSelection {
                Section("How the altitude was chosen") {
                    if let floor = selection.floorFt { LabeledContent("Floor", value: "\(Int(floor).formatted()) ft, the terrain and obstacles (14 CFR 91.119)") }
                    if let ceiling = selection.serviceCeilingFt { LabeledContent("Ceiling", value: "\(Int(ceiling).formatted()) ft, the airplane's") }
                    if let clouds = selection.cloudBaseFt { LabeledContent("Clouds", value: "base \(Int(clouds).formatted()) ft (14 CFR 91.155)") }
                    if let shelf = selection.airspaceCeilingFt { LabeledContent("Class B", value: "from \(Int(shelf).formatted()) ft (14 CFR 91.131)") }
                    if !selection.candidatesFt.isEmpty {
                        LabeledContent("Legal", value: selection.candidatesFt.map(flightLevel).joined(separator: " "))
                    }
                }
            }
        }
        .navigationTitle(plan.altitudeFt.map(flightLevel) ?? "Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The dry run from the profile's corner, as the web app has it.
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    if let course = plan.course { dryRun.start(line: course.coordinates, legs: plan.legs) }
                } label: { Label("Dry run", systemImage: "play.fill") }
                .disabled(plan.legs.isEmpty || plan.course == nil)
            }
        }
        .onChange(of: plan.altitudeFt) { _, _ in picked = nil }
    }

    /// An altitude off the wheel: a plan's where it is one's, else the
    /// pilot's own, at each leg's nearest legal altitude where the pick is
    /// legal and as it stands where it is not.
    private func fly(_ altitude: Double) {
        picked = altitude
        if let option = plan.altitude?.options.first(where: { $0.altitudeFt == altitude && !$0.steps.isEmpty }) {
            plan.ownAltitudeFt = nil
            plan.altitudeChoice = option.kind
        } else {
            plan.altitudeChoice = nil
            plan.ownAltitudeFt = altitude
            plan.ownAltitudeLegal = legal.contains(altitude)
        }
        plan.plan()
    }

    private func choose(_ kind: String) {
        guard !kind.isEmpty else { return }
        plan.ownAltitudeFt = nil
        plan.altitudeChoice = kind
        plan.plan()
    }
}

/// The owner's FL-style figure for an altitude: hundreds of feet, three
/// digits (FL065 for 6,500 ft), knowingly not the FAA's meaning.
func flightLevel(_ feet: Double) -> String {
    String(format: "FL%03d", Int((feet / 100).rounded()))
}

/// The side view itself, drawn: the ground in brown, Class B and C in
/// their chart colours, the altitude line across.
struct ProfileChart: View {
    let profile: RouteProfile?
    let legs: [Leg]
    let altitudeFt: Double?
    let selection: AltitudeSelection?

    var body: some View {
        Canvas { context, size in
            guard let profile, profile.lengthNm > 0, !profile.terrain.isEmpty else { return }
            let highest = max(profile.terrain.map(\.groundFt).max() ?? 0, altitudeFt ?? 0, selection?.recommendedFt ?? 0, 3000)
            let top = (highest * 1.25 / 1000).rounded(.up) * 1000
            let x = { (nm: Double) in CGFloat(nm / profile.lengthNm) * size.width }
            let y = { (ft: Double) in size.height - CGFloat(max(0, min(1, ft / top))) * size.height }
            // Airspace bands, Class B blue and Class C magenta as the chart
            // draws them, faint.
            for area in profile.airspace {
                let colour: Color = area.airspaceClass == "B" ? Color.blue : area.airspaceClass == "C" ? Color.purple : Color.gray
                let rect = CGRect(x: x(area.fromNm), y: y(area.ceilingFt ?? top), width: max(1, x(area.toNm) - x(area.fromNm)), height: max(1, y(area.floorFt) - y(area.ceilingFt ?? top)))
                context.fill(Path(rect), with: .color(colour.opacity(0.12)))
                context.stroke(Path(rect), with: .color(colour.opacity(0.5)), lineWidth: 1)
            }
            // The ground.
            var ground = Path()
            ground.move(to: CGPoint(x: 0, y: size.height))
            for point in profile.terrain { ground.addLine(to: CGPoint(x: x(point.alongNm), y: y(point.groundFt))) }
            ground.addLine(to: CGPoint(x: size.width, y: size.height))
            ground.closeSubpath()
            context.fill(ground, with: .color(Color(red: 0.55, green: 0.38, blue: 0.2).opacity(0.75)))
            // The altitude line: the legs' own where they are in, else
            // one altitude across.
            var line = Path()
            if legs.count > 1 {
                var along = 0.0
                line.move(to: CGPoint(x: 0, y: y(legs[0].altitudeFt)))
                for leg in legs {
                    along += leg.distanceNm
                    line.addLine(to: CGPoint(x: x(min(along, profile.lengthNm)), y: y(leg.altitudeFt)))
                }
            } else if let altitudeFt {
                line.move(to: CGPoint(x: 0, y: y(altitudeFt)))
                line.addLine(to: CGPoint(x: size.width, y: y(altitudeFt)))
            }
            context.stroke(line, with: .color(.blue), style: StrokeStyle(lineWidth: 2.5, lineJoin: .round))
            // The scale's top and the floor.
            context.draw(Text("\(Int(top).formatted()) ft").font(.caption2).foregroundStyle(.secondary), at: CGPoint(x: 28, y: 10))
        }
        .background(Color(.secondarySystemBackground))
        .accessibilityLabel("The route from the side: the ground, the airspace and the altitude flown")
    }
}
