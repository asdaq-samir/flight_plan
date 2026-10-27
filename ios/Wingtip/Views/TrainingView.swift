import SwiftUI

/// The student's training, as the gateway keeps it (/api/training), the
/// web app's Checkride page: 61.109(a)'s experience from the logbook,
/// item by item; the knowledge test report's ACS codes in the FAA's own
/// words; AC 61-65K's endorsements -- signed in the app by their
/// instructor, or the day one was signed on paper; their instructors,
/// and the solo cross-countries put to them for the review 14 CFR
/// 61.93(c)(3) asks, judged there. None of it is a sign-off: the
/// instructor's endorsement is.
struct TrainingView: View {
    @Environment(Session.self) private var session
    @State private var training: Training?
    @State private var problem: String?
    @State private var email = ""
    @State private var name = ""
    @State private var pasted = ""

    var body: some View {
        List {
            if !session.signedIn {
                ContentUnavailableView("Sign in for your training", systemImage: "graduationcap", description: Text("Your endorsements and reviews are kept with your account."))
            }
            if let training {
                ExperienceSection(items: training.experience)
                knowledgeTest(training)
                endorsements(training)
                instructors(training)
                reviews(training)
            } else if session.signedIn, problem == nil {
                ProgressView()
            }
            ProblemLine(problem)
        }
        .navigationTitle("Training")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: session.signedIn) {
            guard session.signedIn else { return }
            await act { try await Gateway.training() }
        }
        .refreshable { await act { try await Gateway.training() } }
    }

    /// A change sent, and the record as the gateway answers it kept.
    private func act(_ change: () async throws -> Training?) async {
        do {
            if let next = try await change() {
                training = next
                if name.isEmpty { name = next.fullName ?? "" }
            }
            problem = nil
        } catch { problem = error.localizedDescription }
    }

    // The codes on the Airman Knowledge Test Report: the examiner goes over
    // each again, and the instructor endorses their review (61.39(a)(6)(iii)).
    @ViewBuilder private func knowledgeTest(_ t: Training) -> some View {
        let codes = t.knowledgeTestCodes ?? []
        let typed = Endorsing.acsCodes(in: pasted)
        Section("Knowledge test") {
            if codes.isEmpty { Text("No codes yet").foregroundStyle(.secondary) }
            ForEach(codes, id: \.self) { code in
                VStack(alignment: .leading, spacing: 2) {
                    Text(code).font(.body.monospaced())
                    if let table = AcsTable.bundled {
                        Text(table.words(code) ?? "Not in \(table.editions.joined(separator: " or "))").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            TextField("Paste or type the report's codes", text: $pasted, axis: .vertical)
                .font(.body.monospaced()).textInputAutocapitalization(.characters).autocorrectionDisabled()
            HStack {
                Text(typed.isEmpty ? "" : "\(typed.count) code\(typed.count == 1 ? "" : "s") found").font(.footnote).foregroundStyle(.secondary)
                Spacer()
                if !codes.isEmpty {
                    Button("Clear") { Task { await act { try await Gateway.setKnowledgeTest([]) } } }.buttonStyle(.borderless)
                }
                Button("Add") {
                    var all = codes
                    for c in typed where !all.contains(c) { all.append(c) }
                    pasted = ""
                    Task { await act { try await Gateway.setKnowledgeTest(all) } }
                }
                .buttonStyle(.borderless)
                .disabled(typed.isEmpty)
            }
        }
    }

    // AC 61-65K's student endorsements: signed here by the instructor, or
    // the day one was signed in the paper logbook.
    @ViewBuilder private func endorsements(_ t: Training) -> some View {
        let signed = Endorsing.inForce(t.signed)
        let recorded = Dictionary((t.endorsements ?? []).map { ($0.code, $0) }, uniquingKeysWith: { a, _ in a })
        if let kinds = t.kinds, !kinds.isEmpty {
            Section("Endorsements") {
                ForEach(kinds) { kind in
                    if let e = signed[kind.code] {
                        SignedEndorsementRow(label: kind.label, rule: kind.rule, e: e)
                    } else {
                        VStack(alignment: .leading, spacing: 2) {
                            OptionalDayRow(title: kind.label, day: Binding(get: { recorded[kind.code]?.endorsedOn }, set: { day in
                                Task { await act { try await Gateway.recordEndorsement(kind.code, on: day) } }
                            }), upTo: Date())
                            Text(kind.rule).font(.footnote).foregroundStyle(.secondary)
                            if let until = recorded[kind.code]?.until { GoodToText(until: until).font(.footnote) }
                        }
                    }
                }
            }
        }
        let voided = t.signed.filter(\.voided)
        if !voided.isEmpty {
            Section("Voided") {
                ForEach(voided) { e in
                    SignedEndorsementRow(label: t.kinds?.first { $0.code == e.code }?.label ?? e.code, rule: nil, e: e)
                }
            }
        }
    }

    // An instructor asked in sees the experience, endorsements and codes
    // here, reviews the solo cross-countries (14 CFR 61.93(c)(3)) and signs
    // the endorsements; either can end it.
    @ViewBuilder private func instructors(_ t: Training) -> some View {
        let named = !(t.fullName ?? name.trimmingCharacters(in: .whitespaces)).isEmpty
        Section {
            LabeledContent {
                TextField("Avery B. Student", text: $name)
                    .multilineTextAlignment(.trailing).textContentType(.name)
                    .onSubmit { saveName(t) }
            } label: {
                Text("Your name")
                Text("As on your student pilot certificate")
            }
            ForEach(t.instructors) { link in
                LabeledContent {
                    Button("Remove", role: .destructive) { Task { await act { try await Gateway.dropInstructor(link.id) } } }.buttonStyle(.borderless)
                } label: {
                    Text(link.name ?? link.email)
                    Text(link.accepted ? [link.certificate, link.email].compactMap { $0 }.joined(separator: " · ") : "Asked, not answered yet")
                }
            }
            HStack {
                TextField("Instructor's email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                Button("Ask") { Task { await ask(t) } }.disabled(!named || !email.contains("@"))
            }
            if !named { Text("Give your name first: your endorsements name you by it").font(.footnote).foregroundStyle(.secondary) }
        } header: {
            Text("Your instructor")
        }
    }

    @ViewBuilder private func reviews(_ t: Training) -> some View {
        let taken = t.instructors.filter(\.accepted)
        if !t.reviews.isEmpty || !taken.isEmpty {
            Section("Solo cross-countries") {
                ForEach(t.reviews) { review in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Endorsing.route(review)).font(.headline.monospaced())
                        Text("\(Day.said(review.flightOn)) · \(review.makeModel) · \(Endorsing.state(review))").font(.footnote).foregroundStyle(.secondary)
                        ForEach(Array(review.checks.enumerated()), id: \.offset) { _, check in
                            Label(check.label, systemImage: check.met ? "checkmark.circle.fill" : "xmark.circle").font(.footnote).foregroundStyle(check.met ? Color.green : Color.red)
                        }
                        if review.answeredAt == nil {
                            Button("Take Back") { Task { await act { try await Gateway.withdrawReview(review.id) } } }.buttonStyle(.borderless).font(.footnote)
                        }
                    }
                }
                if !taken.isEmpty {
                    NavigationLink("Ask for a Review") {
                        ReviewAskView(instructors: taken) { request in await act { try await Gateway.askReview(request) } }
                    }
                }
            }
        }
    }

    private func saveName(_ t: Training) {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, n != t.fullName else { return }
        Task { await act { try await Gateway.setTrainingName(n) } }
    }

    private func ask(_ t: Training) async {
        let n = name.trimmingCharacters(in: .whitespaces)
        await act {
            if !n.isEmpty, n != t.fullName { _ = try await Gateway.setTrainingName(n) }
            try await Gateway.askInstructor(email: email.trimmingCharacters(in: .whitespaces))
            return try await Gateway.training()
        }
        if problem == nil { email = "" }
    }
}

/// 61.109(a)'s experience, item by item, from the logbook's columns as
/// the gateway counts them: the student's page and their instructor's.
struct ExperienceSection: View {
    let items: [ExperienceItem]

    static func amount(_ item: ExperienceItem) -> String {
        switch item.unit {
        case "h": return String(format: "%.1f of %@ h", item.have, item.need.formatted())
        case "flights": return item.met ? "Done" : "Not yet"
        default: return "\(item.have.formatted()) of \(item.need.formatted())"
        }
    }

    var body: some View {
        if !items.isEmpty {
            Section("Private pilot experience") {
                ForEach(items, id: \.key) { item in
                    LabeledContent {
                        Text(Self.amount(item)).monospacedDigit()
                    } label: {
                        Label {
                            Text(item.label)
                            Text(item.rule)
                        } icon: {
                            Image(systemName: item.met ? "checkmark.circle.fill" : "circle").foregroundStyle(item.met ? Color.green : Color.secondary)
                        }
                    }
                }
            }
        }
    }
}

/// "Good to 11 Jan 2027", or in red once it has run out.
struct GoodToText: View {
    let until: String

    var body: some View {
        let good = Day.current(until)
        Text(good ? "Good to \(Day.said(until))" : "Ran out \(Day.said(until))").foregroundStyle(good ? Color.secondary : Color.red)
    }
}

/// An endorsement signed in the app: its name, rule and day, and its words
/// and signature line a tap away, as signed -- with, for the instructor
/// who signed it, Void for a correction.
struct SignedEndorsementRow: View {
    let label: String
    let rule: String?
    let e: SignedEndorsement
    var who: String? = nil
    var onVoid: (() -> Void)? = nil

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                Text(e.text).textSelection(.enabled)
                if let signature = e.signature { Text(signature).font(.footnote.monospaced()).foregroundStyle(.secondary) }
            }
            if let onVoid, !e.voided {
                Button("Void It", role: .destructive, action: onVoid)
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                Text([who, rule, e.voided ? "Voided" : "Signed \(Day.said(e.signedOn))"].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
                if !e.voided, let until = e.until { GoodToText(until: until).font(.footnote) }
            }
        }
    }
}

/// A saved flight put to the student's instructor for the review 14 CFR
/// 61.93(c)(3) and (d) ask before each solo cross-country (the web app's
/// ReviewAsk): which instructor, the airplane's make and model and the
/// day as the endorsement will name them, and a note.
struct ReviewAskView: View {
    let instructors: [InstructorLink]
    var ask: (AskReviewRequest) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var flights: [SavedFlight] = []
    @State private var flightId: Int64?
    @State private var instructorId: Int64?
    @State private var makeModel = ""
    @State private var day = Date()
    @State private var note = ""
    @State private var asking = false

    var body: some View {
        Form {
            Section("Flight") {
                if flights.isEmpty { Text("Save the planned flight first, from Flights.").foregroundStyle(.secondary) }
                Picker("Saved flight", selection: $flightId) {
                    Text("Pick one").tag(Int64?.none)
                    ForEach(flights) { f in
                        Text(([f.departureIdent] + f.stops + [f.destinationIdent]).joined(separator: " ")).tag(Int64?.some(f.id))
                    }
                }
            }
            Section {
                if instructors.count > 1 {
                    Picker("Instructor", selection: $instructorId) {
                        ForEach(instructors) { l in Text(l.name ?? l.email).tag(Int64?.some(l.id)) }
                    }
                }
                LabeledContent("Make and model") { TextField("Cessna 172", text: $makeModel).multilineTextAlignment(.trailing) }
                DatePicker("Day of the flight", selection: $day, in: Date()..., displayedComponents: .date)
                TextField("A note for your instructor", text: $note, axis: .vertical).lineLimit(1...4)
            }
            Section {
                Button(asking ? "Asking…" : "Ask \(chosen?.name ?? chosen?.email ?? "") to Review It") {
                    guard let flightId, let chosen else { return }
                    asking = true
                    let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
                    let request = AskReviewRequest(flightId: flightId, flightOn: Day.string(day), instructorId: chosen.id,
                                                   makeModel: makeModel.trimmingCharacters(in: .whitespaces), note: n.isEmpty ? nil : n)
                    Task { await ask(request); asking = false; dismiss() }
                }
                .disabled(flightId == nil || makeModel.trimmingCharacters(in: .whitespaces).isEmpty || asking)
            }
        }
        .navigationTitle("Ask for a Review")
        .navigationBarTitleDisplayMode(.inline)
        .task { flights = (try? await Gateway.flights()) ?? [] }
    }

    private var chosen: InstructorLink? { instructors.first { $0.id == instructorId } ?? instructors.first }
}
