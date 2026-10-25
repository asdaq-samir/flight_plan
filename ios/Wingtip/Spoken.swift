import AVFoundation
import Foundation
import Observation

/// The alerts ahead said aloud, at the pilot's ask, as a cockpit's aural
/// alerts are and the web app's lib/map/speak says them: the pilot's eyes
/// are outside, and a phone on a kneeboard is not looked at in time. Each
/// is said once, as it first comes ahead -- the soonest first, the rest
/// as a count -- and again only after it has gone from ahead and comes
/// back. The words are the planner's, as a voice reads them.
@MainActor
@Observable
final class SpokenAlerts {
    static let shared = SpokenAlerts()

    var on: Bool = UserDefaults.standard.bool(forKey: "speakAlerts") {
        didSet {
            UserDefaults.standard.set(on, forKey: "speakAlerts")
            // Turned on in the air, what is ahead then is said at once.
            if on { said = [] }
        }
    }

    private var said: Set<String> = []
    private let voice = AVSpeechSynthesizer()

    /// When: "inside", "now", "in 40 seconds", "in 3 minutes" (the web
    /// app's alertWhen, as said).
    static func when(_ alert: AheadAlert) -> String {
        if alert.inside == true { return "inside" }
        if alert.seconds < 10 { return "now" }
        if alert.seconds < 60 { return "in \(Int((alert.seconds / 5).rounded()) * 5) seconds" }
        let minutes = Int((alert.seconds / 60).rounded())
        return minutes == 1 ? "in 1 minute" : "in \(minutes) minutes"
    }

    /// An alert's line, as said: "Chicago Class B, in 2 minutes"; the
    /// ground's or an obstacle's height against the airplane's, "300 feet
    /// below you", where the planner gives it. A TFR's NOTAM number is read
    /// off the banner, not heard.
    static func line(_ alert: AheadAlert) -> String {
        let title = alert.kind == "tfr" ? "TFR" : alert.name.replacingOccurrences(of: #"(\d) ft\b"#, with: "$1 feet", options: .regularExpression)
        let clearance = alert.clearanceFt.map { "\(Int(abs($0).rounded()).formatted()) feet \($0 >= 0 ? "below" : "above") you" }
        return [title, clearance, when(alert)].compactMap { $0 }.joined(separator: ", ")
    }

    /// What to say of the alerts ahead now, and the ids then said: each not
    /// said before, the first in full and the rest as a count; those gone
    /// from ahead forgotten, so met again they are said again.
    static func toSay(_ alerts: [AheadAlert], said: Set<String>) -> (words: String?, said: Set<String>) {
        let fresh = alerts.filter { !said.contains($0.id) }.sorted { $0.seconds < $1.seconds }
        var kept = said.filter { id in alerts.contains { $0.id == id } }
        fresh.forEach { kept.insert($0.id) }
        guard let first = fresh.first else { return (nil, kept) }
        let more = fresh.count - 1
        return ("\(line(first))\(more > 0 ? ", and \(more) more" : "").", kept)
    }

    /// Each answer of what is ahead.
    func hear(_ alerts: [AheadAlert]) {
        guard on else { return }
        let next = Self.toSay(alerts, said: said)
        said = next.said
        if let words = next.words { say(words) }
    }

    /// A line said over whatever else is playing, which ducks for it.
    func say(_ words: String, force: Bool = false) {
        guard on || force else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let utterance = AVSpeechUtterance(string: words)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        voice.speak(utterance)
    }
}
