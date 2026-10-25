import SwiftUI

/// The instructor's side (the web app's InstructorPage): their
/// certificate as endorsements carry it, the students asking them in --
/// taken by signing in with the address asked -- their students, each a
/// page with the solo cross-countries waiting on them, and what they have
/// signed in the last 3 years, the record 14 CFR 61.189(b) and (c) ask an
/// instructor to keep, each voidable for a correction.
struct InstructorView: View {
    @Environment(Session.self) private var session
    @State private var instructor: Instructor?
    @State private var problem: String?
    @State private var editing = false
    @State private var askingStop = false

    var body: some View {
        List {
            if let instructor {
                if instructor.certificate == nil || editing {
                    let cancel: (() -> Void)? = instructor.certificate == nil ? nil : { editing = false }
                    CertificateSection(instructor: instructor, onCancel: cancel) { request in
                        await act { try await Gateway.setInstructor(request) }
                        if problem == nil { editing = false }
                    }
                } else {
                    Section("Your certificate") {
                        LabeledContent {
                            if let until = instructor.until { GoodToText(until: until) }
                        } label: {
                            Text(instructor.fullName ?? "")
                            Text(instructor.certificate ?? "").monospaced()
                        }
                        Button("Change") { editing = true }
                    }
                }
                if !instructor.asking.isEmpty {
                    Section("Asking you") {
                        ForEach(instructor.asking) { s in
                            LabeledContent {
                                HStack {
                                    Button("Decline") { Task { await act { try await Gateway.leaveStudent(s.linkId) } } }.buttonStyle(.borderless)
                                    Button("Accept") { Task { await act { try await Gateway.acceptStudent(s.linkId) } } }.buttonStyle(.borderedProminent)
                                }
                            } label: {
                                Text(s.name)
                                Text(s.email)
                            }
                        }
                    }
                }
                Section("Students") {
                    if instructor.students.isEmpty { Text("None yet").foregroundStyle(.secondary) }
                    ForEach(instructor.students) { s in
                        NavigationLink {
                            StudentView(row: s, instructor: instructor) { await act { try await Gateway.instructor() } }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.name)
                                Text(Self.studentLine(s)).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if !instructor.signed.isEmpty {
                    // Kept when a student's account goes (61.189).
                    Section("Signed") {
                        ForEach(instructor.signed) { e in
                            SignedEndorsementRow(label: instructor.kinds.first { $0.code == e.code }?.label ?? e.code, rule: nil, e: e, who: e.studentName) {
                                Task { await act { try await Gateway.voidEndorsement(e.id) } }
                            }
                        }
                    }
                }
                if instructor.certificate != nil, !editing {
                    Section {
                        Button("Stop Instructing Here", role: .destructive) { askingStop = true }
                    }
                }
            } else if problem == nil {
                ProgressView()
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("Instructing")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Stop instructing here?", isPresented: $askingStop, titleVisibility: .visible) {
            Button("Stop Instructing", role: .destructive) { Task { await act { try await Gateway.stopInstructing() } } }
        } message: {
            Text("Your students are let go. What you signed stays on record.")
        }
        .task(id: session.signedIn) { await act { try await Gateway.instructor() } }
        .refreshable { await act { try await Gateway.instructor() } }
    }

    static func studentLine(_ s: StudentRow) -> String {
        var parts = ["\(s.experienceMet) of \(s.experienceOf) of 61.109"]
        if let solo = s.soloUntil { parts.append("solo to \(Day.said(solo))") }
        if s.reviewsWaiting > 0 { parts.append("\(s.reviewsWaiting) waiting on you") }
        return parts.joined(separator: " · ")
    }

    private func act(_ change: () async throws -> Instructor?) async {
        do { if let next = try await change() { instructor = next }; problem = nil } catch { problem = error.localizedDescription }
    }
}

/// The certificate as every endorsement signed carries it (AC 61-65K):
/// the name, the certificate number with its ratings' letters, and the
/// end of the recent experience (14 CFR 61.197) or an older certificate's
/// expiration date.
struct CertificateSection: View {
    let instructor: Instructor
    var onCancel: (() -> Void)?
    var save: (InstructorRequest) async -> Void
    @State private var fullName = ""
    @State private var certificate = ""
    @State private var untilKind = "RE"
    @State private var until = Date()
    @State private var loaded = false
    @State private var saving = false

    var ready: Bool {
        !fullName.trimmingCharacters(in: .whitespaces).isEmpty
            && certificate.trimmingCharacters(in: .whitespaces).range(of: "^[A-Za-z0-9]{4,20}$", options: .regularExpression) != nil
    }

    var body: some View {
        Section("Your flight instructor certificate") {
            LabeledContent("Name") { TextField("J. J. Jones", text: $fullName).multilineTextAlignment(.trailing) }
            LabeledContent("Certificate") {
                TextField("987654321CFI", text: $certificate).multilineTextAlignment(.trailing).font(.body.monospaced())
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
            }
            Picker("Its date", selection: $untilKind) {
                Text("Recent experience").tag("RE")
                Text("Expires").tag("EXP")
            }
            .pickerStyle(.segmented)
            DatePicker(untilKind == "RE" ? "Recent experience ends" : "Expires", selection: $until, displayedComponents: .date)
            Button(saving ? "Saving…" : "Save") {
                saving = true
                let request = InstructorRequest(fullName: fullName.trimmingCharacters(in: .whitespaces), certificate: certificate.trimmingCharacters(in: .whitespaces),
                                                until: Day.string(until), untilKind: untilKind)
                Task { await save(request); saving = false }
            }
            .disabled(!ready || saving)
            if let onCancel { Button("Cancel", action: onCancel) }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            fullName = instructor.fullName ?? ""
            certificate = instructor.certificate ?? ""
            untilKind = instructor.untilKind ?? "RE"
            if let day = instructor.until.flatMap(Day.date) { until = day }
        }
    }
}

/// One student, as their instructor reads them: the solo cross-countries
/// waiting, each AC 61-65K endorsement -- signed here, recorded from paper,
/// or not yet, with a tap to sign one -- 61.109's experience from their
/// logbook and their knowledge test codes.
struct StudentView: View {
    let row: StudentRow
    let instructor: Instructor
    var onChange: () async -> Void
    @State private var training: Training?
    @State private var problem: String?

    var body: some View {
        List {
            if let training {
                let name = training.fullName ?? row.name
                let crossCountry = training.kinds?.first { $0.code == "solo-xc-flight" }
                ForEach(training.reviews.filter { $0.answeredAt == nil }) { review in
                    if let crossCountry {
                        ReviewSection(review: review, kind: crossCountry, studentId: row.studentId, studentName: name, instructor: instructor) { next in
                            if let next { self.training = next } else { await load() }
                            await onChange()
                        }
                    }
                }
                endorsements(training, name: name)
                ExperienceSection(items: training.experience)
                Section("Knowledge test") {
                    let codes = training.knowledgeTestCodes ?? []
                    if codes.isEmpty { Text("No codes yet").foregroundStyle(.secondary) }
                    ForEach(codes, id: \.self) { code in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(code).font(.body.monospaced())
                            if let words = AcsTable.bundled?.words(code) { Text(words).font(.footnote).foregroundStyle(.secondary) }
                        }
                    }
                }
            } else if problem == nil {
                ProgressView()
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle(row.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    // Each signed in AC 61-65K's words, which name the student as on their
    // certificate: none until they have given it.
    @ViewBuilder private func endorsements(_ t: Training, name: String) -> some View {
        let signed = Endorsing.inForce(t.signed)
        let paper = Dictionary((t.endorsements ?? []).map { ($0.code, $0) }, uniquingKeysWith: { a, _ in a })
        Section("Endorsements") {
            if t.fullName == nil { Text("Waiting for their name as on their certificate").foregroundStyle(.secondary) }
            ForEach(t.kinds ?? []) { kind in
                if let e = signed[kind.code] {
                    SignedEndorsementRow(label: kind.label, rule: kind.rule, e: e)
                } else {
                    NavigationLink {
                        SignView(kind: kind, studentId: row.studentId, studentName: name, instructor: instructor) { next in
                            training = next
                            await onChange()
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(kind.label)
                            Text(kind.rule + (paper[kind.code].map { " · on paper \(Day.said($0.endorsedOn))" } ?? "")).font(.footnote).foregroundStyle(.secondary)
                            if let until = paper[kind.code]?.until { GoodToText(until: until).font(.footnote) }
                        }
                    }
                    .disabled(t.fullName == nil)
                }
            }
        }
    }

    private func load() async {
        do { training = try await Gateway.studentTraining(row.studentId); problem = nil } catch { problem = "Their record could not be fetched (\(error.localizedDescription))." }
    }
}

/// A solo cross-country put to the instructor: the student's note, the
/// flight as saved, what the record answers of 61.93(d)(4) and (5), and
/// Endorse or Not Endorsed, with a note the student is sent.
struct ReviewSection: View {
    let review: CrossCountryReview
    let kind: EndorsementKind
    let studentId: Int64
    let studentName: String
    let instructor: Instructor
    /// The student's record after a signature, or nil to fetch it again.
    var onDone: (Training?) async -> Void
    @State private var declining = false
    @State private var note = ""
    @State private var problem: String?

    var body: some View {
        Section("\(Endorsing.route(review)), \(Day.said(review.flightOn))") {
            if let note = review.note { Text("“\(note)”").italic() }
            LabeledContent("Airplane", value: [review.makeModel, review.flight?.aircraftTailNumber].compactMap { $0 }.joined(separator: " · "))
            if let f = review.flight {
                if let ft = f.cruiseAltitudeFt { LabeledContent("Altitude", value: "\(ft.formatted()) ft") }
                if let nm = f.totalDistanceNm { LabeledContent("Distance", value: String(format: "%.0f nm", nm)) }
                if let min = f.totalEteMin { LabeledContent("Time", value: hoursMinutes(min)) }
                if let gal = f.totalFuelGal { LabeledContent("Fuel", value: String(format: "%.1f gal", gal)) }
            }
            // 14 CFR 61.93(d)(4) and (5), as the student's record has them.
            ForEach(Array(review.checks.enumerated()), id: \.offset) { _, c in
                Label {
                    Text(c.label)
                    Text("\(c.rule) · \(c.detail)")
                } icon: {
                    Image(systemName: c.met ? "checkmark.circle.fill" : "xmark.circle").foregroundStyle(c.met ? Color.green : Color.red)
                }
            }
            NavigationLink("Endorse This Flight") {
                SignView(kind: kind, studentId: studentId, studentName: studentName, instructor: instructor,
                         initial: Endorsing.reviewFields(review), reviewId: review.id) { next in await onDone(next) }
            }
            if declining {
                TextField("Why, and what to change", text: $note, axis: .vertical).lineLimit(2...5)
                Button("Send") {
                    Task {
                        do { _ = try await Gateway.declineReview(review.id, note: note.trimmingCharacters(in: .whitespacesAndNewlines)); declining = false; await onDone(nil) }
                        catch { problem = error.localizedDescription }
                    }
                }
                .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Cancel") { declining = false }
            } else {
                Button("Not Endorsed", role: .destructive) { declining = true }
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
    }
}

/// An endorsement signed for a student, as AC 120-78B has an electronic
/// signature made: its blanks filled in, the words read as they will be
/// signed (the gateway's AC 61-65K template), then a deliberate tap on the
/// signature -- for a solo cross-country, only once the instructor has
/// ticked what 61.93(d) asks them to determine. Once signed it is not
/// changed; a correction voids it for a new one.
struct SignView: View {
    let kind: EndorsementKind
    let studentId: Int64
    let studentName: String
    let instructor: Instructor
    var initial: [String: String] = [:]
    var reviewId: Int64? = nil
    var onSigned: (Training) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var fields: [String: String] = [:]
    @State private var determined: Set<String> = []
    @State private var signing = false
    @State private var problem: String?

    var body: some View {
        let signedOn = Day.today()
        let text = Endorsing.render(kind.template, student: studentName, fields: fields)
        let missing = kind.fields.filter { $0.required && (fields[$0.key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
        // An instructor's certificate past its date may not be used to
        // endorse (14 CFR 61.197(a)); the gateway refuses it too.
        let lapsed = instructor.until.map { !Day.current($0) } ?? false
        let crossCountry = kind.code == "solo-xc-flight"
        let ready = missing.isEmpty && !lapsed && (!crossCountry || determined.count == Endorsing.determinations.count)
        Form {
            Section {
                ForEach(kind.fields, id: \.key) { f in
                    LabeledContent(f.label) {
                        TextField(f.example, text: Binding(get: { fields[f.key] ?? "" }, set: { fields[f.key] = $0 })).multilineTextAlignment(.trailing)
                    }
                }
            } header: {
                Text("\(kind.paragraph) · \(kind.rule)")
            }
            if crossCountry {
                Section("Your determination") {
                    ForEach(Endorsing.determinations, id: \.rule) { d in
                        Toggle(isOn: Binding(get: { determined.contains(d.rule) }, set: { on in if on { determined.insert(d.rule) } else { determined.remove(d.rule) } })) {
                            Text(d.label)
                            Text(d.rule)
                        }
                    }
                }
            }
            Section("Instructor's signature") {
                Text(text)
                Text(Endorsing.signatureLine(instructor, signedOn: signedOn)).font(.footnote.monospaced()).foregroundStyle(.secondary)
                Button(signing ? "Signing…" : "Sign as \(instructor.fullName ?? "")") {
                    signing = true
                    let request = SignRequest(code: kind.code, fields: fields, reviewId: reviewId, signedOn: signedOn, text: text)
                    Task {
                        do { let next = try await Gateway.sign(studentId, request); await onSigned(next); dismiss() }
                        catch { problem = error.localizedDescription }
                        signing = false
                    }
                }
                .disabled(!ready || signing)
                if lapsed, let until = instructor.until {
                    Text("Your \(instructor.untilKind == "EXP" ? "certificate expired" : "recent experience ran out") on \(Day.said(until)) (14 CFR 61.197(a))")
                        .font(.footnote).foregroundStyle(.red)
                } else if !missing.isEmpty {
                    Text("Fill in \(missing.map { $0.label.lowercased() }.joined(separator: ", "))").font(.footnote).foregroundStyle(.secondary)
                }
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle(kind.label)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if fields.isEmpty { fields = Dictionary(kind.fields.map { ($0.key, initial[$0.key] ?? "") }, uniquingKeysWith: { a, _ in a }) } }
    }
}
