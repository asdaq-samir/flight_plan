import MapKit
import SwiftUI

/// The map: the FAA chart as its ground, own ship on it, and nothing of
/// Apple's map under it. MKMapView rather than SwiftUI's Map, for the
/// tile overlay and the renderers the route and the marks will need.
struct ChartMap: UIViewRepresentable {
    let template: TileTemplate?
    let minZoom: Int
    let maxZoom: Int

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = true
        map.showsCompass = true
        map.showsScale = true
        map.pointOfInterestFilter = .excludingAll
        map.isPitchEnabled = false
        // The chart hides Apple's map; its labels would draw through
        // where a tile is missing, so none are shown at all.
        let config = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
        config.pointOfInterestFilter = .excludingAll
        config.showsTraffic = false
        map.preferredConfiguration = config
        // Fresh open at zoom 7 on the position, as the web app does
        // (lib/map): the Great Lakes until the position comes.
        map.setRegion(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 42.3, longitude: -88.0),
                                         latitudinalMeters: 600_000, longitudinalMeters: 600_000), animated: false)
        context.coordinator.locations.requestWhenInUseAuthorization()
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        guard let template else { return }
        if let current = context.coordinator.overlay, current.template == template { return }
        if let current = context.coordinator.overlay { map.removeOverlay(current) }
        let overlay = ChartTileOverlay(template: template, minZoom: minZoom, maxZoom: maxZoom)
        map.addOverlay(overlay, level: .aboveLabels)
        context.coordinator.overlay = overlay
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var overlay: ChartTileOverlay?
        let locations = CLLocationManager()
        private var followed = false

        func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
            if let tiles = overlay as? MKTileOverlay { return MKTileOverlayRenderer(tileOverlay: tiles) }
            return MKOverlayRenderer(overlay: overlay)
        }

        /// The first position moves the map there once, at the web app's
        /// opening zoom; after that the pilot's own panning stands.
        func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
            guard !followed, let at = userLocation.location else { return }
            followed = true
            mapView.setRegion(MKCoordinateRegion(center: at.coordinate, latitudinalMeters: 300_000, longitudinalMeters: 300_000), animated: true)
        }
    }
}
