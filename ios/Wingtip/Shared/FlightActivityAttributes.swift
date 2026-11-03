#if canImport(ActivityKit)
import ActivityKit
import Foundation

/// A flight in progress as the Lock Screen and the Dynamic Island show it
/// (ActivityKit's Live Activity, Apple's recommendation for anything
/// ongoing): the route, and what changes as it is flown. Compiled into
/// the app, which starts and updates the activity (FlightActivity), and
/// into the widget extension, which draws it (WingtipWidgets): both must
/// see one and the same type.
struct FlightActivityAttributes: ActivityAttributes {
    /// What the activity shows as the flight goes on: the planner's own
    /// figures counted down from the airplane's fix, not a gauge.
    struct ContentState: Codable, Hashable, Sendable {
        /// The next checkpoint's name; nil past the last one.
        var nextCheckpoint: String?
        /// Miles of the course still to fly.
        var toGoNm: Double
        /// Minutes to the destination at the speed being made good.
        var etaMinutes: Double
        /// Gallons the plan expects to be left, from the planned burn.
        var fuelRemainingGal: Double?
        var groundSpeedKt: Double?
        var altitudeFt: Double?
        /// The leg being flown, by its ends.
        var legFrom: String?
        var legTo: String?
        var updatedAt: Date

        /// The clock time of arrival the figures point at.
        var eta: Date { updatedAt.addingTimeInterval(etaMinutes * 60) }
    }

    /// The route's ends, as the plan names them (C81, KDLH).
    var dep: String
    var dest: String
    /// The airplane by its N-number, where one is picked.
    var tail: String?
}
#endif
