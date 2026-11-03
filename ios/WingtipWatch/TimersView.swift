import SwiftUI

/// A stopwatch kept as the moment it was started and the time it had run
/// before that, so the time shown is worked out from the clock at each
/// draw: nothing counts in the background, and the figure is right when
/// the display wakes.
struct Stopwatch: Equatable {
    var startedAt: Date?
    var before: TimeInterval = 0

    var running: Bool { startedAt != nil }

    func elapsed(at now: Date) -> TimeInterval {
        before + (startedAt.map { now.timeIntervalSince($0) } ?? 0)
    }

    mutating func startOrStop(at now: Date) {
        if let startedAt {
            before += now.timeIntervalSince(startedAt)
            self.startedAt = nil
        } else {
            startedAt = now
        }
    }

    mutating func reset() {
        startedAt = nil
        before = 0
    }

    /// h:mm:ss past an hour, else m:ss, as a cockpit timer reads.
    static func text(_ seconds: TimeInterval) -> String {
        let whole = Int(seconds.rounded(.down))
        let h = whole / 3600, m = (whole % 3600) / 60, s = whole % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

/// Two timers: the flight's, started at takeoff for the fuel and the
/// log, and one for a hold or an approach (the outbound leg, the time
/// from the final approach fix). Each is started or stopped with one
/// tap and reset by holding.
struct TimersView: View {
    @State private var flight = Stopwatch()
    @State private var hold = Stopwatch()

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            ScrollView {
                VStack(spacing: 12) {
                    TimerRow(title: "Flight", stopwatch: $flight, now: timeline.date)
                    TimerRow(title: "Hold / Approach", stopwatch: $hold, now: timeline.date)
                }
            }
        }
        .navigationTitle("Timers")
    }
}

struct TimerRow: View {
    let title: String
    @Binding var stopwatch: Stopwatch
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Text(Stopwatch.text(stopwatch.elapsed(at: now)))
                    .font(.system(.title2, design: .rounded).monospacedDigit())
                    .foregroundStyle(stopwatch.running ? .primary : .secondary)
                Spacer()
                Button {
                    stopwatch.startOrStop(at: Date())
                } label: {
                    Image(systemName: stopwatch.running ? "pause.fill" : "play.fill")
                }
                .buttonStyle(.bordered)
                .tint(stopwatch.running ? .orange : .green)
                .accessibilityLabel(stopwatch.running ? "Stop \(title) timer" : "Start \(title) timer")
            }
        }
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onLongPressGesture { stopwatch.reset() }
        .accessibilityHint("Hold to reset")
    }
}
