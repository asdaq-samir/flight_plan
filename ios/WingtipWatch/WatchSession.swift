import Foundation
import Observation
import WatchConnectivity

/// The watch's end of the phone (Wingtip/WatchLink.swift): the last
/// context the phone sent -- the airplane, its checklist and the phone's
/// fix -- kept here for the screens, and the questions the watch asks
/// the phone, answered while the phone is in reach. The messages are the
/// structs in Wingtip/Shared/WatchMessages.swift.
@MainActor
@Observable
final class WatchSession: NSObject, WCSessionDelegate {
    private(set) var context: WatchContext?
    private(set) var reachable = false

    func start() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /// The fields nearest a point, asked of the phone, which asks the
    /// planner. Throws where the phone is out of reach or does not answer.
    func nearest(lat: Double, lon: Double) async throws -> NearestReply {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { throw WatchProblem.phoneOutOfReach }
        let request = try WatchCoding.encoder.encode(NearestRequest(lat: lat, lon: lon))
        let answer: Data = try await withCheckedThrowingContinuation { continuation in
            session.sendMessage([WatchMessageKey.nearest: request], replyHandler: { reply in
                if let data = reply[WatchMessageKey.nearest] as? Data {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: WatchProblem.noAnswer)
                }
            }, errorHandler: { error in
                continuation.resume(throwing: error)
            })
        }
        return try WatchCoding.decoder.decode(NearestReply.self, from: answer)
    }

    private func took(_ data: Data) {
        guard let context = try? WatchCoding.decoder.decode(WatchContext.self, from: data) else { return }
        self.context = context
    }

    /// The context the phone sent while the watch slept is there on
    /// activation (receivedApplicationContext), before any new one.
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {
        let data = session.receivedApplicationContext[WatchMessageKey.context] as? Data
        let reachable = session.isReachable
        Task { @MainActor in
            self.reachable = reachable
            if let data { self.took(data) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let data = applicationContext[WatchMessageKey.context] as? Data else { return }
        Task { @MainActor in self.took(data) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in self.reachable = reachable }
    }
}

enum WatchProblem: LocalizedError {
    case phoneOutOfReach
    case noAnswer
    case noPosition

    var errorDescription: String? {
        switch self {
        case .phoneOutOfReach: return "The iPhone is out of reach."
        case .noAnswer: return "The iPhone did not answer."
        case .noPosition: return "No position yet."
        }
    }
}
