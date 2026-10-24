import MapKit
import SwiftUI

/// The map: the FAA chart as its ground, own ship on it, the fields in
/// view with their flight categories, and the route's course line.
/// MKMapView rather than SwiftUI's Map, for the tile overlay and the
/// renderers the route and the marks need.
/// A way from Routes, told from the course line by its class.
final class WayPolyline: MKPolyline {}

/// A procedure's path, told from the course line by its class.
final class ProcedurePolyline: MKPolyline {}

struct ChartMap: UIViewRepresentable {
    let template: TileTemplate?
    let minZoom: Int
    let maxZoom: Int
    /// The course line, fitted into view when it changes.
    let course: Course?
    /// The route's checkpoints, numbered along it.
    let checkpoints: [Checkpoint]
    /// A way from Routes shown beside the course, dashed.
    let shownWay: [CLLocationCoordinate2D]
    /// The procedures' paths the legs fly, drawn with the course.
    let procedurePaths: [[CLLocationCoordinate2D]]
    /// A field's mark tapped.
    var onAirport: ((String) -> Void)?
    /// Own ship kept in the middle; a pan by the pilot ends it.
    @Binding var following: Bool
    /// Whether the route is out of the view, for the arrow's other face.
    @Binding var routeAway: Bool
    /// Counted up to fit the whole route again.
    var fitRequest: Int = 0

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = true
        map.showsCompass = true
        map.showsScale = true
        map.pointOfInterestFilter = .excludingAll
        map.isPitchEnabled = false
        map.register(AirportMarkView.self, forAnnotationViewWithReuseIdentifier: AirportMarkView.reuse)
        map.register(CheckpointMarkView.self, forAnnotationViewWithReuseIdentifier: CheckpointMarkView.reuse)
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
        context.coordinator.setFollowing = { [self] on in following = on }
        context.coordinator.setRouteAway = { [self] away in if routeAway != away { routeAway = away } }
        if following, map.userTrackingMode != .follow {
            map.setUserTrackingMode(.follow, animated: true)
        } else if !following, map.userTrackingMode != .none {
            map.setUserTrackingMode(.none, animated: false)
        }
        if context.coordinator.fitted != fitRequest, let line = context.coordinator.courseLine {
            context.coordinator.fitted = fitRequest
            map.setVisibleMapRect(line.boundingMapRect, edgePadding: Self.routePadding(in: map), animated: true)
        }
        if let template, context.coordinator.overlay?.template != template {
            if let current = context.coordinator.overlay { map.removeOverlay(current) }
            let overlay = ChartTileOverlay(template: template, minZoom: minZoom, maxZoom: maxZoom)
            map.addOverlay(overlay, level: .aboveLabels)
            context.coordinator.overlay = overlay
        }
        if context.coordinator.checkpointsShown != checkpoints {
            context.coordinator.checkpointsShown = checkpoints
            map.removeAnnotations(context.coordinator.checkpointMarks)
            context.coordinator.checkpointMarks = checkpoints.enumerated().map { CheckpointAnnotation(number: $0.offset + 1, checkpoint: $0.element) }
            map.addAnnotations(context.coordinator.checkpointMarks)
        }
        if context.coordinator.wayShown.map({ $0.latitude }) != shownWay.map({ $0.latitude }) {
            context.coordinator.wayShown = shownWay
            if let line = context.coordinator.wayLine { map.removeOverlay(line) }
            context.coordinator.wayLine = nil
            if shownWay.count >= 2 {
                let line = WayPolyline(coordinates: shownWay, count: shownWay.count)
                map.addOverlay(line, level: .aboveLabels)
                context.coordinator.wayLine = line
                map.setVisibleMapRect(line.boundingMapRect, edgePadding: Self.routePadding(in: map), animated: true)
            }
        }
        if context.coordinator.proceduresShown.count != procedurePaths.count || zip(context.coordinator.proceduresShown, procedurePaths).contains(where: { $0.count != $1.count }) {
            context.coordinator.proceduresShown = procedurePaths
            map.removeOverlays(context.coordinator.procedureLines)
            context.coordinator.procedureLines = procedurePaths.filter { $0.count >= 2 }.map { ProcedurePolyline(coordinates: $0, count: $0.count) }
            map.addOverlays(context.coordinator.procedureLines, level: .aboveLabels)
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
                map.setVisibleMapRect(line.boundingMapRect, edgePadding: Self.routePadding(in: map), animated: true)
            }
        }
    }

    static func routePadding(in map: MKMapView) -> UIEdgeInsets {
        UIEdgeInsets(top: 80, left: 40, bottom: map.bounds.height * 0.5 + 40, right: 40)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var overlay: ChartTileOverlay?
        var courseLine: MKPolyline?
        var courseShown: Course?
        var checkpointsShown: [Checkpoint] = []
        var wayShown: [CLLocationCoordinate2D] = []
        var wayLine: WayPolyline?
        var proceduresShown: [[CLLocationCoordinate2D]] = []
        var procedureLines: [ProcedurePolyline] = []
        var checkpointMarks: [CheckpointAnnotation] = []
        var onAirport: ((String) -> Void)?
        var setFollowing: ((Bool) -> Void)?
        var setRouteAway: ((Bool) -> Void)?
        var fitted = 0
        let locations = CLLocationManager()
        private var followed = false
        private var fetching: Task<Void, Never>?
        private var shown: [String: AirportAnnotation] = [:]

        func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
            if let tiles = overlay as? MKTileOverlay { return MKTileOverlayRenderer(tileOverlay: tiles) }
            if let procedure = overlay as? ProcedurePolyline {
                // A procedure's path in the chart's procedure violet, as
                // the web app draws a picked one.
                let renderer = MKPolylineRenderer(polyline: procedure)
                renderer.strokeColor = UIColor(red: 0.36, green: 0.36, blue: 0.84, alpha: 1)
                renderer.lineWidth = 3
                renderer.lineJoin = .round
                return renderer
            }
            if let way = overlay as? WayPolyline {
                // A way from Routes, dashed in the tint, beside the course.
                let renderer = MKPolylineRenderer(polyline: way)
                renderer.strokeColor = UIColor.systemBlue
                renderer.lineWidth = 3
                renderer.lineDashPattern = [6, 6]
                return renderer
            }
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
            if annotation is CheckpointAnnotation {
                return mapView.dequeueReusableAnnotationView(withIdentifier: CheckpointMarkView.reuse, for: annotation)
            }
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
        /// The pilot's own pan ends the following, as Maps' does.
        func mapView(_ mapView: MKMapView, didChange mode: MKUserTrackingMode, animated: Bool) {
            setFollowing?(mode == .follow)
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            if let line = courseLine {
                // Off the route once less than a third of its box is in
                // the view above the sheet.
                let seen = mapView.visibleMapRect.intersection(line.boundingMapRect)
                let share = line.boundingMapRect.size.width * line.boundingMapRect.size.height
                setRouteAway?(share > 0 && (seen.size.width * seen.size.height) / share < 0.34)
            } else {
                setRouteAway?(false)
            }
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
