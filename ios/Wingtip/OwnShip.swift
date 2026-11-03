import CoreLocation
import Foundation
import Observation

/// Own ship: where the phone is, which way it is going and how fast, from
/// Core Location at one fix a second while the map is shown, as the web
/// app's useOwnShip keeps it. Nothing is worked out from the fix here
/// but the figures of flying it: the distance and time to the next point
/// and what is ahead on the track, which the planner is asked for
/// (/api/airspace/ahead).
@MainActor
@Observable
final class OwnShip: NSObject, CLLocationManagerDelegate {
    struct Fix: Equatable, Sendable {
        let coordinate: CLLocationCoordinate2D
        let altitudeFt: Double?
        let trackDeg: Double?
        let groundspeedKt: Double?
        let accuracyM: Double
        let at: Date

        static func == (a: Fix, b: Fix) -> Bool { a.at == b.at }
    }

    private(set) var fix: Fix?
    private(set) var denied = false
    /// What the track runs into in the next minutes, from the planner.
    private(set) var ahead: [AheadAlert] = []

    private let manager = CLLocationManager()
    private var asking: Task<Void, Never>?
    private var lastAsked: Date = .distantPast

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .airborne
        // Kept going with the phone locked or the app put away while the
        // airplane is at flying speed (took): the alerts ahead and the
        // path flown (OwnTrail) went on only with the screen on, where a
        // pilot's phone in a mount locks itself. Never paused by the
        // system for a still airplane, which is a slow one. Apple's blue
        // bar says the position is being read (the HIG asks for it).
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
    }

    func start() {
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let fix = Fix(
            coordinate: last.coordinate,
            altitudeFt: last.verticalAccuracy >= 0 ? last.altitude * 3.28084 : nil,
            trackDeg: last.course >= 0 ? last.course : nil,
            groundspeedKt: last.speed >= 0 ? last.speed * 1.943844 : nil,
            accuracyM: last.horizontalAccuracy, at: last.timestamp
        )
        Task { @MainActor in self.took(fix) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        let denied = status == .denied || status == .restricted
        Task { @MainActor in self.denied = denied }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {}

    private func took(_ fix: Fix) {
        self.fix = fix
        // The path flown, and the phone's position kept in the background
        // only while flying (the location background mode, project.yml):
        // on the ground the reading stops with the app, as any map's does.
        let flying = OwnTrail.shared.took(fix)
        if manager.allowsBackgroundLocationUpdates != flying { manager.allowsBackgroundLocationUpdates = flying }
        // What is ahead, asked every ten seconds while moving: the planner
        // looks five minutes along the track (vfr.alerts).
        guard let track = fix.trackDeg, let gs = fix.groundspeedKt, gs > 20, Date().timeIntervalSince(lastAsked) > 10 else { return }
        lastAsked = Date()
        asking?.cancel()
        asking = Task { [weak self] in
            let (lat, lon) = (fix.coordinate.latitude, fix.coordinate.longitude)
            let alerts: [AheadAlert]
            if let online = try? await Planner.ahead(lat: lat, lon: lon, trackDeg: track, groundspeedKt: gs, altitudeFt: fix.altitudeFt) {
                alerts = online
            } else if let offline = CyclePacks.shared.ahead(lat: lat, lon: lon, trackDeg: track, groundspeedKt: gs, altitudeFt: fix.altitudeFt) {
                // No planner in the air: the same alerts from the packs kept
                // for the route (CyclePacks.ahead).
                alerts = offline.alerts
            } else {
                return
            }
            guard !Task.isCancelled else { return }
            self?.ahead = alerts
        }
    }
}
