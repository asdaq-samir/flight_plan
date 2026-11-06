import Foundation
import UIKit
import UserNotifications

/// What the app tells the pilot while it is not in front -- a call to us
/// on the radio (ClearanceListener), an airplane near own ship
/// (Traffic), a watched airplane taking off or landing (Tracking) -- as
/// a time-sensitive notification, the level Apple keeps for what a
/// person needs now and lets through a Focus; and never for what the
/// app is showing on its own screen, where the banner, the amber mark or
/// the haptics say it. Permission is asked once, in the moment the pilot
/// first asks for one of these, as the HIG has it, not at launch.
@MainActor
enum Notifications {
    private static var asked = false

    /// The system's sheet, once per launch at most (the system itself
    /// shows it once per install): the pilot has just set a watch, turned
    /// the radio on, or has traffic near on the screen.
    static func allow() async {
        guard !asked else { return }
        asked = true
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }

    /// Whether the app is on the screen: what it shows there is not
    /// notified as well.
    static var inFront: Bool { UIApplication.shared.applicationState == .active }

    /// Told as a time-sensitive notification where the app is not in
    /// front; false where it is, and the caller shows it on the screen
    /// instead. One id replaces an earlier notification of the same thing
    /// (the same airplane near again) rather than stacking them.
    @discardableResult
    static func tell(_ title: String, _ body: String, id: String = UUID().uuidString) -> Bool {
        guard !inFront else { return false }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        Log.records.notice("notified: \(title, privacy: .public)")
        return true
    }
}
