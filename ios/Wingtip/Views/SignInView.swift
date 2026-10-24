import AuthenticationServices
import SwiftUI

/// The two ways in the app offers, as docs/IOS.md has them: Sign in with
/// Apple through iOS's own sheet, or a link emailed to the pilot that
/// opens the app. Google refuses to sign in inside an app, so it stays
/// the website's.
struct SignInView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var sent = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.email, .fullName]
                    } onCompletion: { result in
                        guard case .success(let auth) = result,
                              let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                              let token = credential.identityToken, let identity = String(data: token, encoding: .utf8)
                        else { return }
                        Task {
                            await session.signInWithApple(identityToken: identity)
                            if session.signedIn { dismiss() }
                        }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 50)
                    .listRowInsets(EdgeInsets())
                }
                Section("Or by email") {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if sent {
                        Text("Check your mail: the link opens Wingtip Maps and signs you in.")
                            .font(.footnote)
                    } else {
                        Button("Send Me a Link") {
                            Task { sent = await session.requestMagicLink(email: email.trimmingCharacters(in: .whitespaces)) }
                        }
                        .disabled(!email.contains("@"))
                    }
                }
                if let problem = session.problem {
                    Section { Text(problem).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
