import MapKit
import UIKit

/// What the map draws of the airplanes tracked and the flights flown, and
/// the tap it answers for them: an airplane's mark, opening its card. (A
/// long press is the airspace card's, MapExtras.)
struct FlightLayer {
    var trackedHex: String?
    var tracked: TrafficAircraft?
    var follow = false
    var path: [PathPoint] = []
    var past: [PathPoint] = []
    var flown: [PathPoint] = []
    var onTraffic: ((TrafficAircraft) -> Void)?
    /// The pilot dragged the map off the airplane followed.
    var onDragged: (() -> Void)?
}

/// A run of a flown path in one colour, its height's.
final class HeightPolyline: MKPolyline {
    var colour: UIColor = .systemGray
}

/// The white casing under a flown path, so it holds over any chart colour.
final class CasingPolyline: MKPolyline {}

/// The ring round the airplane tracked, as the web app's TrafficLayer
/// draws it.
final class TrackedRing: MKPointAnnotation {}

final class TrackedRingView: MKAnnotationView {
    static let reuse = "tracked-ring"

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 40, height: 40)
        layer.cornerRadius = 20
        layer.borderWidth = 3
        layer.borderColor = UIColor.systemBlue.cgColor
        backgroundColor = UIColor.systemBlue.withAlphaComponent(0.12)
        isEnabled = false
        displayPriority = .required
        zPriority = .min
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }
}

/// The map's part for them, kept by ChartMap's coordinator.
@MainActor
final class FlightMapLayer: NSObject {
    private var layer = FlightLayer()
    private var ring: TrackedRing?
    private var lines: [String: [MKPolyline]] = [:]
    private var drawn: [String: [PathPoint]] = [:]
    private var centred: CLLocationCoordinate2D?
    private weak var map: MKMapView?

    func attach(_ map: MKMapView) {
        self.map = map
        map.register(TrackedRingView.self, forAnnotationViewWithReuseIdentifier: TrackedRingView.reuse)
    }

    func update(_ map: MKMapView, _ next: FlightLayer) {
        layer = next
        // The ring on the airplane tracked, where its report puts it.
        if let plane = next.tracked, plane.hex.lowercased() == next.trackedHex {
            let at = CLLocationCoordinate2D(latitude: plane.lat, longitude: plane.lon)
            let ring = ring ?? { let mark = TrackedRing(); self.ring = mark; map.addAnnotation(mark); return mark }()
            ring.coordinate = at
            // Kept in the middle while followed, as Maps follows a position.
            if next.follow, centred?.latitude != at.latitude || centred?.longitude != at.longitude {
                centred = at
                map.setCenter(at, animated: true)
            }
        } else if let ring {
            map.removeAnnotation(ring)
            self.ring = nil
            centred = nil
        }
        draw("path", next.path, on: map)
        draw("past", next.past, on: map, fit: true)
        draw("flown", next.flown, on: map, fit: true)
    }

    /// A path in its heights' colours over a white casing, drawn again
    /// only where it changed; fitted into view once where asked.
    private func draw(_ key: String, _ path: [PathPoint], on map: MKMapView, fit: Bool = false) {
        guard drawn[key] != path else { return }
        let first = drawn[key]?.isEmpty ?? true
        drawn[key] = path
        map.removeOverlays(lines[key] ?? [])
        lines[key] = nil
        guard path.count >= 2 else { return }
        let coordinates = path.map(\.coordinate)
        var overlays: [MKPolyline] = [CasingPolyline(coordinates: coordinates, count: coordinates.count)]
        for run in HeightColour.runs(path) where run.points.count >= 2 {
            let line = HeightPolyline(coordinates: run.points, count: run.points.count)
            line.colour = HeightColour.colour(run.band)
            overlays.append(line)
        }
        map.addOverlays(overlays, level: .aboveLabels)
        lines[key] = overlays
        if fit, first, let casing = overlays.first {
            map.setVisibleMapRect(casing.boundingMapRect, edgePadding: ChartMap.routePadding(in: map), animated: true)
        }
    }

    func renderer(for overlay: any MKOverlay) -> MKOverlayRenderer? {
        if let casing = overlay as? CasingPolyline {
            let renderer = MKPolylineRenderer(polyline: casing)
            renderer.strokeColor = UIColor.white.withAlphaComponent(0.85)
            renderer.lineWidth = 6
            renderer.lineJoin = .round
            renderer.lineCap = .round
            return renderer
        }
        if let line = overlay as? HeightPolyline {
            let renderer = MKPolylineRenderer(polyline: line)
            renderer.strokeColor = line.colour
            renderer.lineWidth = 3
            renderer.lineJoin = .round
            renderer.lineCap = .round
            return renderer
        }
        return nil
    }

    func view(for annotation: any MKAnnotation, on map: MKMapView) -> MKAnnotationView? {
        guard annotation is TrackedRing else { return nil }
        return map.dequeueReusableAnnotationView(withIdentifier: TrackedRingView.reuse, for: annotation)
    }

    /// An airplane's mark tapped: its card. True where it was one.
    func selected(_ view: MKAnnotationView, on map: MKMapView) -> Bool {
        guard let mark = view.annotation as? TrafficAnnotation else { return false }
        map.deselectAnnotation(mark, animated: false)
        layer.onTraffic?(mark.plane)
        return true
    }

    /// The pilot's own drag ends the following, as Maps' does; the map's
    /// own move to the airplane does not.
    func regionWillChange(_ map: MKMapView) {
        guard layer.follow, layer.trackedHex != nil else { return }
        let touched = map.subviews.first?.gestureRecognizers?.contains { $0.state == .began || $0.state == .changed } ?? false
        if touched { layer.onDragged?() }
    }
}
