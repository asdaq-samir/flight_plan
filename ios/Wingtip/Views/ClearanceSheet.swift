import SwiftUI

/// A clearance heard from the radio, or typed, and what the planner found
/// in it, as the web app's ClearanceCard: the pilot reads it here, a
/// place found by its sound only marked, one not found said so, and Enter
/// Route puts it in the route, the expected altitude (else the one to
/// maintain) flown. Nothing heard changes the plan before that.
struct ClearanceSheet: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(\.dismiss) private var dismiss
    @State private var listener = ClearanceListener()
    @State private var words: [String] = []
    @State private var found: ClearancePlaces?
    @State private var foundFor: String?
    @State private var lookupProblem: String?

    /// The route's ends and the pilot's position, for the planner to look
    /// near (its `near`).
    private var near: String {
        var points: [(Double, Double)] = []
        if let course = plan.course {
            points += [(course.departure.lat, course.departure.lon), (course.destination.lat, course.destination.lon)]
        }
        if let fix = ownShip.fix { points.append((fix.coordinate.latitude, fix.coordinate.longitude)) }
        return points.map { String(format: "%.4f,%.4f", $0.0, $0.1) }.joined(separator: ";")
    }

    private var clearance: Clearance { Clearance.read(listener.heard) }

    private var wantsPlaces: Bool {
        let asked = clearance.asked(near: "", dep: "", dest: "")
        return asked.limit != nil || !asked.route.isEmpty || asked.departure != nil || asked.arrival != nil
    }

    private var ready: Bool {
        clearance.heardAny && !listener.listening && (!wantsPlaces || foundFor == listener.heard)
    }

    private static func altitude(_ ft: Int) -> String {
        // AIM 4-2-9: feet below 18,000, a flight level from there up.
        ft >= 18_000 ? "FL\(ft / 100)" : "\(ft.formatted()) ft"
    }

    private func placeText(_ place: ClearancePlaces.Place) -> Text {
        guard let ident = place.ident else { return Text("“\(place.said)”?").foregroundStyle(.red) }
        return place.sure == true ? Text(ident) : Text("\(ident)?").foregroundStyle(.orange)
    }

    private var routeText: Text {
        var parts: [Text] = []
        var run = 0
        for item in clearance.route {
            switch item.kind {
            case "vectors": parts.append(Text("Radar vectors"))
            case "heading": parts.append(Text(String(format: "Heading %03d", item.degrees ?? 0)))
            case "airway": parts.append(Text(item.ident ?? ""))
            case "places":
                let places = found.flatMap { $0.route.flatMap { run < $0.count ? $0[run] : nil } }
                    ?? [ClearancePlaces.Place(said: item.said ?? "", ident: item.said?.uppercased(), sure: true)]
                parts += places.map(placeText)
                run += 1
            default:
                let picked = item.kind == "departure" ? found?.departure : found?.arrival
                parts.append(Text(picked.map { $0.id + ($0.transition.map { ".\($0)" } ?? "") }
                    ?? "\((item.name ?? "").capitalized) \(item.number ?? "") \(item.kind)"))
            }
        }
        if clearance.asFiled { parts.append(Text("as filed")) }
        return parts.enumerated().reduce(Text("")) { all, part in part.offset == 0 ? part.element : all + Text(" → ") + part.element }
    }

    var body: some View {
        @Bindable var listener = listener
        let clearance = clearance
        NavigationStack {
            Form {
                Section {
                    TextField("Tap Listen and hold the phone to the speaker, or type the clearance.", text: $listener.heard, axis: .vertical)
                        .lineLimit(3...6).disabled(listener.listening)
                    if let problem = listener.problem ?? lookupProblem {
                        Text(problem).font(.footnote).foregroundStyle(.red)
                    }
                }
                if clearance.heardAny {
                    Section("Clearance") {
                        if clearance.classB {
                            LabeledContent("Cleared To", value: "Class Bravo airspace")
                        } else if let limit = clearance.limit {
                            LabeledContent("Cleared To") { found?.limit.map(placeText) ?? Text(limit.capitalized) }
                        }
                        if !clearance.route.isEmpty || clearance.asFiled {
                            LabeledContent("Route") { routeText.multilineTextAlignment(.trailing) }
                        }
                        if let ft = clearance.maintainFt {
                            LabeledContent("Maintain", value: (clearance.vfr ? "VFR " : "") + (clearance.maintainLimit.map { "\($0) " } ?? "") + Self.altitude(ft))
                        }
                        if let ft = clearance.expectFt {
                            LabeledContent("Expect", value: Self.altitude(ft) + (clearance.expectMin.map { ", \($0) min after departure" } ?? ""))
                        }
                        if let frequency = clearance.frequency {
                            LabeledContent(clearance.facility?.capitalized ?? "Frequency", value: frequency)
                        }
                        if let squawk = clearance.squawk { LabeledContent("Squawk", value: squawk) }
                    }
                }
            }
            .navigationTitle("Clearance")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { listener.stop(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enter Route") { enter() }.disabled(!ready)
                }
                ToolbarItem(placement: .bottomBar) {
                    Button {
                        if listener.listening { listener.stop() } else { Task { await listener.start(words: words) } }
                    } label: {
                        Label(listener.listening ? "Stop" : "Listen", systemImage: listener.listening ? "stop.circle.fill" : "mic.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .task {
                words = (try? await Planner.clearanceWords(near: near, dep: plan.dep)) ?? []
            }
            .task(id: listener.listening ? "" : listener.heard) {
                // Once the words stop changing, their places looked up.
                guard !listener.listening, wantsPlaces else { return }
                let heard = listener.heard
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled else { return }
                do {
                    found = try await Planner.clearancePlaces(Clearance.read(heard).asked(near: near, dep: plan.dep, dest: plan.dest))
                    foundFor = heard
                    lookupProblem = nil
                } catch {
                    lookupProblem = "The places in it could not be looked up; check the connection and try again."
                }
            }
        }
    }

    private func enter() {
        let clearance = clearance
        let cleared = clearance.clearedRoute(found ?? ClearancePlaces(), dep: plan.dep, stops: plan.stops, dest: plan.dest)
        plan.dest = cleared.dest
        plan.stops = cleared.stops
        for typed in cleared.typed {
            let departure = typed.name == found?.departure?.id
            let field = departure ? cleared.dep : cleared.dest
            let kind = departure ? "departure" : "arrival"
            plan.procedures.removeAll { $0.ident == field && $0.kind == kind }
            plan.procedures.append(ProcedurePick(ident: field, id: typed.name, kind: kind, name: typed.name,
                                                 transition: departure ? typed.after : typed.before))
        }
        if !clearance.vfr, let ft = clearance.expectFt ?? clearance.maintainFt {
            plan.ownAltitudeFt = Double(ft)
            plan.ownAltitudeLegal = false
        }
        plan.plan()
        dismiss()
    }
}
