import SwiftUI
import UniformTypeIdentifiers

/// "To 19 Dec 2026" in green, or "Ended …" or "Not current" in red: a day
/// the gateway worked out, against today.
struct UntilText: View {
    let date: String?

    var body: some View {
        let current = Day.current(date)
        Text(date.map { current ? "To \(Day.said($0))" : "Ended \(Day.said($0))" } ?? "Not current")
            .monospacedDigit()
            .foregroundStyle(current ? Color.green : Color.red)
    }
}

/// The pilot's logbook and their currency (the web app's LogbookPanel):
/// where they stand first -- passengers by day and at night (14 CFR
/// 61.57(a), (b)), the flight review (61.56) and the medical with the
/// dates they give, instrument currency (61.57(c), (d)) with the last
/// proficiency check -- all worked out by the gateway; then the totals,
/// the file in and out, and the flights, newest first, each opened to
/// change and swiped away, asked first.
struct LogbookView: View {
    @Environment(Session.self) private var session
    @Environment(Plan.self) private var plan
    @State private var entries: [LogbookEntry]?
    @State private var currency: Currency?
    @State private var reminders: Reminders?
    @State private var problem: String?
    @State private var editing: Editing?
    @State private var toDelete: LogbookEntry?
    @State private var importing = false
    @State private var imported: String?
    @State private var exportFile: URL?

    /// The flight in the form: a new one, or one logged.
    struct Editing: Identifiable {
        var id: Int64? = nil
        var entry: LogbookEntryRequest
    }

    var body: some View {
        List {
            if !session.signedIn {
                ContentUnavailableView("Sign in for your logbook", systemImage: "book.closed", description: Text("Your logbook and currency are kept with your account."))
            } else {
                currencySection
                instrumentSection
                if let currency, currency.flights > 0 {
                    Section("Totals") {
                        LabeledContent("Total", value: String(format: "%.1f h", currency.totalHours))
                        LabeledContent("Night", value: String(format: "%.1f h", currency.nightHours))
                        LabeledContent("Cross-country", value: String(format: "%.1f h", currency.crossCountryHours))
                        LabeledContent("Landings", value: "\(currency.landings)")
                    }
                }
                // A CSV file: ForeFlight's logbook export, or this logbook's
                // own; a flight already here is not added twice (the gateway's
                // same day, airplane, route and time).
                Section("File") {
                    if let imported { Text(imported).font(.footnote).foregroundStyle(.secondary) }
                    Button { importing = true } label: { Label("Import a Logbook", systemImage: "square.and.arrow.down") }
                    if let exportFile {
                        ShareLink(item: exportFile) { Label("Export as CSV", systemImage: "square.and.arrow.up") }
                    }
                }
                Section("Flights") {
                    if let entries {
                        if entries.isEmpty { Text("No flights logged yet: the plus logs one.").foregroundStyle(.secondary) }
                        ForEach(entries) { e in
                            Button { editing = Editing(id: e.id, entry: LogbookEntryRequest(e)) } label: { row(e) }
                                .foregroundStyle(.primary)
                                .swipeActions {
                                    Button("Delete", role: .destructive) { toDelete = e }
                                }
                        }
                    } else if problem == nil {
                        ProgressView()
                    }
                }
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("Logbook")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if session.signedIn {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { editing = Editing(entry: .blank(aircraft: plan.tail)) } label: { Label("Log a Flight", systemImage: "plus") }
                }
            }
        }
        .sheet(item: $editing) { e in
            NavigationStack {
                LogbookEntryForm(entry: e.entry, isNew: e.id == nil) { saved in
                    if let id = e.id { try await Gateway.updateLogbookEntry(id, saved) } else { try await Gateway.addLogbookEntry(saved) }
                    await load()
                }
            }
        }
        .confirmationDialog("Take this flight out of the logbook?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }),
                            titleVisibility: .visible, presenting: toDelete) { e in
            Button("Delete", role: .destructive) {
                Task {
                    do { try await Gateway.deleteLogbookEntry(e.id); await load() } catch { problem = error.localizedDescription }
                }
            }
        } message: { _ in
            Text("It goes from your logbook and your currency. This can't be undone.")
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            Task { await bringIn(result) }
        }
        .task(id: session.signedIn) { await load() }
        .refreshable { await load() }
    }

    private func row(_ e: LogbookEntry) -> some View {
        let landings = e.dayLandings + e.nightLandings
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(Day.said(e.flownOn) + (e.route.map { " · \($0)" } ?? "")).font(.headline)
                Spacer()
                Text(String(format: "%.1f h", e.totalHours)).font(.subheadline.monospacedDigit())
            }
            Text(([e.aircraft, e.aircraftType, "\(landings) landing\(landings == 1 ? "" : "s")", e.remarks].compactMap { $0 }.filter { !$0.isEmpty })
                .joined(separator: " · "))
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    // From the logbook and the dates the pilot gives, no one's sign-off:
    // 61.57(a) counts takeoffs and landings in the same category and class
    // in 90 days; (b) at night, to a full stop; 61.56(c) the flight review
    // within 24 calendar months.
    @ViewBuilder private var currencySection: some View {
        Section("Currency") {
            LabeledContent {
                UntilText(date: currency?.dayPassengersUntil)
            } label: {
                Text("Passengers by day")
                Text("3 takeoffs and landings in 90 days")
            }
            LabeledContent {
                UntilText(date: currency?.nightPassengersUntil)
            } label: {
                Text("Passengers at night")
                Text("3 to a full stop at night in 90 days")
            }
            VStack(alignment: .leading, spacing: 2) {
                OptionalDayRow(title: "Flight review", day: dateBinding(\.flightReviewOn), upTo: Date())
                if let until = currency?.flightReviewUntil { UntilText(date: until).font(.footnote) } else {
                    Text("Within 24 calendar months").font(.footnote).foregroundStyle(.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                OptionalDayRow(title: "Medical expires", day: dateBinding(\.medicalExpiresOn))
                if let on = currency?.medicalExpiresOn { UntilText(date: on).font(.footnote) } else {
                    Text("The day it expires").font(.footnote).foregroundStyle(.secondary)
                }
            }
            Toggle(isOn: Binding(get: { reminders?.on ?? false }, set: { on in Task { await remind(on) } })) {
                Text("Email reminders")
                Text("30 and 7 days before each runs out")
            }
            .disabled(reminders == nil)
        }
    }

    // 14 CFR 61.57(c): six approaches, holding and tracking in the 6
    // calendar months before the month flown; more than six months past,
    // only an instrument proficiency check restores it (61.57(d)). The
    // gateway counts both.
    @ViewBuilder private var instrumentSection: some View {
        Section("Instrument") {
            LabeledContent {
                if let after = currency?.ipcNeededAfter, after < Day.today() {
                    Text("IPC needed").foregroundStyle(.red)
                } else {
                    UntilText(date: currency?.instrumentCurrentUntil)
                }
            } label: {
                Text("Instrument currency")
                Text("\(currency?.approachesInWindow ?? 0) of 6 approaches\(currency?.holdingInWindow == true ? ", holding" : "")\(currency?.trackingInWindow == true ? ", tracking" : "") in the window")
            }
            OptionalDayRow(title: "Proficiency check", day: dateBinding(\.ipcOn), upTo: Date())
        }
    }

    /// One of the dates the pilot gives, saved as it changes, the others
    /// sent as they stand.
    private func dateBinding(_ key: WritableKeyPath<CurrencyDatesRequest, String?>) -> Binding<String?> {
        let now = CurrencyDatesRequest(flightReviewOn: currency?.flightReviewOn, medicalExpiresOn: currency?.medicalExpiresOn, ipcOn: currency?.ipcOn)
        return Binding(get: { now[keyPath: key] }, set: { value in
            var next = now
            next[keyPath: key] = value
            Task {
                do { currency = try await Gateway.setCurrencyDates(next) } catch { problem = error.localizedDescription }
            }
        })
    }

    private func remind(_ on: Bool) async {
        do { reminders = try await Gateway.setReminders(on) } catch { problem = error.localizedDescription }
    }

    private func load() async {
        guard session.signedIn else { entries = nil; currency = nil; return }
        do {
            let list = try await Gateway.logbook()
            entries = list
            currency = try await Gateway.currency()
            reminders = try? await Gateway.reminders()
            problem = nil
            exportFile = Self.write(list)
        } catch { problem = "Your logbook could not be fetched: \(error.localizedDescription)" }
    }

    /// The logbook as a file to share, named for today.
    private static func write(_ entries: [LogbookEntry]) -> URL? {
        guard !entries.isEmpty else { return nil }
        let url = FileManager.default.temporaryDirectory.appending(path: "logbook-\(Day.today()).csv")
        do { try LogbookCSV.csv(entries).write(to: url, atomically: true, encoding: .utf8); return url } catch { return nil }
    }

    /// A CSV picked in Files: read on the phone (LogbookCSV), sent as
    /// entries, and what was left out said in a line.
    private func bringIn(_ result: Result<URL, any Error>) async {
        do {
            let url = try result.get()
            let opened = url.startAccessingSecurityScopedResource()
            defer { if opened { url.stopAccessingSecurityScopedResource() } }
            let text = try String(contentsOf: url, encoding: .utf8)
            let read = LogbookCSV.read(text)
            let answer = read.entries.isEmpty ? LogbookImportResult(added: 0, duplicates: 0) : try await Gateway.importLogbook(read.entries)
            imported = LogbookCSV.summary(read, answer)
            await load()
        } catch {
            problem = "Could not import the logbook: \(error.localizedDescription)"
        }
    }
}

/// One flight's form: a paper logbook's columns, with the ones a
/// student's 61.109 experience and instrument currency (61.57(c)) are
/// counted from.
struct LogbookEntryForm: View {
    @State var entry: LogbookEntryRequest
    let isNew: Bool
    var save: (LogbookEntryRequest) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        Form {
            Section {
                DatePicker("Date", selection: Binding(get: { Day.date(entry.flownOn) ?? Date() }, set: { entry.flownOn = Day.string($0) }),
                           in: ...Date(), displayedComponents: .date)
                words("Route", \.route, placeholder: "KDLH KHIB")
                words("Airplane", \.aircraft, placeholder: "N12345", codes: true)
                words("Type", \.aircraftType, placeholder: "C172", codes: true)
            }
            Section("Time") {
                hours("Total", \.totalHours)
                hours("Night", \.nightHours)
                hours("Cross-country", \.crossCountryHours)
                hours("Dual received", \.dualHours)
                hours("Solo", \.soloHours)
                hours("Sim. instrument", \.instrumentHours)
            }
            Section("Landings") {
                count("Day", \.dayLandings)
                count("Night", \.nightLandings)
                count("Towered", \.toweredLandings)
            }
            Section("Distance") {
                miles("Distance", \.distanceNm)
                miles("Longest leg", \.longestLegNm)
            }
            Section("Instrument") {
                count("Approaches", \.approaches)
                Toggle("Holding", isOn: $entry.holding)
                Toggle("Tracking", isOn: $entry.tracking)
            }
            Section("Remarks") {
                TextField("Remarks", text: Binding(get: { entry.remarks ?? "" }, set: { entry.remarks = $0 }), axis: .vertical).lineLimit(1...4)
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle(isNew ? "Log a Flight" : "The Flight")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    saving = true
                    Task {
                        do { try await save(entry); dismiss() } catch { problem = error.localizedDescription }
                        saving = false
                    }
                }
                .disabled(saving)
            }
        }
    }

    private func words(_ title: String, _ key: WritableKeyPath<LogbookEntryRequest, String?>, placeholder: String, codes: Bool = false) -> some View {
        LabeledContent(title) {
            TextField(placeholder, text: Binding(get: { entry[keyPath: key] ?? "" }, set: { entry[keyPath: key] = $0 }))
                .multilineTextAlignment(.trailing)
                .textInputAutocapitalization(codes ? .characters : .sentences)
                .autocorrectionDisabled(codes)
        }
    }

    private func hours(_ title: String, _ key: WritableKeyPath<LogbookEntryRequest, Double>) -> some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                TextField("0", value: Binding(get: { entry[keyPath: key] }, set: { entry[keyPath: key] = max(0, $0) }), format: .number)
                    .multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                Text("h").foregroundStyle(.secondary)
            }
        }
    }

    private func miles(_ title: String, _ key: WritableKeyPath<LogbookEntryRequest, Double>) -> some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                TextField("0", value: Binding(get: { entry[keyPath: key] }, set: { entry[keyPath: key] = max(0, $0) }), format: .number)
                    .multilineTextAlignment(.trailing).keyboardType(.decimalPad)
                Text("nm").foregroundStyle(.secondary)
            }
        }
    }

    private func count(_ title: String, _ key: WritableKeyPath<LogbookEntryRequest, Int>) -> some View {
        Stepper(value: Binding(get: { entry[keyPath: key] }, set: { entry[keyPath: key] = max(0, $0) }), in: 0...99) {
            LabeledContent(title, value: "\(entry[keyPath: key])")
        }
    }
}
