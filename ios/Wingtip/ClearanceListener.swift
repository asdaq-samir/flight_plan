import AVFoundation
import Foundation
import Observation
import Speech

/// A clearance heard through the microphone by Apple's own recognizer
/// (the Speech framework's SFSpeechRecognizer), its words as they come,
/// as the web app's shell hears one (web/ios's SpeechPlugin): on the phone
/// where it can be, so nothing said goes off it, and told the names near
/// the route to listen for (contextualStrings, /api/clearance/words) -- a
/// fix said as a word, "Pykla", is not English. Asked for with the
/// system's own sheets (project.yml's usage strings).
@MainActor
@Observable
final class ClearanceListener {
    /// What was heard so far, the whole of it.
    var heard = ""
    private(set) var listening = false
    /// Why it could not listen, in a pilot's words.
    private(set) var problem: String?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func start(words: [String]) async {
        problem = nil
        guard await Self.allowed() else {
            problem = "Microphone or speech recognition access was refused; allow it for Wingtip Maps in Settings."
            return
        }
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
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.contextualStrings = words
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        let input = audio.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in request.append(buffer) }
        audio.prepare()
        do {
            try audio.start()
        } catch {
            input.removeTap(onBus: 0)
            problem = "No microphone could be used."
            return
        }
        self.request = request
        heard = ""
        listening = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let done = error != nil || result?.isFinal == true
            Task { @MainActor in
                guard let self else { return }
                if let text { self.heard = text }
                if done {
                    if error != nil && self.heard.isEmpty { self.problem = "Nothing was heard. Hold the phone near the speaker and try again." }
                    self.finish()
                }
            }
        }
    }

    /// Stops listening: what was heard settles, then it ends.
    func stop() {
        guard listening else { return }
        stopAudio()
        request?.endAudio()
    }

    private func stopAudio() {
        if audio.isRunning {
            audio.stop()
            audio.inputNode.removeTap(onBus: 0)
        }
    }

    private func finish() {
        stopAudio()
        request = nil
        task = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static func allowed() async -> Bool {
        let speech = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { done.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
}
