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
        // What is ahead, asked every ten seconds while moving: the planner
        // looks five minutes along the track (vfr.alerts).
        guard let track = fix.trackDeg, let gs = fix.groundspeedKt, gs > 20, Date().timeIntervalSince(lastAsked) > 10 else { return }
        lastAsked = Date()
        asking?.cancel()
        asking = Task { [weak self] in
            guard let alerts = try? await Planner.ahead(lat: fix.coordinate.latitude, lon: fix.coordinate.longitude, trackDeg: track, groundspeedKt: gs, altitudeFt: fix.altitudeFt),
                  !Task.isCancelled else { return }
            self?.ahead = alerts
        }
    }
}
