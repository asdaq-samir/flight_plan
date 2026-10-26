import CoreLocation
import SwiftUI

/// The sheets and alerts of the flight's extras, over the tabs: an
/// airplane's card, a hold, a pilot's flown
/// track; and the alerts that ask for a point's altitude or a fix off it.
@MainActor
@Observable
final class FlightUI {
    static let shared = FlightUI()

    enum Card: Identifiable, Equatable {
        case airplane(String)
        case hold(String)
        case flown(Int64, String)

        var id: String {
            switch self {
            case .airplane(let hex): return "airplane:\(hex)"
            case .hold(let fix): return "hold:\(fix)"
            case .flown(let id, _): return "flown:\(id)"
            }
        }
    }

    var card: Card?
    /// The point whose altitude is asked for.
    var altitudeAt: String?
    /// The point a fix is made off.
    var fixFrom: String?
    /// A procedure's fix whose crossing altitude is asked for.
    var crossAt: String?
}

/// The sheets over the tabs, as Maps stacks a place's card over its
/// own: half way up with the map live above, all the way up on a drag.
struct FlightSheets: ViewModifier {
    /// On iPad the inspector holds them (SplitLayout), not a sheet.
    @Environment(\.splitLayout) private var split

    func body(content: Content) -> some View {
        @Bindable var ui = FlightUI.shared
        content
            .sheet(item: split ? .constant(nil) : $ui.card, onDismiss: {
                // Its card put away, the airplane is no longer tracked.
                if case .airplane = FlightUI.shared.card {} else { Tracking.shared.track(nil) }
            }) { card in
                Group {
                    switch card {
                    case .airplane(let hex): AirplaneCard(hex: hex)
                    case .hold(let fix): HoldSheet(fix: fix)
                    case .flown(let id, let title): FlownTrackView(flight: id, title: title)
                    }
                }
                .presentationDetents([.medium, .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            }
            .modifier(PointAlerts())
    }
}

/// The alerts that ask for one figure or two, as iOS asks: a point's own
/// altitude, a fix off a point (its course and distance), and a
/// procedure's fix's crossing altitude.
struct PointAlerts: ViewModifier {
    @Environment(Plan.self) private var plan
    @State private var typed = ""
    @State private var course = ""
    @State private var distance = ""

    func body(content: Content) -> some View {
        let ui = FlightUI.shared
        content
            .alert(ui.altitudeAt.map { "Altitude at \($0)" } ?? "Altitude", isPresented: shown(\.altitudeAt), presenting: ui.altitudeAt) { ident in
                TextField(PointAltitude.isWaypoint(ident, course: plan.course) ? "FL045 as 045" : "Feet", text: $typed).keyboardType(.numberPad)
                Button("Set") {
                    if let feet = PointAltitude.feet(typed, waypoint: PointAltitude.isWaypoint(ident, course: plan.course)) { plan.setAltitude(at: ident, feet: feet) }
                    typed = ""
                }
                if plan.extras.altitudes[ident.uppercased()] != nil {
                    Button("Reset", role: .destructive) { plan.setAltitude(at: ident, feet: nil); typed = "" }
                }
                Button("Cancel", role: .cancel) { typed = "" }
            } message: { ident in
                Text(altitudeMessage(ident))
            }
            .alert(ui.fixFrom.map { "A fix from \($0)" } ?? "A fix", isPresented: shown(\.fixFrom), presenting: ui.fixFrom) { from in
                TextField("Course, as 090", text: $course).keyboardType(.numberPad)
                TextField("Distance, nm", text: $distance).keyboardType(.decimalPad)
                Button("Add") {
                    if let ident = PointAltitude.frd(from: from, course: course, distance: distance) { plan.insertFix(ident, after: from) }
                    course = ""; distance = ""
                }
                Button("Cancel", role: .cancel) { course = ""; distance = "" }
            } message: { from in
                Text("Its magnetic course from \(from), a VOR's radial, and how far. Flown over next.")
            }
            .alert(ui.crossAt.map { "Cross \($0) at" } ?? "Cross at", isPresented: shown(\.crossAt), presenting: ui.crossAt) { fix in
                TextField("Feet", text: $typed).keyboardType(.numberPad)
                Button("Set") {
                    if let feet = PointAltitude.feet(typed, waypoint: false) { plan.setCrossing(at: fix, feet: feet) }
                    typed = ""
                }
                if plan.extras.crossings[fix.uppercased()] != nil {
                    Button("As Charted", role: .destructive) { plan.setCrossing(at: fix, feet: nil); typed = "" }
                }
                Button("Cancel", role: .cancel) { typed = "" }
            } message: { _ in
                Text("The altitude ATC gave you to cross it at, in feet above sea level.")
            }
    }

    /// Whether one of the alerts is up, its subject set; put away, cleared.
    private func shown(_ subject: ReferenceWritableKeyPath<FlightUI, String?>) -> Binding<Bool> {
        Binding(get: { FlightUI.shared[keyPath: subject] != nil }, set: { if !$0 { FlightUI.shared[keyPath: subject] = nil } })
    }

    /// A waypoint's is flown to it; an airport's is what a flight landing
    /// there comes down to; with the planner's cautions on the pilot's own.
    private func altitudeMessage(_ ident: String) -> String {
        let cautions = plan.altitude?.cautions.filter { $0.toIdent.uppercased() == ident.uppercased() }.flatMap(\.reasons) ?? []
        let base = PointAltitude.isWaypoint(ident, course: plan.course) ? "Flown to it at this altitude; the rest of the route as planned."
            : "Where a flight landing here comes down to, in feet above sea level."
        return ([base] + cautions).joined(separator: "\n")
    }
}

/// A point's own altitude and a fix off it, as typed.
enum PointAltitude {
    /// Feet from what is typed: a waypoint's three figures in hundreds of
    /// feet (045 for 4,500), an airport's in feet. A VFR altitude, under
    /// Class A's floor at 18,000 ft MSL (14 CFR 71.33, 91.135), as the
    /// planner takes one (PlanQuery.own_altitudes).
    static func feet(_ typed: String, waypoint: Bool) -> Int? {
        let digits = typed.filter(\.isNumber)
        guard !digits.isEmpty, digits.count <= (waypoint ? 3 : 5), let figure = Int(digits) else { return nil }
        let feet = waypoint ? figure * 100 : figure
        return feet > 0 && feet < 18_000 ? feet : nil
    }

    /// A course of 000 to 360, out to 999 nm, as the planner takes a
    /// fix/radial/distance (vfr.fixes.parse_frd).
    static func frd(from: String, course: String, distance: String) -> String? {
        let digits = course.filter(\.isNumber)
        guard digits.count == 3, let deg = Int(digits), deg <= 360, let nm = Double(distance), nm > 0, nm <= 999 else { return nil }
        return RouteExtras.frd(from, courseDeg: deg, nm: nm)
    }

    /// Whether a point of the route is a waypoint rather than a field: a
    /// fix, a pilot's own point off one, or a position.
    static func isWaypoint(_ ident: String, course: Course?) -> Bool {
        if ident.contains("/") || ident.hasPrefix("@") { return true }
        let ends = (course.map { [$0.departure, $0.destination] + ($0.stops ?? []) }) ?? []
        return ends.first { $0.ident.uppercased() == ident.uppercased() }?.kind == "fix"
    }
}

/// The route flown direct to a point, said over the route's figures, and
/// Cancel: the route as it was (the web app's DirectStrip).
struct DirectStrip: View {
    @Environment(Plan.self) private var plan

    var body: some View {
        if let direct = plan.extras.direct {
            HStack {
                Label("Direct to \(direct)", systemImage: "arrow.up.right").font(.body.weight(.semibold))
                Spacer()
                Button("Cancel") { plan.cancelDirect() }
            }
        }
    }
}

/// What can be done at a point of the route, in one order and one set of
/// words wherever its menu is (the web app's PointMenuItems): Direct To,
/// Set Altitude, a fix off it, a hold, Remove.
struct RoutePointMenu: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(DryRun.self) private var dryRun
    let ident: String
    /// Where it is in the route: the departure, a stop or the destination.
    var role: Role = .stop

    enum Role { case departure, stop, destination }

    var body: some View {
        Menu {
            Text(ident)
            if role != .departure {
                Button {
                    if plan.extras.direct == ident { plan.cancelDirect() } else { plan.directTo(ident, from: dryRun.fix ?? ownShip.fix) }
                } label: {
                    Label(plan.extras.direct == ident ? "Fly as Planned" : "Direct To", systemImage: "arrow.up.right")
                }
                Button { FlightUI.shared.altitudeAt = ident } label: {
                    Label(plan.extras.altitudes[ident.uppercased()].map { "Set Altitude… (\($0.formatted()) ft)" } ?? "Set Altitude…", systemImage: "arrow.up.and.down")
                }
            }
            Button { FlightUI.shared.fixFrom = ident } label: { Label("Create a Fix from Here…", systemImage: "scope") }
            Button { FlightUI.shared.card = .hold(ident) } label: {
                Label(plan.hold(at: ident) == nil ? "Hold Here…" : "Change Hold…", systemImage: "repeat")
            }
            if role == .stop {
                Divider()
                Button(role: .destructive) {
                    plan.stops.removeAll { $0 == ident }
                    plan.plan()
                } label: { Label("Remove", systemImage: "trash") }
            }
        } label: {
            HStack {
                Text(ident).font(.body.monospaced()).foregroundStyle(.primary)
                Spacer()
                if let feet = plan.extras.altitudes[ident.uppercased()] {
                    Text("\(feet.formatted()) ft").font(.footnote.monospacedDigit()).foregroundStyle(.tint)
                }
                if plan.hold(at: ident) != nil { Image(systemName: "repeat").foregroundStyle(.tint) }
                if plan.extras.direct == ident { Image(systemName: "arrow.up.right").foregroundStyle(.tint) }
                Image(systemName: "ellipsis.circle").foregroundStyle(.tint)
            }
        }
        .accessibilityLabel("\(ident): more")
    }
}

/// FPL's section for the route's own edits: the Direct to, its ends'
/// menus, the holds set, the procedures' fixes, and the pages of the
/// flight in the air.
struct RouteExtrasSection: View {
    @Environment(Plan.self) private var plan

    var body: some View {
        if plan.routed {
            Section {
                DirectStrip()
                RoutePointMenu(ident: plan.dep, role: .departure)
                RoutePointMenu(ident: plan.dest, role: .destination)
                ForEach(plan.extras.holds) { hold in
                    Button { FlightUI.shared.card = .hold(hold.fix) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Hold at \(hold.fix)").foregroundStyle(.primary)
                            Text(hold.words).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                .onDelete { at in at.map { plan.extras.holds[$0].fix }.forEach { plan.setHold(at: $0, nil) } }
                ForEach(plan.procedures) { pick in
                    NavigationLink(value: "fixes:\(pick.ident):\(pick.id)") {
                        LabeledContent("\(pick.name) fixes", value: plan.extras.procedureDirect["\(pick.ident):\(pick.id)"].map { "Direct \($0)" } ?? pick.ident)
                    }
                }
            } header: {
                Text("Route")
            }
            Section("In flight") {
                NavigationLink(value: "nearest") { Label("Nearest for a diversion", systemImage: "airplane.arrival") }
                NavigationLink(value: "notes") { Label("Checkpoint notes", systemImage: "text.bubble") }
                NavigationLink(value: "file") { Label("File flight plan", systemImage: "doc.text") }
            }
        }
    }
}

/// The pages FPL opens by name beyond its own (its navigationDestination's
/// default): a procedure's fixes, nearest for a diversion, the checkpoints'
/// notes and filing with Flight Service.
struct FlightPage: View {
    let name: String

    var body: some View {
        if name.hasPrefix("fixes:") {
            let parts = name.split(separator: ":").map(String.init)
            ProcedureFixesView(ident: parts.count > 1 ? parts[1] : "", id: parts.count > 2 ? parts[2] : "")
        } else {
            switch name {
            case "nearest": DiversionView()
            case "notes": CheckpointNotesView()
            case "file": FlightServiceView()
            default: EmptyView()
            }
        }
    }
}

/// A hold at a point of the route, set as Garmin's and ForeFlight's
/// pilot-defined holds are (the web app's HoldSheet): the course, inbound
/// or outbound; the turns, right (the standard pattern) or left; the legs
/// by time or distance; and how long. The planner works out the entry
/// from the course flown to it and adds its time and fuel.
struct HoldSheet: View {
    let fix: String
    @Environment(Plan.self) private var plan
    @State private var course = ""
    @State private var inbound = true
    @State private var right = true
    @State private var timed = true
    @State private var legMin = 1.0
    @State private var legNm = 4.0
    @State private var length = "2T"

    static let legMinutes = [1.0, 1.5, 2, 3]
    static let legMiles = [2.0, 3, 4, 5, 10]

    /// Put away, whether a sheet (iPhone) or the inspector (iPad) holds it.
    private func dismiss() { FlightUI.shared.card = nil }
    static let lengths = ["1T", "2T", "3T", "4T", "10M", "15M", "20M", "30M"]

    /// "2 turns", "1 turn", "10 min".
    static func lengthWords(_ code: String) -> String {
        guard let n = Int(code.dropLast()) else { return code }
        return code.hasSuffix("T") ? "\(n) \(n == 1 ? "turn" : "turns")" : "\(n) min"
    }

    private var was: Hold? { plan.hold(at: fix) }
    /// The leg flown to it, for the course and the altitude it is reached at.
    private var legIn: Leg? { plan.legs.first { $0.to.uppercased() == fix.uppercased() } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("The course is", selection: $inbound) {
                        Text("Inbound").tag(true)
                        Text("Outbound").tag(false)
                    }
                    .pickerStyle(.segmented)
                    LabeledContent("Course") {
                        TextField("270", text: $course).keyboardType(.numberPad).multilineTextAlignment(.trailing).font(.body.monospacedDigit())
                    }
                    Picker("Turns", selection: $right) {
                        Text("Right").tag(true)
                        Text("Left").tag(false)
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    Picker("Legs by", selection: $timed) {
                        Text("Time").tag(true)
                        Text("Distance").tag(false)
                    }
                    .pickerStyle(.segmented)
                    if timed {
                        Picker("Leg time", selection: $legMin) {
                            ForEach(Self.legMinutes, id: \.self) { Text("\(String(format: "%g", $0)) min").tag($0) }
                        }
                    } else {
                        Picker("Leg distance", selection: $legNm) {
                            ForEach(Self.legMiles, id: \.self) { Text("\(String(format: "%g", $0)) nm").tag($0) }
                        }
                    }
                    Picker("Hold for", selection: $length) {
                        ForEach(Self.lengths, id: \.self) { Text(Self.lengthWords($0)).tag($0) }
                    }
                }
                Section {
                    Button(was == nil ? "Add Hold" : "Change Hold") { set() }
                        .disabled(degrees == nil)
                    if was != nil {
                        Button("Remove Hold", role: .destructive) { plan.setHold(at: fix, nil); dismiss() }
                    }
                }
            }
            .navigationTitle("Hold at \(fix)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("Close") }
            }
            .onAppear(perform: fill)
        }
    }

    private var degrees: Int? {
        let digits = course.filter(\.isNumber)
        guard digits.count == 3, let deg = Int(digits), deg <= 360 else { return nil }
        return deg
    }

    /// The hold there now, else the course flown to it as the inbound
    /// course -- straight ahead, a direct entry (AIM 5-3-8) -- its magnetic
    /// course the leg's true course less the planner's variation, as the
    /// web app takes it; and the legs' minutes for the altitude it is
    /// reached at (Hold.legMinutes).
    private func fill() {
        if let was {
            course = String(format: "%03d", was.inbound == 0 ? 360 : was.inbound)
            right = was.right
            timed = was.legMin != nil
            legMin = was.legMin ?? 1
            legNm = was.legNm ?? 4
            length = was.turns.map { "\($0)T" } ?? "\(was.minutes ?? 10)M"
        } else if let leg = legIn {
            let magnetic = ((leg.trueCourseDeg - leg.magneticVariationDeg).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
            let rounded = Int(magnetic.rounded()) % 360
            course = String(format: "%03d", rounded == 0 ? 360 : rounded)
            legMin = Hold.legMinutes(altitudeFt: leg.altitudeFt)
        }
    }

    private func set() {
        guard let degrees else { return }
        let inboundDeg = (inbound ? degrees : degrees + 180) % 360
        let n = Int(length.dropLast()) ?? 2
        let hold = Hold(fix: fix, inbound: inboundDeg, right: right, legMin: timed ? legMin : nil, legNm: timed ? nil : legNm,
                        turns: length.hasSuffix("T") ? n : nil, minutes: length.hasSuffix("M") ? n : nil)
        plan.setHold(at: fix, hold)
        dismiss()
    }
}

/// A picked procedure's fixes, each with the chart's altitude: Direct To
/// it, as ATC sends an airplane, or flown as charted again; and the
/// altitude to cross it at, the pilot's own in the chart's place (the web
/// app's FixCard and FixBranch).
struct ProcedureFixesView: View {
    let ident: String
    let id: String
    @Environment(Plan.self) private var plan
    @State private var drawing: ProcedureDrawing?
    @State private var problem: String?

    private var pick: ProcedurePick? { plan.procedures.first { $0.ident == ident && $0.id == id } }

    var body: some View {
        List {
            if let drawing, let pick {
                let direct = plan.extras.procedureDirect["\(ident):\(id)"]
                Section {
                    ForEach(drawing.fixes.filter { $0.missed != true }) { fix in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(fix.ident).font(.headline.monospaced())
                                if let roles = fix.roles, !roles.isEmpty { Text(roles.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary) }
                                Spacer()
                                if let own = plan.extras.crossings[fix.ident.uppercased()] {
                                    Text("\(own.formatted()) ft").font(.subheadline.monospacedDigit()).foregroundStyle(.tint)
                                } else if let charted = fix.charted {
                                    Text(charted).font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                            HStack {
                                Button(direct == fix.ident ? "Fly \(pick.name) as Charted" : "Direct To \(fix.ident)") {
                                    plan.setProcedureDirect(pick, fix: direct == fix.ident ? nil : fix.ident)
                                }
                                .buttonStyle(.bordered)
                                Button("Cross at…") { FlightUI.shared.crossAt = fix.ident }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            } else {
                Text(problem ?? "Fetching its fixes…").foregroundStyle(problem == nil ? Color.secondary : Color.red)
            }
        }
        .navigationTitle(pick?.name ?? id)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard let pick else { return }
            do { drawing = try await Planner.procedure(ident, id: id, transition: pick.transition) } catch { problem = error.localizedDescription }
        }
    }
}
