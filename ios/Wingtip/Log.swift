import Foundation
import os

/// The app's loggers, one per part of it, all under the app's own
/// subsystem (the one the tiles' and the engine's signposts and the
/// MetricKit payloads already use), so Console, a device's sysdiagnose
/// and Xcode's Organizer filter the app by `app.wingtipmaps.ios` and
/// one category at a time. Apple's unified logging in place of
/// `print`, which goes nowhere on a phone: a `print` tells no one what
/// went wrong in a cockpit, a log line is in the next sysdiagnose.
///
/// What is logged keeps the pilot's position to the phone: an
/// identifier (an airport, a tail number, a rule's name) is `.public`,
/// a position, a route or a transcript is `.private`, which the system
/// redacts off the device unless the phone is in a debugger.
enum Log {
    static let subsystem = "app.wingtipmaps.ios"

    /// The app's own life: launch, the session, the scene.
    static let app = Logger(subsystem: subsystem, category: "app")
    /// The engine (wingtip-engine through its C functions): a rule
    /// refused, a pack that will not read.
    static let engine = Logger(subsystem: subsystem, category: "engine")
    /// The planner and the gateway: a call that failed, in their words.
    static let planner = Logger(subsystem: subsystem, category: "planner")
    /// The map: the chart, the tiles kept, the traffic about it.
    static let map = Logger(subsystem: subsystem, category: "map")
    /// The radio: the listener, a call to us, a clearance read.
    static let radio = Logger(subsystem: subsystem, category: "radio")
    /// The records on the device and in iCloud, and the notifications.
    static let records = Logger(subsystem: subsystem, category: "records")
    /// MetricKit's payloads (Metrics), kept apart so the day's figures
    /// are one filter in Console.
    static let metrics = Logger(subsystem: subsystem, category: "metrics")
}
