import AVFoundation
import Capacitor
import Foundation
import Speech
import UIKit
import UserNotifications

/// The radio heard through the microphone by Apple's own speech recognizer
/// (the Speech framework's SFSpeechRecognizer), a transmission at a time,
/// each handed to the page as it is said (web/src/lib/listen,
/// lib/atcRadio): on the phone where it can be (supportsOnDeviceRecognition),
/// so nothing said goes off it, and told the names near the route to
/// listen for (contextualStrings, from /api/clearance/words) -- a fix
/// said as a word, "Pykla", is not English.
///
/// It goes on with the phone locked or the app in the background, as the
/// pilot asked (Info.plist's UIBackgroundModes audio keeps the microphone
/// open); a call to us heard then -- our call sign at its start, the
/// page's pattern (lib/heardCall callPattern) -- is said in a
/// notification, and in the app with a tap of the haptics. Asks with the
/// system's own sheets: NSSpeechRecognitionUsageDescription,
/// NSMicrophoneUsageDescription, and notifications.
@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechPlugin"
    public let jsName = "Speech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    /// A transmission is heard afresh at least this often, seconds: a
    /// recognition request is for one utterance, and a long one is cut.
    private static let longest: TimeInterval = 50

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audio = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var words: [String] = []
    private var callPattern: NSRegularExpression?
    private var listening = false
    /// The transmission being heard, numbered on from the first.
    private var id = 0
    private var cut: Timer?

    @objc func start(_ call: CAPPluginCall) {
        let words = call.getArray("words", String.self) ?? []
        let pattern = call.getString("callPattern").flatMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.reject("refused")
                return
            }
            Self.askMicrophone { allowed in
                if pattern != nil {
                    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
                }
                DispatchQueue.main.async {
                    if allowed {
                        self.begin(words, pattern, call)
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

    private func begin(_ words: [String], _ pattern: NSRegularExpression?, _ call: CAPPluginCall) {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            call.reject("Speech recognition is not available now.")
            return
        }
        end(notify: false)
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("audio-capture")
            return
        }
        self.words = words
        callPattern = pattern
        // One tap for the whole time listening, each buffer into whichever
        // transmission's request is being heard.
        let input = audio.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        audio.prepare()
        do {
            try audio.start()
        } catch {
            input.removeTap(onBus: 0)
            call.reject("audio-capture")
            return
        }
        listening = true
        next()
        call.resolve()
    }

    /// The next transmission, heard afresh.
    private func next() {
        guard listening, let recognizer = recognizer else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.contextualStrings = words
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        self.request = request
        let heard = id
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                self.notifyListeners("heard", data: ["id": heard, "text": text, "final": result.isFinal])
                if result.isFinal { self.tell(text) }
            }
            if error != nil || result?.isFinal == true {
                DispatchQueue.main.async {
                    guard self.id == heard else { return }
                    self.id += 1
                    self.next()
                }
            }
        }
        cut?.invalidate()
        cut = Timer.scheduledTimer(withTimeInterval: Self.longest, repeats: false) { [weak request] _ in request?.endAudio() }
    }

    /// A call to us: a notification while the app is not in front, a tap
    /// of the haptics while it is.
    private func tell(_ text: String) {
        guard let pattern = callPattern,
              pattern.firstMatch(in: text.lowercased(), range: NSRange(location: 0, length: (text.lowercased() as NSString).length)) != nil
        else { return }
        DispatchQueue.main.async {
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
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.end(notify: true)
            call.resolve()
        }
    }

    private func end(notify: Bool) {
        listening = false
        cut?.invalidate()
        cut = nil
        if audio.isRunning {
            audio.stop()
            audio.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if notify { notifyListeners("ended", data: [:]) }
    }
}
