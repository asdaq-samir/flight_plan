import Foundation
import Observation

/// Who is signed in, and the ways in: Sign in with Apple through iOS's
/// own sheet, or the emailed link, which opens the app. The gateway's
/// session cookie, kept by URLSession, is the sign-in itself.
@MainActor
@Observable
final class Session {
    private(set) var pilot: Pilot?
    private(set) var loaded = false
    var problem: String?

    var signedIn: Bool { pilot != nil }

    /// Asks the gateway who is signed in: at launch, and after any sign-in.
    func refresh() async {
        do {
            pilot = try await Gateway.me()
            problem = nil
        } catch {
            // Offline, or the gateway down: the last answer stands, and
            // the chart is still the pilot's from its cache.
            problem = error.localizedDescription
        }
        loaded = true
    }

    func signInWithApple(identityToken: String) async {
        do {
            try await Gateway.signInWithApple(identityToken: identityToken)
            await refresh()
        } catch {
            problem = "Apple's sign-in was not accepted: \(error.localizedDescription)"
        }
    }

    func requestMagicLink(email: String) async -> Bool {
        do {
            try await Gateway.requestMagicLink(email: email)
            problem = nil
            return true
        } catch {
            problem = "The link could not be sent: \(error.localizedDescription)"
            return false
        }
    }

    /// A universal link opened in the app: the sign-in link's token is
    /// verified here; any other link is left to the screens later.
    func open(_ url: URL) async {
        guard url.path.hasSuffix("/api/auth/magic-link/verify"),
              let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "token" })?.value
        else { return }
        do {
            try await Gateway.verifyMagicLink(token: token)
            await refresh()
        } catch {
            problem = "The sign-in link did not work: \(error.localizedDescription)"
        }
    }

    /// Signing out ends the session on the gateway and forgets what this
    /// device kept of the pilot's (the owner's pick: sign-out clears,
    /// as the web app's useLogout and forgetPilot do).
    func signOut() async {
        try? await Gateway.signOut()
        pilot = nil
        Session.forgetPilot()
    }

    /// The figures kept per N-number on this device and the airplanes
    /// kept as Favorites, the pilot's own.
    static func forgetPilot(_ defaults: UserDefaults = .standard) {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("figures:") || key == "aircraftFavorites" {
            defaults.removeObject(forKey: key)
        }
    }

    /// The account deleted on the gateway (App Review 5.1.1(v)): it takes
    /// everything that was the pilot's and every session; this device its
    /// own copies -- its settings, drills and the last plan -- and the
    /// cookies, as the web app's useDeleteAccount does. A failure deleted
    /// nothing, and is thrown for the page to say so.
    func deleteAccount() async throws {
        try await Gateway.deleteAccount()
        if let id = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: id) }
        Kept.forget()
        let jar = Gateway.session.configuration.httpCookieStorage
        for cookie in jar?.cookies(for: Config.gateway) ?? [] { jar?.deleteCookie(cookie) }
        pilot = nil
    }

    /// The contact the gateway keeps (PUT /api/me/contact), its answer the pilot.
    func setContact(phone: String?, homeBase: String?) async throws {
        pilot = try await Gateway.setContact(phone: phone, homeBase: homeBase)
    }
}
