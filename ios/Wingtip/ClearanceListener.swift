import AVFoundation
import Foundation
import Observation
import Speech
import UIKit
import UserNotifications

/// The radio heard through the microphone by Apple's own recognizer (the
/// Speech framework's SFSpeechRecognizer), a transmission at a time, as
/// the web app's shell hears it (web/ios's SpeechPlugin): on the phone
/// where it can be, so nothing said goes off it, and told the names near
/// the route to listen for (contextualStrings, /api/clearance/words) -- a
/// fix said as a word, "Pykla", is not English.
///
/// It goes on with the phone locked, as the owner asked (2026-11-02;
/// project.yml's UIBackgroundModes audio keeps the microphone open), and a
/// call to us (HeardCall) is said in a notification then, with the
/// haptics in the app. Asked for with the system's own sheets
/// (project.yml's usage strings).
@MainActor
@Observable
final class ClearanceListener {
    static let shared = ClearanceListener()

    struct Transmission: Identifiable, Equatable {
        let id: Int
        let at: Date
        var text: String
        var final: Bool
        var forUs: Bool
    }

    private(set) var heard: [Transmission] = []
    private(set) var listening = false
    /// Why it could not listen, in a pilot's words.
    private(set) var problem: String?
    /// The last call to us put away.
    var seen: Int?
    /// The clearance sheet, opened from the captions or a call's Enter
    /// Route, and the words it was opened with.
    var sheetShown = false
    var sheetText: String?
    /// The airplane whose calls are ours: the plan's registration.
    var tail: String?

    /// The newest call to us not yet put away, settled.
    var call: Transmission? {
        guard let last = heard.last(where: { $0.forUs && $0.final }), last.id != seen else { return nil }
        return last
    }

    /// As many transmissions as are kept.
    private static let kept = 60
    /// A transmission is heard afresh at least this often, seconds.
    private static let longest: TimeInterval = 50

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    /// The request the microphone's buffers go to, from the audio thread.
    private let feed = Feed()
    private var task: SFSpeechRecognitionTask?
    private var words: [String] = []
    private var next = 0
    private var cut: Task<Void, Never>?

    func start(words: [String]) async {
        problem = nil
        guard await Self.allowed() else {
            problem = "Microphone or speech recognition access was refused; allow it for Wingtip Maps in Settings."
            return
        }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        guard let recognizer, recognizer.isAvailable else {
            problem = "Speech recognition is not available now."
            return
        }
        stop()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            problem = "No microphone could be used."
            return
        }
        self.words = words
        // One tap for the whole time listening, each buffer into whichever
        // transmission's request is being heard.
        let input = audio.inputNode
        Self.tap(input, into: feed)
        audio.prepare()
        do {
            try audio.start()
        } catch {
            input.removeTap(onBus: 0)
            problem = "No microphone could be used."
            return
        }
        listening = true
        hear()
    }

    /// The next transmission, heard afresh.
    private func hear() {
        guard listening, let recognizer else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.contextualStrings = words
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        feed.set(request)
        let id = next
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let final = result?.isFinal == true
            let done = error != nil || final
            Task { @MainActor in
                guard let self else { return }
                if let text, !text.isEmpty { self.heard(id, text, final: final) }
                if done, self.next == id {
                    self.next += 1
                    self.hear()
                }
            }
        }
        cut?.cancel()
        cut = Task { [weak request] in
            try? await Task.sleep(for: .seconds(Self.longest))
            if !Task.isCancelled { request?.endAudio() }
        }
    }

    private func heard(_ id: Int, _ text: String, final: Bool) {
        let forUs = tail.map { HeardCall.ourCall(text, tail: $0) } ?? false
        let was = heard.firstIndex { $0.id == id }
        let wasFinal = was.map { heard[$0].final } ?? false
        let next = Transmission(id: id, at: was.map { heard[$0].at } ?? Date(), text: text, final: final, forUs: forUs)
        if let was { heard[was] = next } else { heard = Array((heard + [next]).suffix(Self.kept)) }
        if forUs && final && !wasFinal { tell(text) }
    }

    /// A call to us: the haptics in the app, a notification while it is
    /// not in front.
    private func tell(_ text: String) {
        if UIApplication.shared.applicationState == .active {
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            return
        }
        let content = UNMutableNotificationContent()
        content.title = "ATC called you"
        content.body = text
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    func stop() {
        listening = false
        cut?.cancel()
        if audio.isRunning {
            audio.stop()
            audio.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        feed.set(nil)
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// The microphone's tap, made off the main actor: its block runs on
    /// the audio thread.
    nonisolated private static func tap(_ input: AVAudioInputNode, into feed: Feed) {
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in feed.append(buffer) }
    }

    private static func allowed() async -> Bool {
        let speech = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { done.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
}

/// The request being heard, for the microphone's tap on the audio thread
/// to append to while the main actor moves it on from one transmission
/// to the next.
private final class Feed: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    func set(_ request: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock(); self.request = request; lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); request?.append(buffer); lock.unlock()
    }
}
