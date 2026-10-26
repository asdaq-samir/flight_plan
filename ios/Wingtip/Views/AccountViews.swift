import SwiftUI

extension Plan {
    /// The airplane the pilot flew and its figures, forgotten as they sign
    /// out: the next person on the device had them (the web app's
    /// forgetPilot, the audit's finding).
    func forgetPilot() {
        tail = nil
        figures = Figures()
    }
}

/// The pilot's contact as the gateway keeps it (PilotContactRequest): a
/// phone for Flight Service and an instructor, and the home base.
struct ContactView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var phone = ""
    @State private var homeBase = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        Form {
            Section {
                LabeledContent("Phone") {
                    TextField("218 555 0100", text: $phone).multilineTextAlignment(.trailing).keyboardType(.phonePad).textContentType(.telephoneNumber)
                }
                LabeledContent("Home base") {
                    TextField("KDLH", text: $homeBase).multilineTextAlignment(.trailing).font(.body.monospaced())
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                }
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("Contact")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    saving = true
                    Task {
                        let p = phone.trimmingCharacters(in: .whitespaces), h = homeBase.trimmingCharacters(in: .whitespaces).uppercased()
                        do { try await session.setContact(phone: p.isEmpty ? nil : p, homeBase: h.isEmpty ? nil : h); dismiss() }
                        catch { problem = error.localizedDescription }
                        saving = false
                    }
                }
                .disabled(saving)
            }
        }
        .onAppear {
            phone = session.pilot?.phone ?? ""
            homeBase = session.pilot?.homeBase ?? ""
        }
    }
}

/// Delete Account, asked first in the system's own dialog, as App Review
/// asks an app with accounts to offer (5.1.1(v)).
struct DeleteAccountButton: View {
    @Environment(Session.self) private var session
    @Environment(Plan.self) private var plan
    @State private var asking = false
    @State private var deleting = false
    @State private var problem: String?

    var body: some View {
        Button(deleting ? "Deleting…" : "Delete Account", role: .destructive) { asking = true }
            .disabled(deleting)
            .confirmationDialog("Delete your account?", isPresented: $asking, titleVisibility: .visible) {
                Button("Delete Account", role: .destructive) {
                    deleting = true
                    Task {
                        do {
                            try await session.deleteAccount()
                            plan.clear()
                            plan.forgetPilot()
                            problem = nil
                        } catch {
                            problem = "Your account was not deleted: \(error.localizedDescription)"
                        }
                        deleting = false
                    }
                }
            } message: {
                Text("Your airplanes, flights, logbook and endorsements go, and you are signed out on every device. This can't be undone.")
            }
        if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
    }
}
