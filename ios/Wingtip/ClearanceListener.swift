import AVFoundation
import Foundation
import Observation
import Speech
import UIKit

/// The radio heard through the microphone by Apple's own recognizer (the
/// Speech framework's SFSpeechRecognizer), a transmission at a time: on
/// the phone where it can be, so nothing said goes off it, and told the names near
/// the route to listen for (contextualStrings, /api/clearance/words) -- a
/// fix said as a word, "Pykla", is not English.
///
/// It goes on with the phone locked, as the owner asked (2026-11-02;
/// project.yml's UIBackgroundModes audio keeps the microphone open), and a
/// call to us (HeardCall) is said in a notification then (Notifications),
/// with the haptics in the app. Asked for with the system's own sheets
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

    /// The microphone open for one question to the assistant (hearOnce).
    private(set) var hearingOnce = false
    /// The words of that question so far.
    private var heardOnce: String?

    /// As many transmissions as are kept.
    private static let kept = 60
    /// A transmission is heard afresh at least this often, seconds.
    private static let longest: TimeInterval = 50
    /// A question is over this long after its last word, seconds, and
    /// at `longestOnce` whatever is still being said.
    private static let pause: TimeInterval = 1.5
    private static let longestOnce: TimeInterval = 20

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    /// The request the microphone's buffers go to, from the audio thread.
    private let feed = Feed()
    private var task: SFSpeechRecognitionTask?
    private var words: [String] = []
    private var next = 0
    private var cut: Task<Void, Never>?
    /// The system's word that another sound took the microphone (a phone
    /// call, Siri) and gave it back, while listening.
    private var interruptions: Task<Void, Never>?

    /// The microphone opened and the recognizer ready, with `problem` set
    /// where it cannot be: the permissions asked for with the system's
    /// sheets, the audio session for recording, the engine running with
    /// one tap feeding whichever request is being heard.
    private func openMicrophone() async -> Bool {
        problem = nil
        guard await Self.allowed() else {
            problem = "Microphone or speech recognition access was refused; allow it for Wingtip Maps in Settings."
            Log.radio.error("the microphone or speech recognition was refused")
            return false
        }
        guard let recognizer, recognizer.isAvailable else {
            problem = "Speech recognition is not available now."
            Log.radio.error("speech recognition is not available")
            return false
        }
        stop()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            problem = "No microphone could be used."
            Log.radio.error("the audio session could not be set up: \(error.localizedDescription, privacy: .public)")
            return false
        }
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
            Log.radio.error("the audio engine would not start: \(error.localizedDescription, privacy: .public)")
            return false
        }
        return true
    }

    func start(words: [String]) async {
        await Notifications.allow()
        guard await openMicrophone() else { return }
        self.words = words
        listening = true
        Log.radio.notice("listening to the radio, \(words.count) names to listen for")
        hear()
        // Taken away by a phone call or Siri, the microphone is listened
        // to again once the system gives it back, as Apple's audio guidance
        // has a recorder do; otherwise the radio went quiet for good until
        // the pilot tapped the microphone again.
        interruptions?.cancel()
        interruptions = Task { [weak self] in
            for await note in NotificationCenter.default.notifications(named: AVAudioSession.interruptionNotification) {
                guard let self, let kind = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      kind == AVAudioSession.InterruptionType.ended.rawValue else { continue }
                let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
                guard options.contains(.shouldResume) else { continue }
                let words = self.words
                await self.start(words: words)
            }
        }
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
        // What was said is the pilot's own: private off the device.
        if final { Log.radio.debug("heard\(forUs ? " for us" : ""): \(text, privacy: .private)") }
        if forUs && final && !wasFinal { tell(text) }
    }

    /// A call to us: a time-sensitive notification while the app is not
    /// in front, the haptics in the app (the call is on its screen).
    private func tell(_ text: String) {
        if !Notifications.tell("ATC called you", text) {
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        }
    }

    /// One thing said, for a question to the assistant (AskView): the
    /// microphone until the words settle -- a pause after the last of
    /// them, or `longestOnce` -- then closed again. Nothing heard goes in
    /// the radio's log, and nothing is kept. Nil with `problem` set where
    /// the microphone cannot be had, or when the radio is being listened
    /// to, which it would have to be stopped for.
    func hearOnce(words: [String] = []) async -> String? {
        guard !listening else {
            problem = "The radio is being listened to; stop it to ask by voice."
            return nil
        }
        guard await openMicrophone(), let recognizer else { return nil }
        hearingOnce = true
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .search
        request.contextualStrings = words
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        feed.set(request)
        heardOnce = nil
        let once = Once<String?>()
        let text: String? = await withCheckedContinuation { done in
            once.hold(done)
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                let text = result?.bestTranscription.formattedString
                let final = result?.isFinal == true || error != nil
                Task { @MainActor in
                    guard let self else { once.resume(nil); return }
                    if let text, !text.isEmpty { self.heardOnce = text }
                    if final {
                        once.resume(self.heardOnce)
                        return
                    }
                    // A pause after the last words is the end of the question.
                    self.cut?.cancel()
                    self.cut = Task { [weak request] in
                        try? await Task.sleep(for: .seconds(Self.pause))
                        if !Task.isCancelled { request?.endAudio() }
                    }
                }
            }
            cut = Task { [weak request] in
                try? await Task.sleep(for: .seconds(Self.longestOnce))
                if !Task.isCancelled { request?.endAudio() }
            }
        }
        hearingOnce = false
        stop()
        return text
    }

    /// One broadcast heard and no more -- an ATIS or AWOS off the
    /// field's frequency (Atis) -- as the web's lib/atis hears it: the
    /// words so far to `heard` as they come, and the whole once they
    /// stop coming for `pause` seconds, nothing has come for `nothing`
    /// seconds, or `longest` seconds have passed. Nil where the
    /// microphone or the recognizer refused (`problem` says why).
    func hearBroadcast(words: [String] = [], pause: TimeInterval = 3, nothing: TimeInterval = 15, longest: TimeInterval = 75,
                  heard: @MainActor (String) -> Void = { _ in }) async -> String? {
        let from = next
        await start(words: words)
        guard listening else { return nil }
        let began = Date()
        var last = began
        var said = ""
        defer { stop() }
        while listening {
            try? await Task.sleep(for: .milliseconds(250))
            let now = Date()
            let text = self.heard.filter { $0.id >= from }.map(\.text).joined(separator: " ")
            if text != said {
                said = text
                last = now
                heard(text)
            }
            let quiet = now.timeIntervalSince(last)
            if (said.isEmpty && quiet >= nothing) || (!said.isEmpty && quiet >= pause) || now.timeIntervalSince(began) >= longest { break }
        }
        return said
    }

    func stop() {
        listening = false
        cut?.cancel()
        interruptions?.cancel()
        interruptions = nil
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

/// A continuation resumed once, whichever of the recognizer's callbacks
/// (a final result, an error, a cancel) gets there first.
private final class Once<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Never>?

    func hold(_ continuation: CheckedContinuation<T, Never>) {
        lock.lock(); self.continuation = continuation; lock.unlock()
    }

    func resume(_ value: T) {
        lock.lock()
        let held = continuation
        continuation = nil
        lock.unlock()
        held?.resume(returning: value)
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
