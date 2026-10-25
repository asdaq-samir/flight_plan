import SwiftUI

/// The pilot's own airplanes (the web app's AircraftPanel): a row each,
/// the one the nav log flies ticked, a tap opening its figures to edit,
/// and New Airplane at the top. Each airplane's page has its checklist,
/// squawks, inspections and VOR check, and Delete, asked first.
struct OwnAircraftListView: View {
    @Environment(Plan.self) private var plan
    @State private var list: [OwnAircraftRecord]?
    @State private var problem: String?
    @State private var adding = false

    var body: some View {
        List {
            if let list {
                if list.isEmpty {
                    ContentUnavailableView("No Airplanes", systemImage: "airplane", description: Text("Add yours with its handbook's figures."))
                }
                ForEach(list) { airplane in
                    NavigationLink {
                        OwnAircraftPage(record: airplane, onChange: { Task { await load() } })
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(airplane.tailNumber).font(.headline.monospaced())
                                    Text(airplane.typeDesignator).foregroundStyle(.secondary)
                                }
                                Text(OwnAircraftPage.figuresLine(airplane)).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if plan.tail == airplane.tailNumber.uppercased() { Image(systemName: "checkmark").foregroundStyle(.tint) }
                        }
                    }
                }
            } else if problem == nil {
                ProgressView()
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("Your Airplanes")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { adding = true } label: { Label("New Airplane", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $adding) {
            NavigationStack { AircraftFormView(record: nil) { _ in Task { await load() } } }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do { list = try await Gateway.aircraftRecords(); problem = nil } catch { problem = error.localizedDescription }
    }
}

/// The figures, the flight plan's items and Save (the web app's form):
/// a new airplane in a sheet with Cancel and Add, one of the pilot's
/// with Save.
struct AircraftFormView: View {
    let record: OwnAircraftRecord?
    var onSaved: (OwnAircraftRecord) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var form = AircraftForm()
    @State private var saving = false
    @State private var problem: String?
    @State private var tried = false

    var body: some View {
        let problems = tried ? form.problems : [:]
        Form {
            Section {
                field("Tail number", text: $form.tailNumber, placeholder: "N12345", key: "tailNumber", problems: problems, codes: true)
                field("Type", text: $form.typeDesignator, placeholder: "C172", key: "typeDesignator", problems: problems, codes: true)
            }
            Section("True airspeed") {
                number("Climb", unit: "kt", text: $form.climbTasKt, placeholder: "74", key: "climbTasKt", problems: problems)
                number("Cruise", unit: "kt", text: $form.cruiseTasKt, placeholder: "110", key: "cruiseTasKt", problems: problems)
            }
            // Climb left blank climbs at the type's book figures.
            Section("Fuel burn") {
                number("Climb", unit: "gph", text: $form.climbFuelBurnGph, placeholder: "11", key: "climbFuelBurnGph", problems: problems)
                number("Cruise", unit: "gph", text: $form.fuelBurnGph, placeholder: "8.5", key: "fuelBurnGph", problems: problems)
            }
            // The cruise figures are the airplane's at this power at the
            // planner's reference altitude on a standard day, a row of its
            // handbook's cruise table (vfr.performance, CRUISE_REFERENCE_FT).
            Section("Cruise figures at 6,000 ft, standard day") {
                number("Cruise power", unit: "%", text: $form.cruisePowerPct, placeholder: "65", key: "cruisePowerPct", problems: problems)
            }
            // Without usable fuel the nav log makes no fuel check.
            Section {
                number("Usable fuel", unit: "gal", text: $form.usableFuelGal, placeholder: "40", key: "usableFuelGal", problems: problems)
            }
            // FAA Form 7233-4's items (AIM Appendix 4): 10a equipment, 10b
            // surveillance, 19 colour and markings.
            Section("Flight plan") {
                field("Equipment", text: $form.equipment, placeholder: "SDFGRY", key: "equipment", problems: problems, codes: true)
                field("Surveillance", text: $form.surveillance, placeholder: "B1", key: "surveillance", problems: problems, codes: true)
                field("Color", text: $form.colour, placeholder: "White, blue stripe", key: "colour", problems: problems, codes: false)
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle(record == nil ? "New Airplane" : "Edit Airplane")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if record == nil {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(record == nil ? "Add" : "Save") { Task { await save() } }.disabled(saving)
            }
        }
        .onAppear { if let record, form == AircraftForm() { form = AircraftForm(record) } }
    }

    private func field(_ title: String, text: Binding<String>, placeholder: String, key: String, problems: [String: String], codes: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            LabeledContent(title) {
                TextField(placeholder, text: text)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(codes ? .characters : .sentences)
                    .autocorrectionDisabled(codes)
                    .font(codes ? .body.monospaced() : .body)
            }
            if let p = problems[key] { Text(p).font(.footnote).foregroundStyle(.red) }
        }
    }

    private func number(_ title: String, unit: String, text: Binding<String>, placeholder: String, key: String, problems: [String: String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            LabeledContent(title) {
                HStack(spacing: 4) {
                    TextField(placeholder, text: text).multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                    Text(unit).foregroundStyle(.secondary)
                }
            }
            if let p = problems[key] { Text(p).font(.footnote).foregroundStyle(.red) }
        }
    }

    private func save() async {
        tried = true
        guard let request = form.request else { return }
        saving = true
        defer { saving = false }
        do {
            let saved: OwnAircraftRecord
            if let record { saved = try await Gateway.updateAircraft(record.id, request) } else { saved = try await Gateway.addAircraft(request) }
            problem = nil
            onSaved(saved)
            if record == nil { dismiss() }
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// One of the pilot's airplanes: its figures to edit, its checklist and
/// squawks, its inspections and VOR check, and Delete.
struct OwnAircraftPage: View {
    @State var record: OwnAircraftRecord
    var onChange: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var askingDelete = false
    @State private var problem: String?

    static func figuresLine(_ a: OwnAircraftRecord) -> String {
        var line = "Cruise \(a.cruiseTasKt.formatted()) kt, \(a.fuelBurnGph.formatted()) gph"
        if let p = a.cruisePowerPct { line += " at \(p.formatted())%" }
        if let u = a.usableFuelGal { line += " · \(u.formatted()) gal usable" }
        return line
    }

    var body: some View {
        List {
            Section {
                NavigationLink {
                    AircraftFormView(record: record) { saved in record = saved; onChange() }
                } label: {
                    LabeledContent("Figures", value: Self.figuresLine(record)).lineLimit(2)
                }
                NavigationLink("Checklist") { ChecklistView(aircraft: record) }
                NavigationLink {
                    SquawksView(aircraft: record) { Task { await reload() } }
                } label: {
                    LabeledContent("Squawks", value: (record.openSquawks?.isEmpty ?? true) ? "" : "\(record.openSquawks!.count) open")
                }
            }
            InspectionsSection(record: $record, onChange: onChange)
            VorCheckSection(record: $record, onChange: onChange)
            Section {
                Button("Delete Airplane", role: .destructive) { askingDelete = true }
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle(record.tailNumber)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Delete \(record.tailNumber)?", isPresented: $askingDelete, titleVisibility: .visible) {
            Button("Delete Airplane", role: .destructive) {
                Task {
                    do { try await Gateway.deleteAircraft(record.id); onChange(); dismiss() } catch { problem = error.localizedDescription }
                }
            }
        } message: {
            Text("It goes from your airplanes and from the nav log's picker. This can't be undone.")
        }
    }

    private func reload() async {
        if let fresh = try? await Gateway.aircraftRecords().first(where: { $0.id == record.id }) { record = fresh }
        onChange()
    }
}

/// A date the pilot may leave unsaid: a button to give one, then the
/// system's date picker with a way to take it off again.
struct OptionalDayRow: View {
    let title: String
    @Binding var day: String?
    var upTo: Date? = nil

    var body: some View {
        if let value = day, let date = Day.date(value) {
            HStack {
                DatePicker(title, selection: Binding(get: { date }, set: { day = Day.string($0) }),
                           in: ...(upTo ?? .distantFuture), displayedComponents: .date)
                Button { day = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear \(title.lowercased())")
            }
        } else {
            LabeledContent(title) {
                Button("Add Date") { day = Day.today() }.buttonStyle(.borderless)
            }
        }
    }
}

/// How a last good day stands today: green to it, red past it. The day
/// is the gateway's.
struct StandingText: View {
    let through: String?
    var good = "To"
    var past = "Past due since"

    var body: some View {
        if let through {
            let current = Day.current(through)
            Text("\(current ? good : past) \(Day.said(through))").foregroundStyle(current ? Color.green : Color.red)
        }
    }
}

/// The airplane's inspections and tests from its maintenance records,
/// each with the last day it is good for as the gateway works it out --
/// what the risk assessment reads for whether it may be flown. Saved
/// together.
struct InspectionsSection: View {
    @Binding var record: OwnAircraftRecord
    var onChange: () -> Void
    @State private var form = InspectionsRequest(nil)
    @State private var hoursAt = ""
    @State private var hoursNow = ""
    @State private var saving = false
    @State private var problem: String?
    @State private var loaded = false

    // The rule that asks for each: the annual, 12 calendar months, 14 CFR
    // 91.409(a); the altimeter and static, 24 calendar months for IFR,
    // 91.411; the transponder, 24 calendar months, 91.413; the ELT, 12
    // calendar months, 91.207(d).
    private var dated: [(title: String, rule: String, on: WritableKeyPath<InspectionsRequest, String?>, through: String?)] {
        let i = record.inspections
        return [
            ("Annual", "12 calendar months, 14 CFR 91.409(a)", \.annualOn, i?.annualGoodThrough),
            ("Altimeter and static", "24 calendar months, for IFR, 91.411", \.staticCheckOn, i?.staticCheckGoodThrough),
            ("Transponder", "24 calendar months, 91.413", \.transponderCheckOn, i?.transponderCheckGoodThrough),
            ("ELT inspection", "12 calendar months, 91.207(d)", \.eltInspectedOn, i?.eltInspectionGoodThrough),
        ]
    }

    var body: some View {
        // The 100-hour is owed only when the airplane is flown for hire, or
        // for instruction in it by the one who provides it (91.409(b)); the
        // ELT's not on a training flight within 50 nm (91.207(f)).
        Section("Inspections") {
            ForEach(dated, id: \.title) { d in
                VStack(alignment: .leading, spacing: 2) {
                    OptionalDayRow(title: d.title, day: Binding(get: { form[keyPath: d.on] }, set: { form[keyPath: d.on] = $0 }), upTo: Date())
                    HStack(spacing: 4) {
                        Text(d.rule)
                        if d.through != nil { Text("·"); StandingText(through: d.through) }
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                OptionalDayRow(title: "ELT battery replace by", day: $form.eltBatteryDueOn)
                HStack(spacing: 4) {
                    Text("As marked on the transmitter, 91.207(c)")
                    if let due = record.inspections?.eltBatteryDueOn { Text("·"); StandingText(through: due, good: "By", past: "Due since") }
                }
                .font(.footnote).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 2) {
                LabeledContent("Hours at last 100-hour") {
                    TextField("0", text: $hoursAt).multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                }
                Text(hundredHourLine).font(.footnote).foregroundStyle(.secondary)
            }
            LabeledContent("Hours now") {
                TextField("0", text: $hoursNow).multilineTextAlignment(.trailing).keyboardType(.decimalPad)
            }
            Button(saving ? "Saving…" : "Save Inspections") { Task { await save() } }.disabled(saving)
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            form = InspectionsRequest(record.inspections)
            hoursAt = record.inspections?.hundredHourAtHours.map { String($0) } ?? ""
            hoursNow = record.inspections?.hoursNow.map { String($0) } ?? ""
        }
    }

    /// The gateway's due hours, and how many are left by the hours recorded.
    private var hundredHourLine: String {
        guard let due = record.inspections?.hundredHourDueAtHours else { return "Time in service, at the last annual or 100-hour" }
        var line = String(format: "Due at %.1f h", due)
        if let now = record.inspections?.hoursNow { line += now < due ? String(format: ", %.1f h to go", due - now) : ", due now" }
        return line
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var request = form
        request.hundredHourAtHours = Double(hoursAt.trimmingCharacters(in: .whitespaces))
        request.hoursNow = Double(hoursNow.trimmingCharacters(in: .whitespaces))
        do { record = try await Gateway.saveInspections(record.id, request); problem = nil; onChange() } catch { problem = error.localizedDescription }
    }
}

/// The airplane's VOR check for IFR (14 CFR 91.171): the last one and the
/// day the gateway says it is good to, and the next recorded with the
/// date, kind, place and error 91.171(d) asks for.
struct VorCheckSection: View {
    @Binding var record: OwnAircraftRecord
    var onChange: () -> Void
    @State private var checkedOn = Date()
    @State private var kind = "VOT"
    @State private var place = ""
    @State private var errorText = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        Section("VOR check") {
            if let last = record.vorCheck {
                LabeledContent {
                    if !last.withinLimit {
                        Text("Over \(last.limitDeg.formatted())°").foregroundStyle(.red)
                    } else {
                        StandingText(through: last.goodThrough, good: "To", past: "Ended")
                    }
                } label: {
                    Text("Last check")
                    Text([Day.said(last.checkedOn), VorCheckKind.label(last.kind), last.place, "\(last.errorDeg.formatted())°"].compactMap { $0 }.joined(separator: " · "))
                }
            } else {
                LabeledContent("Last check", value: "None recorded")
            }
            DatePicker("Checked on", selection: $checkedOn, in: ...Date(), displayedComponents: .date)
            Picker("How", selection: $kind) {
                ForEach(VorCheckKind.all, id: \.value) { k in Text("\(k.label) (±\(k.limitDeg)°)").tag(k.value) }
            }
            LabeledContent("Where") { TextField("KDLH VOT", text: $place).multilineTextAlignment(.trailing) }
            LabeledContent("Bearing error") {
                HStack(spacing: 4) {
                    TextField("0", text: $errorText).multilineTextAlignment(.trailing).keyboardType(.numbersAndPunctuation)
                    Text("°").foregroundStyle(.secondary)
                }
            }
            Button(saving ? "Recording…" : "Record Check") { Task { await recordCheck() } }.disabled(saving)
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
    }

    private func recordCheck() async {
        saving = true
        defer { saving = false }
        let trimmed = place.trimmingCharacters(in: .whitespaces)
        let request = VorCheckRequest(checkedOn: Day.string(checkedOn), errorDeg: Double(errorText.trimmingCharacters(in: .whitespaces)) ?? 0,
                                      kind: kind, place: trimmed.isEmpty ? nil : trimmed)
        do { record = try await Gateway.recordVorCheck(record.id, request); problem = nil; onChange() } catch { problem = error.localizedDescription }
    }
}

/// An airplane's checklist, as its owner writes it from the flight manual:
/// run, each item ticked as it is done, a section's count by its title --
/// or written as plain text (ChecklistText). The ticks are this run's.
struct ChecklistView: View {
    let aircraft: OwnAircraftRecord
    @State private var checklist: Checklist?
    @State private var ticked: Set<String> = []
    @State private var writing: String?
    @State private var problem: String?
    @State private var saving = false

    var body: some View {
        List {
            if let writing {
                Section {
                    TextEditor(text: Binding(get: { writing }, set: { self.writing = $0 }))
                        .font(.body.monospaced())
                        .frame(minHeight: 280)
                        .accessibilityLabel("\(aircraft.tailNumber) checklist")
                } footer: {
                    Text("# Before takeoff\nFuel selector -- Both\nMixture -- Rich").font(.footnote.monospaced())
                }
                Section {
                    Button(saving ? "Saving…" : "Save Checklist") { Task { await save(writing) } }.disabled(saving)
                    Button("Cancel") { self.writing = nil }
                }
            } else if let checklist {
                if checklist.sections.isEmpty { Text("No checklist yet").foregroundStyle(.secondary) }
                ForEach(Array(checklist.sections.enumerated()), id: \.offset) { s, section in
                    Section {
                        ForEach(Array(section.items.enumerated()), id: \.offset) { i, item in
                            let key = "\(s):\(i)"
                            let on = ticked.contains(key)
                            Button {
                                if on { ticked.remove(key) } else { ticked.insert(key) }
                            } label: {
                                HStack {
                                    Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? Color.accentColor : Color.secondary)
                                    Text(item.challenge).foregroundStyle(on ? .secondary : .primary)
                                    Spacer()
                                    if let response = item.response { Text(response).foregroundStyle(.secondary) }
                                }
                            }
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    } header: {
                        HStack {
                            Text(section.title)
                            Spacer()
                            Text("\(section.items.indices.filter { ticked.contains("\(s):\($0)") }.count) of \(section.items.count)").monospacedDigit()
                        }
                    }
                }
                Section {
                    if !checklist.sections.isEmpty {
                        Button("Start Over") { ticked = [] }.disabled(ticked.isEmpty)
                    }
                    Button(checklist.sections.isEmpty ? "Write the Checklist" : "Edit the Checklist") { writing = ChecklistText.text(of: checklist) }
                }
            } else if problem == nil {
                ProgressView()
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("\(aircraft.tailNumber) Checklist")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { checklist = try await Gateway.checklist(aircraft.id) } catch { problem = "The checklist could not be fetched: \(error.localizedDescription)" }
        }
    }

    private func save(_ text: String) async {
        saving = true
        defer { saving = false }
        do {
            checklist = try await Gateway.saveChecklist(aircraft.id, ChecklistText.parse(text))
            writing = nil
            ticked = []
            problem = nil
        } catch { problem = error.localizedDescription }
    }
}

/// An airplane's squawks: written as they are found, open until fixed. An
/// instrument or equipment that does not work is marked so, with the
/// kinds of flight its 14 CFR 91.213(d) determination covers -- not
/// required for them, removed or deactivated and placarded, no hazard --
/// as the risk assessment reads it.
struct SquawksView: View {
    let aircraft: OwnAircraftRecord
    var onChange: () -> Void
    @State private var squawks: [Squawk]?
    @State private var text = ""
    @State private var foundOn = Date()
    @State private var inoperative = false
    @State private var deferredFor: String?
    @State private var fixing: Squawk?
    @State private var fixNote = ""
    @State private var problem: String?
    @State private var busy = false

    var body: some View {
        List {
            if let squawks {
                let open = squawks.filter { $0.fixedOn == nil }
                Section("Open") {
                    if open.isEmpty { Text("None open").foregroundStyle(.secondary) }
                    ForEach(open) { s in
                        Button {
                            fixing = s
                            fixNote = ""
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.text).foregroundStyle(.primary)
                                Text([Day.said(s.reportedOn), Deferral.standing(s)].compactMap { $0 }.joined(separator: " · "))
                                    .font(.footnote).foregroundStyle(s.inoperative && s.deferredFor == nil ? Color.red : Color.secondary)
                            }
                        }
                    }
                }
                if let fixing {
                    Section("Fix: \(fixing.text)") {
                        TextField("What was done, and by whom", text: $fixNote, axis: .vertical).lineLimit(2...5)
                        Button("Fixed Today") { Task { await fix(fixing) } }.disabled(busy)
                        Button("Cancel") { self.fixing = nil }
                    }
                }
                // Without a minimum equipment list, inoperative equipment may
                // be deferred for the kinds of flight it is not required for,
                // removed or deactivated and placarded INOPERATIVE, by a pilot
                // or a mechanic who finds it no hazard (14 CFR 91.213(d)).
                Section("Write a squawk") {
                    TextField("What was found", text: $text, axis: .vertical).lineLimit(1...4)
                    DatePicker("Found on", selection: $foundOn, in: ...Date(), displayedComponents: .date)
                    Toggle("Inoperative equipment", isOn: $inoperative)
                        .onChange(of: inoperative) { _, on in if !on { deferredFor = nil } }
                    if inoperative {
                        Picker("91.213(d)", selection: $deferredFor) {
                            ForEach(Deferral.reaches, id: \.label) { r in Text(r.label).tag(r.value) }
                        }
                    }
                    Button("Write It") { Task { await add() } }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                }
                let fixed = squawks.filter { $0.fixedOn != nil }
                if !fixed.isEmpty {
                    Section("Fixed") {
                        ForEach(fixed) { s in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.text)
                                Text((["Fixed \(Day.said(s.fixedOn ?? ""))"] + [s.fixNote].compactMap { $0 }).joined(separator: " · "))
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        .onDelete { at in
                            let gone = at.map { fixed[$0] }
                            Task {
                                for s in gone { try? await Gateway.deleteSquawk(aircraft.id, s.id) }
                                await load()
                            }
                        }
                    }
                }
            } else if problem == nil {
                ProgressView()
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("\(aircraft.tailNumber) Squawks")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do { squawks = try await Gateway.squawks(aircraft.id); problem = nil } catch { problem = "The squawks could not be fetched: \(error.localizedDescription)" }
    }

    private func add() async {
        busy = true
        defer { busy = false }
        let request = SquawkRequest(reportedOn: Day.string(foundOn), text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                                    inoperative: inoperative, deferredFor: inoperative ? deferredFor : nil)
        do {
            _ = try await Gateway.addSquawk(aircraft.id, request)
            text = ""; inoperative = false; deferredFor = nil
            await load()
            onChange()
        } catch { problem = error.localizedDescription }
    }

    private func fix(_ s: Squawk) async {
        busy = true
        defer { busy = false }
        var request = s.request
        request.fixedOn = Day.today()
        let note = fixNote.trimmingCharacters(in: .whitespacesAndNewlines)
        request.fixNote = note.isEmpty ? nil : note
        do {
            _ = try await Gateway.updateSquawk(aircraft.id, s.id, request)
            fixing = nil
            await load()
            onChange()
        } catch { problem = error.localizedDescription }
    }
}
