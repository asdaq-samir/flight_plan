import MapKit
import SwiftUI

/// The map: the FAA chart as its ground, own ship on it, the fields in
/// view with their flight categories, and the route's course line.
/// MKMapView rather than SwiftUI's Map, for the tile overlay and the
/// renderers the route and the marks need.
struct ChartMap: UIViewRepresentable {
    let template: TileTemplate?
    let minZoom: Int
    let maxZoom: Int
    /// The course line, fitted into view when it changes.
    let course: Course?
    /// A field's mark tapped.
    var onAirport: ((String) -> Void)?

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = true
        map.showsCompass = true
        map.showsScale = true
        map.pointOfInterestFilter = .excludingAll
        map.isPitchEnabled = false
        map.register(AirportMarkView.self, forAnnotationViewWithReuseIdentifier: AirportMarkView.reuse)
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
        context.coordinator.onAirport = onAirport
        if let template, context.coordinator.overlay?.template != template {
            if let current = context.coordinator.overlay { map.removeOverlay(current) }
            let overlay = ChartTileOverlay(template: template, minZoom: minZoom, maxZoom: maxZoom)
            map.addOverlay(overlay, level: .aboveLabels)
            context.coordinator.overlay = overlay
        }
        if context.coordinator.courseShown != course {
            context.coordinator.courseShown = course
            if let line = context.coordinator.courseLine { map.removeOverlay(line) }
            context.coordinator.courseLine = nil
            if let course, course.coordinates.count >= 2 {
                let line = MKPolyline(coordinates: course.coordinates, count: course.coordinates.count)
                map.addOverlay(line, level: .aboveLabels)
                context.coordinator.courseLine = line
                // The whole route in sight above the sheet, which covers
                // the lower half: as the web app fits a route clear of it.
                let padding = UIEdgeInsets(top: 80, left: 40, bottom: map.bounds.height * 0.5 + 40, right: 40)
                map.setVisibleMapRect(line.boundingMapRect, edgePadding: padding, animated: true)
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var overlay: ChartTileOverlay?
        var courseLine: MKPolyline?
        var courseShown: Course?
        var onAirport: ((String) -> Void)?
        let locations = CLLocationManager()
        private var followed = false
        private var fetching: Task<Void, Never>?
        private var shown: [String: AirportAnnotation] = [:]

        func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
            if let tiles = overlay as? MKTileOverlay { return MKTileOverlayRenderer(tileOverlay: tiles) }
            if let line = overlay as? MKPolyline {
                // The web app's magenta course line, a halo under it.
                let renderer = MKPolylineRenderer(polyline: line)
                renderer.strokeColor = UIColor(red: 0.9, green: 0, blue: 0.9, alpha: 1)
                renderer.lineWidth = 3
                renderer.lineJoin = .round
                renderer.lineCap = .round
                return renderer
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
            guard annotation is AirportAnnotation else { return nil }
            return mapView.dequeueReusableAnnotationView(withIdentifier: AirportMarkView.reuse, for: annotation)
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            guard let field = view.annotation as? AirportAnnotation else { return }
            mapView.deselectAnnotation(field, animated: false)
            onAirport?(field.ident)
        }

        /// The first position moves the map there once, at the web app's
        /// opening zoom; after that the pilot's own panning stands.
        func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
            guard !followed, let at = userLocation.location else { return }
            followed = true
            mapView.setRegion(MKCoordinateRegion(center: at.coordinate, latitudinalMeters: 300_000, longitudinalMeters: 300_000), animated: true)
        }

        /// The fields in view, asked for once the map has rested a third
        /// of a second, as the web app asks (/api/airports/in-view): the
        /// planner picks fewer and bigger ones as the view widens.
        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            fetching?.cancel()
            let region = mapView.region
            fetching = Task { [weak self, weak mapView] in
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled, let self, let mapView else { return }
                let south = region.center.latitude - region.span.latitudeDelta / 2
                let north = region.center.latitude + region.span.latitudeDelta / 2
                let west = region.center.longitude - region.span.longitudeDelta / 2
                let east = region.center.longitude + region.span.longitudeDelta / 2
                guard let pins = try? await Planner.airports(south: south, west: west, north: north, east: east), !Task.isCancelled else { return }
                await MainActor.run { self.show(pins.map(AirportAnnotation.init), on: mapView) }
            }
        }

        /// The marks changed, not every mark drawn again: the ones gone
        /// out of view removed, the new ones added, the rest left be.
        @MainActor
        private func show(_ fields: [AirportAnnotation], on map: MKMapView) {
            let fresh = Dictionary(fields.map { ($0.ident, $0) }, uniquingKeysWith: { a, _ in a })
            let gone = shown.filter { fresh[$0.key] == nil }.map(\.value)
            let new = fresh.filter { shown[$0.key] == nil }.map(\.value)
            map.removeAnnotations(gone)
            map.addAnnotations(new)
            for mark in gone { shown[mark.ident] = nil }
            for mark in new { shown[mark.ident] = mark }
        }
    }
}
