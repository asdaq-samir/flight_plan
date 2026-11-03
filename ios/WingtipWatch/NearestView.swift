import CoreLocation
import Observation
import SwiftUI

/// Where the watch is, from its own Core Location (one fix at a time,
/// asked for when the screen wants one); nil until it has one or where
/// the pilot has said no, when the phone's fix stands in.
@MainActor
@Observable
final class WatchLocation: NSObject, CLLocationManagerDelegate {
    private(set) var coordinate: CLLocationCoordinate2D?
    private(set) var denied = false

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func ask() {
        manager.requestWhenInUseAuthorization()
        manager.requestLocation()
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let coordinate = last.coordinate
        Task { @MainActor in self.coordinate = coordinate }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        let denied = status == .denied || status == .restricted
        Task { @MainActor in self.denied = denied }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {}
}

/// The fields nearest the pilot, nearest first, each with its distance
/// and bearing from here, as the planner works them out: the watch asks
/// the phone (WatchSession.nearest) from its own position, or from the
/// phone's last fix where it has none.
struct NearestView: View {
    @Environment(WatchSession.self) private var session
    @State private var location = WatchLocation()
    @State private var airports: [WatchAirport] = []
    @State private var problem: String?
    @State private var asking = false

    var body: some View {
        NavigationStack {
            Group {
                if let problem, airports.isEmpty {
                    ContentUnavailableView("No airports", systemImage: "antenna.radiowaves.left.and.right.slash", description: Text(problem))
                } else if airports.isEmpty {
                    ContentUnavailableView(asking ? "Asking the iPhone…" : "Nearest airports", systemImage: "airplane.circle", description: Text(asking ? "" : "Tap refresh to ask."))
                } else {
                    List(airports) { airport in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(airport.ident).font(.headline)
                                Spacer()
                                Text(String(format: "%.1f nm", airport.distanceNm)).monospacedDigit()
                            }
                            HStack(alignment: .firstTextBaseline) {
                                Text(airport.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                Spacer()
                                Text(String(format: "%03.0f°", airport.bearingDeg)).font(.caption).monospacedDigit()
                            }
                            if let category = airport.flightCategory {
                                Text(category).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Nearest")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await ask() } } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(asking)
                        .accessibilityLabel("Refresh")
                }
            }
            .task {
                location.ask()
                await ask()
            }
        }
    }

    /// The watch's own position where it has one, else the phone's fix.
    private var here: (lat: Double, lon: Double)? {
        if let c = location.coordinate { return (c.latitude, c.longitude) }
        if let fix = session.context?.fix { return (fix.lat, fix.lon) }
        return nil
    }

    private func ask() async {
        guard !asking else { return }
        asking = true
        defer { asking = false }
        // The watch's fix comes a moment after it is asked for; the
        // phone's stands in until then.
        if location.coordinate == nil, !location.denied {
            try? await Task.sleep(for: .seconds(2))
        }
        guard let here else {
            problem = WatchProblem.noPosition.localizedDescription
            return
        }
        do {
            let reply = try await session.nearest(lat: here.lat, lon: here.lon)
            airports = reply.airports
            problem = reply.problem
        } catch {
            problem = error.localizedDescription
        }
    }
}
