import SwiftUI

/// A flown track's replay, as the web app's past flight card has it
/// (PastFlightCard's Replay): play or pause, stop, and how fast; the
/// moment's time, height, ground speed and heading over the profile, its
/// cursor where the airplane is; and the scrubber under it. The airplane
/// itself is on the map (Replay, drawn by ChartMap). With the graph
/// first, so it is in sight as it plays at the half sheet.
struct ReplaySection: View {
    let points: [Replay.Point]
    /// Which flight, so the card shown again keeps its moment.
    let key: String
    /// Played the first time: the track put on the map with it.
    var onPlay: (() -> Void)?

    private var replay: Replay { .shared }

    var body: some View {
        @Bindable var replay = replay
        Section {
            HStack(spacing: 12) {
                Button { replay.playing ? replay.pause() : play() } label: {
                    Image(systemName: replay.playing ? "pause.fill" : "play.fill").frame(width: 32, height: 32)
                }
                .accessibilityLabel(replay.playing ? "Pause the replay" : "Play the replay")
                Button { replay.stop() } label: { Image(systemName: "stop.fill").frame(width: 32, height: 32) }
                    .disabled(replay.at == nil)
                    .accessibilityLabel("Stop the replay")
                Spacer()
                // A discrete setting: a segmented control, not a slider.
                Picker("Replay speed", selection: $replay.speed) {
                    ForEach(Replay.speeds, id: \.self) { Text("\(Int($0))×").tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 180)
            }
            .buttonStyle(.borderless)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(replay.here.map { Self.clock($0.t) } ?? "Altitude, ft · ground speed, kt").foregroundStyle(.secondary)
                    Spacer()
                    if let here = replay.here { Text(Self.figures(here)).fontWeight(.semibold) }
                }
                .font(.footnote.monospacedDigit())
                FlightProfileChart(points: points, cursor: replay.here, onScrub: { t in replay.scrub(to: t) })
                    .frame(height: 180)
                if let start = points.first?.t, let end = points.last?.t, end > start {
                    Slider(value: Binding(get: { replay.at ?? start }, set: { replay.scrub(to: $0) }), in: start...end) {
                        Text("Replay time")
                    }
                    .accessibilityValue(Self.clock(replay.at ?? start))
                }
            }
        }
        .onAppear { replay.load(points, key: key) }
        .onChange(of: points) { _, next in replay.load(next, key: key) }
    }

    private func play() {
        if replay.at == nil { onPlay?() }
        replay.play()
    }

    /// The moment's clock time, in this device's clock.
    static func clock(_ t: Double) -> String {
        Date(timeIntervalSince1970: t).formatted(date: .omitted, time: .standard)
    }

    /// "3,000 ft · 108 kt · NE", as the web app's replay says it: the height
    /// to the 100 ft, as the map's airplane carries it.
    static func figures(_ here: Replay.Point) -> String {
        let height = here.altFt.map { "\((Int(($0 / 100).rounded()) * 100).formatted()) ft" } ?? "—"
        let speed = here.gsKt.map { "\(Int($0.rounded())) kt" } ?? "—"
        let heading = here.trackDeg.map { " · " + FlightWords.compass($0) } ?? ""
        return "\(height) · \(speed)\(heading)"
    }
}
