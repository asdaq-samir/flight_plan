import Foundation
import Observation
import UIKit

/// The app's one clock for the work it repeats: the traffic about the
/// map, the tracked and watched airplanes, what is ahead on the track
/// and the flight on the Lock Screen each ran its own loop of sleep and
/// ask, every one waking the phone on its own and none knowing the app
/// was put away. Each is now a registration here, with its own interval,
/// and one loop runs them as they fall due, one after another on the
/// main actor. With the app in the background or the phone locked every
/// interval is doubled -- twice, not more, since what is ahead is still
/// said aloud in flight with the screen off, and the planner looks five
/// minutes along the track -- and the loop stops when nothing is
/// registered.
@MainActor
@Observable
final class Ticker {
    static let shared = Ticker()

    /// How much longer each interval is with the app put away or the
    /// phone locked.
    static let slowed = 2.0

    /// A piece of work registered: cancel it to take it off the clock.
    @MainActor
    final class Registration {
        let seconds: TimeInterval
        let work: @MainActor () async -> Void
        fileprivate var due = Date()
        fileprivate var live = true
        /// The clock it is on; nil once cancelled.
        fileprivate weak var ticker: Ticker?

        fileprivate init(seconds: TimeInterval, work: @escaping @MainActor () async -> Void) {
            self.seconds = seconds
            self.work = work
        }

        func cancel() {
            live = false
            ticker?.remove(self)
            ticker = nil
        }
    }

    private(set) var items: [Registration] = []
    /// Whether the intervals are stretched: the app in the background,
    /// or the phone locked.
    private(set) var background = false
    private(set) var locked = false
    @ObservationIgnored private var loop: Task<Void, Never>?
    /// The wait for the next due item, a task of its own so a new
    /// registration or the app coming back can cut it short.
    @ObservationIgnored private var waiting: Task<Void, Never>?
    @ObservationIgnored private var watching: [Task<Void, Never>] = []

    private var factor: Double { background || locked ? Self.slowed : 1 }

    init() {
        let centre = NotificationCenter.default
        // The app put away, and brought back; the phone locked (its
        // protected data going away), and unlocked.
        let slowing: [(Notification.Name, Bool, Bool)] = [
            (UIApplication.didEnterBackgroundNotification, true, true),
            (UIApplication.willEnterForegroundNotification, true, false),
            (UIApplication.protectedDataWillBecomeUnavailableNotification, false, true),
            (UIApplication.protectedDataDidBecomeAvailableNotification, false, false),
        ]
        for (name, isBackground, on) in slowing {
            watching.append(Task { [weak self] in
                for await _ in centre.notifications(named: name) {
                    guard let self else { return }
                    if isBackground { self.background = on } else { self.locked = on }
                    // Back on the screen: nothing waits longer than its
                    // own interval, and what fell due while away runs now.
                    if !on {
                        let soon = Date()
                        for item in self.items { item.due = min(item.due, soon.addingTimeInterval(item.seconds)) }
                        self.waiting?.cancel()
                    }
                }
            })
        }
    }

    /// Work done every `seconds` (the first time now), until the
    /// registration is cancelled.
    @discardableResult
    func every(_ seconds: TimeInterval, _ work: @escaping @MainActor () async -> Void) -> Registration {
        let item = Registration(seconds: seconds, work: work)
        item.ticker = self
        items.append(item)
        if loop == nil {
            loop = Task { [weak self] in await self?.run() }
        } else {
            waiting?.cancel()
        }
        return item
    }

    /// The same for a SwiftUI `.task`: registered while the task lives,
    /// taken off the clock as it is cancelled.
    func run(every seconds: TimeInterval, _ work: @escaping @MainActor () async -> Void) async {
        let item = every(seconds, work)
        defer { item.cancel() }
        await Self.untilCancelled()
    }

    /// Waits for the task it runs in to be cancelled.
    static func untilCancelled() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3600))
        }
    }

    private func remove(_ item: Registration) {
        items.removeAll { $0 === item }
        if items.isEmpty {
            loop?.cancel()
            loop = nil
            waiting?.cancel()
        }
    }

    /// The loop: each item due is run, in the order registered, then the
    /// clock waits for the soonest. It ends only by being cancelled
    /// (`remove`, as the last item goes), so a loop that is still
    /// finishing an item's work never mistakes a newer loop for itself.
    private func run() async {
        while !Task.isCancelled, !items.isEmpty {
            let now = Date()
            for item in items where item.live && item.due <= now {
                await item.work()
                // A run that took longer than the interval is followed by
                // the next at once, with no pile-up.
                item.due = Date().addingTimeInterval(item.seconds * factor)
            }
            guard let next = items.filter(\.live).map(\.due).min() else { break }
            let wait = max(0.01, next.timeIntervalSinceNow)
            let waiting = Task { _ = try? await Task.sleep(for: .seconds(wait)) }
            self.waiting = waiting
            await waiting.value
        }
    }
}
