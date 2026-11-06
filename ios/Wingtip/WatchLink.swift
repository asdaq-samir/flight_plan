import Foundation
import WatchConnectivity

/// The phone's end of the watch (WingtipWatch, the owner's ask of
/// 2026-11-03): the airplane's checklist and the pilot's fix handed over
/// as the application context, which WatchConnectivity keeps and delivers
/// when the watch wakes, and the watch's questions answered as messages.
/// The watch links no engine, so the nearest airports it asks for are
/// fetched here from the planner (Planner.nearest); the phone's cycle
/// packs answer the airspace at a point only, not the fields near one,
/// so with no signal the watch is told so. The messages are the structs
/// in Shared/WatchMessages.swift.
@MainActor
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()

    /// The checklist of the airplane last fetched, by its N-number, so the
    /// gateway is asked once an airplane rather than once a tick.
    private var checklistFor: String?
    private var checklist: Checklist?
    /// The last context sent, so an unchanged one is not sent again.
    private var sentContext: Data?

    private override init() { super.init() }

    /// Activated, then kept up: every few seconds the picked airplane's
    /// checklist (fetched when the airplane changes) and the fix are sent,
    /// where the phone has a paired watch with the app on it. Returns
    /// only when the task that runs it is cancelled.
    func run(plan: Plan, ownShip: OwnShip) async {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        await Ticker.shared.run(every: 5) { [weak self] in await self?.sync(plan: plan, ownShip: ownShip) }
    }

    private func sync(plan: Plan, ownShip: OwnShip) async {
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        if plan.tail != checklistFor {
            checklistFor = plan.tail
            checklist = nil
            if let tail = plan.tail { checklist = await fetchChecklist(tail) }
        }
        let fix = ownShip.fix.map {
            WatchFix(lat: $0.coordinate.latitude, lon: $0.coordinate.longitude, altitudeFt: $0.altitudeFt,
                     trackDeg: $0.trackDeg, groundspeedKt: $0.groundspeedKt, at: $0.at)
        }
        // The gateway's checklist re-read as the watch's own type, from the
        // same JSON: one shape, two compiled copies.
        let watchChecklist = checklist.flatMap { c -> WatchChecklist? in
            guard let data = try? JSONEncoder().encode(c) else { return nil }
            return try? JSONDecoder().decode(WatchChecklist.self, from: data)
        }
        let context = WatchContext(tail: plan.tail, checklist: watchChecklist, fix: fix, sentAt: Date())
        // Compared without the time of sending, which is always new.
        var same = context
        same.sentAt = Date(timeIntervalSince1970: 0)
        guard let key = try? WatchCoding.encoder.encode(same), key != sentContext,
              let data = try? WatchCoding.encoder.encode(context) else { return }
        do {
            try session.updateApplicationContext([WatchMessageKey.context: data])
            sentContext = key
        } catch {
            // Sent again next tick; a watch out of reach is not a problem
            // the pilot can act on.
        }
    }

    private func fetchChecklist(_ tail: String) async -> Checklist? {
        guard let records = try? await Gateway.aircraftRecords(),
              let record = records.first(where: { $0.tailNumber == tail }) else { return nil }
        return try? await Gateway.checklist(record.id)
    }

    /// The watch's question answered from the planner. The handler is
    /// called on whichever queue WatchConnectivity holds, so the answer is
    /// handed back from a detached task rather than the main actor.
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard let data = message[WatchMessageKey.nearest] as? Data,
              let request = try? WatchCoding.decoder.decode(NearestRequest.self, from: data) else {
            replyHandler([:])
            return
        }
        Task.detached {
            let reply = await WatchLink.nearest(request)
            let answer = (try? WatchCoding.encoder.encode(reply)) ?? Data()
            replyHandler([WatchMessageKey.nearest: answer])
        }
    }

    nonisolated static func nearest(_ request: NearestRequest) async -> NearestReply {
        do {
            let fields = try await Planner.nearest(lat: request.lat, lon: request.lon, limit: request.limit)
            let airports = fields.map {
                WatchAirport(ident: $0.ident, name: $0.name, lat: $0.lat, lon: $0.lon,
                             distanceNm: $0.distanceNm, bearingDeg: $0.bearingDeg, flightCategory: $0.flightCategory)
            }
            return NearestReply(airports: airports, problem: nil)
        } catch {
            return NearestReply(airports: [], problem: "The phone could not reach the planner: \(error.localizedDescription)")
        }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {}

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    /// A watch swapped for another: the session is activated again for
    /// the new one, as Apple asks.
    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
