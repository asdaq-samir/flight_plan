import AVFoundation
import Capacitor
import Foundation
import Speech

/// An ATC clearance heard through the microphone by Apple's own speech
/// recognizer (the Speech framework's SFSpeechRecognizer), the words
/// handed to the page as they come, which reads them into the route
/// (web/src/lib/listen, lib/clearance). On the phone where it can be
/// (supportsOnDeviceRecognition), so nothing said goes off it, and told
/// the names near the route to listen for (contextualStrings, from the
/// planner's /api/clearance/words): a fix said as a word, "Pykla", is not
/// English. Asks with the system's own sheets, Info.plist's
/// NSSpeechRecognitionUsageDescription and NSMicrophoneUsageDescription.
@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechPlugin"
    public let jsName = "Speech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    /// Whether anything was heard: a recognizer stopped after words ends
    /// with an error of its own, which is no failure.
    private var heardAny = false

    @objc func start(_ call: CAPPluginCall) {
        let words = call.getArray("words", String.self) ?? []
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.reject("refused")
                return
            }
            Self.askMicrophone { allowed in
                DispatchQueue.main.async {
                    if allowed {
                        self.begin(words, call)
                    } else {
                        call.reject("refused")
                    }
                }
            }
        }
    }

    private static func askMicrophone(_ answer: @escaping (Bool) -> Void) {
        if #available(iOS 17, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: answer)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(answer)
        }
    }

    private func begin(_ words: [String], _ call: CAPPluginCall) {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            call.reject("Speech recognition is not available now.")
            return
        }
        finish(nil, notify: false)
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("audio-capture")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.contextualStrings = words
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        let input = audio.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        audio.prepare()
        do {
            try audio.start()
        } catch {
            input.removeTap(onBus: 0)
            call.reject("audio-capture")
            return
        }
        self.request = request
        heardAny = false
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            if let result = result {
                self?.heardAny = true
                self?.notifyListeners("heard", data: ["text": result.bestTranscription.formattedString, "final": result.isFinal])
            }
            if error != nil || result?.isFinal == true {
                DispatchQueue.main.async { self?.finish(error) }
            }
        }
        call.resolve()
    }

    /// Stops listening: what was heard is settled and handed over as
    /// final, then the end said.
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.task == nil {
                self.notifyListeners("ended", data: [:])
            } else {
                self.stopAudio()
                self.request?.endAudio()
            }
            call.resolve()
        }
    }

    private func stopAudio() {
        if audio.isRunning {
            audio.stop()
            audio.inputNode.removeTap(onBus: 0)
        }
    }

    private func finish(_ error: Error?, notify: Bool = true) {
        stopAudio()
        request?.endAudio()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard notify else { return }
        if error != nil && !heardAny {
            notifyListeners("ended", data: ["error": "no-speech"])
        } else {
            notifyListeners("ended", data: [:])
        }
    }
}
