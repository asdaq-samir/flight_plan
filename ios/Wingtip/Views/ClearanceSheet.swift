import SwiftUI

/// The clearance step, one card as the owner's canvas draws it
/// (2026-11-03): its four parts in a row (Hear, Read back, Enter,
/// Compare), the clearance heard laid out as CRAFT (cleared to, route,
/// altitude, frequency, transponder; AIM 4-4-3 lists what a clearance
/// holds, in that order), the pilot's read back checked line by line by
/// the engine (ReadbackCheck), the route cleared against the one filed
/// (ClearanceCompare), and two buttons: Enter the route, which puts the
/// route in the plan with the expected altitude (else the one to
/// maintain) flown, and Read back again, which listens for the pilot's
/// read back. The raw transcript, typed or heard, folds under them.
/// Nothing heard changes the plan before Enter.
struct ClearanceSheet: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(\.dismiss) private var dismiss
    private var listener: ClearanceListener { ClearanceListener.shared }
    /// The words read: the newest transmission settled while listening,
    /// until the pilot picks one from the log or types.
    @State private var text = ""
    @State private var following = true
    @State private var words: [String] = []
    @State private var found: ClearancePlaces?
    @State private var foundFor: String?
    @State private var lookupProblem: String?
    /// The pilot's read back: the first transmission settled after Read
    /// back again was tapped, or typed in the transcript.
    @State private var readback = ""
    @State private var readingBack = false
    /// The newest transmission's id when Read back again was tapped: the
    /// next one settled is the read back, not a new clearance.
    @State private var readbackAfter = -1
    @State private var transcriptOpen = false

    /// The route's ends and the pilot's position, to look near.
    private var nearPoints: [(Double, Double)] {
        var points: [(Double, Double)] = []
        if let course = plan.course {
            points += [(course.departure.lat, course.departure.lon), (course.destination.lat, course.destination.lon)]
        }
        if let fix = ownShip.fix { points.append((fix.coordinate.latitude, fix.coordinate.longitude)) }
        return points
    }

    /// The same, as the planner's `near`.
    private var near: String {
        nearPoints.map { String(format: "%.4f,%.4f", $0.0, $0.1) }.joined(separator: ";")
    }

    private var clearance: Clearance { Clearance.read(text) }

    private var wantsPlaces: Bool {
        let asked = clearance.asked(near: "", dep: "", dest: "")
        return asked.limit != nil || !asked.route.isEmpty || asked.departure != nil || asked.arrival != nil
    }

    private var ready: Bool {
        clearance.heardAny && (!wantsPlaces || foundFor == text)
    }

    /// The route the clearance gives from the one planned, once its
    /// places are found.
    private var cleared: (dep: String, stops: [String], dest: String, typed: [Clearance.Typed]) {
        Clearance.clearedRoute(text, found ?? ClearancePlaces(), dep: plan.dep, stops: plan.stops, dest: plan.dest)
    }

    private var check: ReadbackCheck? {
        readback.isEmpty ? nil : ReadbackCheck.check(cleared: text, said: readback)
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

    /// The altitudes in one line: "Maintain 5,000 ft, expect 9,000 ft 10
    /// min after departure".
    private var altitudeWords: String? {
        var parts: [String] = []
        if let ft = clearance.maintainFt {
            parts.append("Maintain " + (clearance.vfr ? "VFR " : "") + (clearance.maintainLimit.map { "\($0) " } ?? "") + Self.altitude(ft))
        }
        if let ft = clearance.expectFt {
            parts.append("expect " + Self.altitude(ft) + (clearance.expectMin.map { " \($0) min after departure" } ?? ""))
        }
        guard !parts.isEmpty else { return nil }
        let line = parts.joined(separator: ", ")
        return line.prefix(1).uppercased() + line.dropFirst()
    }

    /// The same for VoiceOver, each altitude in words (SpokenFigures).
    private var altitudeSpoken: String {
        var parts: [String] = []
        if let ft = clearance.maintainFt { parts.append("maintain " + (clearance.vfr ? "VFR " : "") + (clearance.maintainLimit.map { "\($0) " } ?? "") + SpokenFigures.feet(Double(ft))) }
        if let ft = clearance.expectFt { parts.append("expect " + SpokenFigures.feet(Double(ft)) + (clearance.expectMin.map { " \(SpokenFigures.minutes(Double($0))) after departure" } ?? "")) }
        return parts.joined(separator: ", ")
    }

    /// When the clearance shown was heard, where it came off the radio.
    private var heardAt: Date? {
        listener.heard.last { $0.final && $0.text == text }?.at
    }

    /// Where each of the four parts stands.
    private enum Standing { case done, now, later }

    private var parts: [(name: String, standing: Standing)] {
        let heard = clearance.heardAny
        let readBack = heard && !readback.isEmpty
        return [
            ("Hear", heard ? .done : .now),
            ("Read back", readBack ? .done : (heard ? .now : .later)),
            ("Enter", readBack && ready ? .now : .later),
            ("Compare", ready ? .done : .later),
        ]
    }

    var body: some View {
        let clearance = clearance
        NavigationStack {
            Form {
                Section {
                    stepsRow
                    if !clearance.heardAny {
                        heardField
                    }
                    if let problem = listener.problem ?? lookupProblem {
                        Text(problem).font(.footnote).foregroundStyle(.red)
                    }
                } header: {
                    // The flight the clearance is for, as the canvas heads it.
                    Text([plan.dep.isEmpty ? nil : "\(plan.dep) → \(plan.dest)", "IFR", plan.tail].compactMap { $0 }.joined(separator: " · "))
                }
                if clearance.heardAny {
                    // No Play: the listener keeps the words, not the sound.
                    Section {
                        if clearance.classB {
                            craft("Cleared to", Text("Class Bravo airspace"), spoken: "Class Bravo airspace")
                        } else if let limit = clearance.limit {
                            craft("Cleared to", found?.limit.map(placeText) ?? Text(limit.capitalized), spoken: found?.limit?.name ?? limit)
                        }
                        if !clearance.route.isEmpty || clearance.asFiled {
                            craft("Route", routeText, spoken: nil)
                        }
                        if let altitudeWords {
                            craft("Altitude", Text(altitudeWords), spoken: altitudeSpoken)
                        }
                        if let frequency = clearance.frequency {
                            craft("Frequency", Text("\(clearance.facility?.capitalized ?? "") \(frequency)".trimmingCharacters(in: .whitespaces)),
                                  spoken: "\(clearance.facility ?? "") \(SpokenFigures.digits(frequency))")
                        }
                        if let squawk = clearance.squawk {
                            craft("Transponder", Text(squawk), spoken: SpokenFigures.digits(squawk))
                        }
                    } header: {
                        Text(heardAt.map { "Heard \(Formats.time($0))" } ?? "Heard")
                    }
                    Section("Your read back") {
                        if readback.isEmpty {
                            Text(readingBack ? "Listening for your read back…"
                                 : "Read it back to ATC with Read back again, and it is checked here line by line.")
                                .foregroundStyle(.secondary)
                        } else {
                            Text("“\(readback)”").foregroundStyle(.secondary)
                            if let check {
                                ForEach(ReadbackCheck.lines(clearance, check)) { line in
                                    Label {
                                        Text(line.words)
                                    } icon: {
                                        Image(systemName: line.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                            .foregroundStyle(line.ok ? Color.green : Color.orange)
                                            .accessibilityLabel(line.ok ? "Read back" : "Differs")
                                    }
                                    .accessibilityElement(children: .combine)
                                }
                            } else {
                                Text("The read back could not be checked.").foregroundStyle(.secondary)
                            }
                        }
                    }
                    if ready {
                        let cleared = cleared
                        let difference = ClearanceCompare.describe(plannedStops: plan.stops, plannedDest: plan.dest,
                                                                   clearedStops: cleared.stops, clearedDest: cleared.dest, typed: cleared.typed)
                        Section {
                            Label {
                                difference.same ? Text(difference.words)
                                    : Text("Differs from what you filed: ").bold() + Text(difference.words)
                            } icon: {
                                Image(systemName: difference.same ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                    .foregroundStyle(difference.same ? Color.green : Color.orange)
                                    .accessibilityLabel(difference.same ? "As filed" : "Differs")
                            }
                            .accessibilityElement(children: .combine)
                        }
                        .listRowBackground(difference.same ? nil : Color.orange.opacity(0.12))
                    }
                    Section {
                        HStack(spacing: 10) {
                            Button("Enter the route") { enter() }
                                .buttonStyle(.borderedProminent)
                                .disabled(!ready)
                            Button("Read back again") { readBackAgain() }
                                .buttonStyle(.bordered)
                        }
                        .controlSize(.large)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    } footer: {
                        Text("The words are the engine's reading of what was heard (AIM 4-4-3); nothing enters the plan until you tap Enter.")
                    }
                    Section {
                        DisclosureGroup("Transcript", isExpanded: $transcriptOpen) {
                            heardField
                            TextField("Your read back, as said", text: $readback, axis: .vertical)
                                .lineLimit(2...6)
                            heardLog
                        }
                    }
                } else {
                    Section { heardLog }
                }
            }
            .navigationTitle("Clearance")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // Listening goes on with the sheet put away: the
                    // captions over the map carry it, and Stop ends it.
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button {
                        if listener.listening { listener.stop() } else { following = true; Task { await listener.start(words: words) } }
                    } label: {
                        Label(listener.listening ? "Stop" : "Listen", systemImage: listener.listening ? "stop.circle.fill" : "mic.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .task {
                words = (try? await Planner.clearanceWords(near: near, dep: plan.dep)) ?? []
            }
            .onAppear { if let given = listener.sheetText { text = given; following = false } }
            .onChange(of: listener.heard.last(where: \.final)?.text) { _, newest in
                guard let newest else { return }
                if readingBack, let last = listener.heard.last(where: \.final), last.id > readbackAfter {
                    readback = newest
                    readingBack = false
                } else if following {
                    text = newest
                }
            }
            .task(id: text) {
                // Once the words stop changing, their places looked up.
                guard wantsPlaces else { return }
                let heard = text
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled else { return }
                do {
                    found = try await Planner.clearancePlaces(Clearance.read(heard).asked(near: near, dep: plan.dep, dest: plan.dest))
                    foundFor = heard
                    lookupProblem = nil
                } catch {
                    // No signal: found by the engine among the places of
                    // the regions kept for the air, SIDs and STARs left
                    // as said.
                    let packs = CyclePacks.shared.keptPacks()
                    let offline = Engine.hear(heard, tail: nil, packs: packs, near: nearPoints,
                                              dep: plan.dep, stops: plan.stops, dest: plan.dest)
                    if let offline, !packs.isEmpty {
                        found = offline.found
                        foundFor = heard
                        lookupProblem = "No signal: places found among the regions kept for the air."
                    } else {
                        lookupProblem = "The places in it could not be looked up; check the connection and try again."
                    }
                }
            }
        }
    }

    /// The four parts of the step in a row: done in green, the one now in
    /// the tint, the rest to come.
    private var stepsRow: some View {
        HStack(spacing: 6) {
            ForEach(Array(parts.enumerated()), id: \.offset) { i, part in
                Text("\(i + 1) \(part.name)")
                    .font(.caption)
                    .fontWeight(part.standing == .later ? .regular : .semibold)
                    .foregroundStyle(part.standing == .done ? Color.green : part.standing == .now ? Color.accentColor : Color.secondary)
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("\(part.name), \(part.standing == .done ? "done" : part.standing == .now ? "now" : "to come")")
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// The clearance's words, to type or to read as heard.
    private var heardField: some View {
        TextField("Tap Listen and hold the phone to the speaker, or type the clearance.",
                  text: Binding(get: { text }, set: { text = $0; following = false }), axis: .vertical)
            .lineLimit(3...6)
    }

    /// The radio as heard, newest first, a call to us in the tint: a tap
    /// reads that one above.
    @ViewBuilder private var heardLog: some View {
        let log = listener.heard.filter(\.final).reversed().prefix(10)
        ForEach(Array(log)) { t in
            Button {
                text = t.text
                following = false
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.text).foregroundStyle(t.forUs ? Color.accentColor : Color.primary).fontWeight(t.forUs ? .semibold : .regular)
                    Text(t.at, style: .time).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    /// One CRAFT line, its figures said in words to VoiceOver where the
    /// screen writes them as figures.
    private func craft(_ name: String, _ value: Text, spoken: String?) -> some View {
        LabeledContent(name) { value.multilineTextAlignment(.trailing).fontWeight(.semibold) }
            .accessibilityElement(children: spoken == nil ? .combine : .ignore)
            .accessibilityLabel(spoken.map { "\(name), \($0)" } ?? "")
    }

    /// Listens for the pilot's read back: the next transmission settled
    /// is it, the clearance shown kept as it is.
    private func readBackAgain() {
        following = false
        readback = ""
        readingBack = true
        readbackAfter = listener.heard.last?.id ?? -1
        // The radio already listened to gives the next transmission
        // (onChange above); otherwise the microphone opens for this one
        // read back alone, kept out of the radio's log.
        if !listener.listening {
            Task {
                let said = await listener.hearOnce(words: words)
                if readingBack { readback = said ?? ""; readingBack = false }
            }
        }
    }

    private func enter() {
        let clearance = clearance
        let cleared = cleared
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

#Preview("ClearanceSheet") {
    ClearanceSheet()
        .environment(Plan())
        .environment(OwnShip())
}
