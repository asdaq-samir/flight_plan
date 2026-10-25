import SwiftUI

/// The student's training, as the gateway keeps it (/api/training): the
/// instructors asked in and accepted, the endorsements signed with the
/// dates they run to, the cross-country reviews with each check the
/// instructor found met or not (14 CFR 61.93(c)(3), judged there), and the
/// experience logged against the requirements. Shown as given.
struct TrainingView: View {
    @Environment(Session.self) private var session
    @State private var training: Training?
    @State private var problem: String?
    @State private var email = ""

    var body: some View {
        List {
            if !session.signedIn {
                ContentUnavailableView("Sign in for your training", systemImage: "graduationcap", description: Text("Your endorsements and reviews are kept with your account."))
            }
            if let training {
                Section("Instructors") {
                    ForEach(training.instructors) { link in
                        LabeledContent(link.name ?? link.email, value: link.accepted ? "accepted" : "asked")
                    }
                    HStack {
                        TextField("Instructor's email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                        Button("Ask") { Task { await ask() } }.disabled(!email.contains("@"))
                    }
                }
                if !training.signed.isEmpty {
                    Section("Endorsements") {
                        ForEach(training.signed) { e in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(e.code).font(.headline)
                                    Spacer()
                                    Text(e.until.map { "until \($0)" } ?? "signed \(e.signedOn)").font(.footnote).foregroundStyle(e.voided ? .red : .secondary)
                                }
                                Text(e.text).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                            }
                        }
                    }
                }
                if !training.reviews.isEmpty {
                    Section("Cross-country reviews") {
                        ForEach(training.reviews) { review in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("\(review.flightOn) · \(review.makeModel)").font(.headline)
                                    Spacer()
                                    Text(review.answeredAt == nil ? "waiting" : review.declinedNote == nil ? "signed" : "declined").font(.footnote).foregroundStyle(.secondary)
                                }
                                ForEach(Array(review.checks.enumerated()), id: \.offset) { _, check in
                                    Label(check.label, systemImage: check.met ? "checkmark.circle.fill" : "xmark.circle").font(.footnote).foregroundStyle(check.met ? Color.green : Color.red)
                                }
                                if let note = review.declinedNote { Text(note).font(.footnote).foregroundStyle(.red) }
                            }
                        }
                    }
                }
                if !training.experience.isEmpty {
                    Section("Experience") {
                        ForEach(training.experience, id: \.key) { item in
                            LabeledContent {
                                Text(item.words).foregroundStyle(item.met ? Color.green : Color.secondary)
                            } label: {
                                Text(item.label)
                                Text(item.rule)
                            }
                        }
                    }
                }
            } else if let problem {
                Text(problem).foregroundStyle(.red).font(.footnote)
            }
        }
        .navigationTitle("Training")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: session.signedIn) {
            guard session.signedIn else { return }
            do { training = try await Gateway.training() } catch { problem = error.localizedDescription }
        }
    }

    private func ask() async {
        do {
            try await Gateway.askInstructor(email: email.trimmingCharacters(in: .whitespaces))
            email = ""
            training = try await Gateway.training()
        } catch { problem = error.localizedDescription }
    }
}
