import MapKit
import SwiftUI

/// The map: the FAA chart as its ground, own ship on it, the fields in
/// view with their flight categories, and the route's course line.
/// MKMapView rather than SwiftUI's Map, for the tile overlay and the
/// renderers the route and the marks need.
/// A procedure's path, told from the course line by its class.
final class ProcedurePolyline: MKPolyline {}

/// The dry run's airplane: a blue arrow in a white casing, as the web app
/// draws own ship, turned to its track.
final class PlaneAnnotation: MKPointAnnotation {
    var heading: Double = 0
}

final class PlaneMarkView: MKAnnotationView {
    static let reuse = "plane"
    private let arrow = UIImageView(image: UIImage(systemName: "location.north.fill"))

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 28, height: 28)
        arrow.frame = bounds.insetBy(dx: 3, dy: 3)
        arrow.contentMode = .scaleAspectFit
        arrow.tintColor = UIColor.systemBlue
        backgroundColor = NightPalette.markFill
        layer.cornerRadius = 14
        layer.borderWidth = 1
        layer.borderColor = UIColor(white: 0.1, alpha: 0.4).cgColor
        addSubview(arrow)
        displayPriority = .required
        isEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    func turn(to degrees: Double) {
        arrow.transform = CGAffineTransform(rotationAngle: degrees * .pi / 180)
    }
}

struct ChartMap: UIViewRepresentable {
    let template: TileTemplate?
    let minZoom: Int
    let maxZoom: Int
    /// The course line, fitted into view when it changes.
    let course: Course?
    /// The route's checkpoints, numbered along it.
    let checkpoints: [Checkpoint]
    /// The procedures' paths the legs fly, drawn with the course.
    let procedurePaths: [[CLLocationCoordinate2D]]
    /// A dry run's airplane, where it is and which way it points.
    let simulated: OwnShip.Fix?
    /// The airplanes heard about, and own ship's height to set theirs
    /// against.
    var traffic: [TrafficAircraft] = []
    var ownFt: Double?
    /// Where the map rested: its middle and the miles to its corner.
    var onRegion: ((CLLocationCoordinate2D, Double) -> Void)?
    /// A field's mark tapped.
    var onAirport: ((String) -> Void)?
    /// Own ship kept in the middle; a pan by the pilot ends it.
    @Binding var following: Bool
    /// Whether the route is out of the view, for the arrow's other face.
    @Binding var routeAway: Bool
    /// Counted up to fit the whole route again.
    var fitRequest: Int = 0
    /// The airplane tracked, the flights flown, and the long press for a
    /// point of the route (FlightMapLayer).
    var flight = FlightLayer()
    /// A held finger's pin, the waypoints, the Class B fields and the
    /// plates (MapExtras.swift).
    var extras = MapExtrasInput()
    /// Dark appearance and Setup's Chart at night, for the chart's dimming
    /// and the course's night magenta (NightPalette).
    @Environment(\.colorScheme) var colorScheme
    @AppStorage(ChartNight.key) var chartNight = ChartNight.dimmed.rawValue

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
        map.register(TrafficMarkView.self, forAnnotationViewWithReuseIdentifier: TrafficMarkView.reuse)
        context.coordinator.extras.attach(to: map)
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
        let flight = FlightMapLayer()
        flight.attach(map)
        context.coordinator.flight = flight
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.onAirport = onAirport
        context.coordinator.dim((ChartNight(rawValue: chartNight) ?? .dimmed).shade(dark: colorScheme == .dark))
        context.coordinator.onRegion = onRegion
        context.coordinator.show(traffic, ownFt: ownFt, on: map)
        context.coordinator.flight?.update(map, flight)
        context.coordinator.extras.update(map, extras, tiles: context.coordinator.overlay)
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
        if context.coordinator.proceduresShown.count != procedurePaths.count || zip(context.coordinator.proceduresShown, procedurePaths).contains(where: { $0.count != $1.count }) {
            context.coordinator.proceduresShown = procedurePaths
            map.removeOverlays(context.coordinator.procedureLines)
            context.coordinator.procedureLines = procedurePaths.filter { $0.count >= 2 }.map { ProcedurePolyline(coordinates: $0, count: $0.count) }
            map.addOverlays(context.coordinator.procedureLines, level: .aboveLabels)
        }
        if let simulated {
            let plane = context.coordinator.plane ?? {
                let mark = PlaneAnnotation(); context.coordinator.plane = mark; map.addAnnotation(mark); return mark
            }()
            plane.coordinate = simulated.coordinate
            plane.heading = simulated.trackDeg ?? 0
            (map.view(for: plane) as? PlaneMarkView)?.turn(to: plane.heading)
            // Kept in sight as it moves: brought back to the middle of the
            // map clear of the sheet where it would leave it, as the web
            // app's replay keeps its airplane (useReplayMarker).
            if context.coordinator.simulatedAt != simulated.at {
                context.coordinator.simulatedAt = simulated.at
                Self.keepInSight(simulated.coordinate, on: map)
            }
        } else if let plane = context.coordinator.plane {
            map.removeAnnotation(plane)
            context.coordinator.plane = nil
            context.coordinator.simulatedAt = nil
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
        // On the iPad the sidebar and the inspector are beside the map
        // (their safe areas), the figures along its foot; on the iPhone
        // the sheet covers the lower half.
        if RootLayout.of(map.traitCollection.horizontalSizeClass == .regular ? .regular : .compact, pad: map.traitCollection.userInterfaceIdiom == .pad) == .split {
            let safe = map.safeAreaInsets
            return UIEdgeInsets(top: safe.top + 80, left: safe.left + 40, bottom: safe.bottom + 120, right: safe.right + 40)
        }
        return UIEdgeInsets(top: 80, left: 40, bottom: map.bounds.height * 0.5 + 40, right: 40)
    }

    /// A moving airplane's point brought back into the part of the map in
    /// sight, the route's padding in from its edges, once it leaves it.
    static func keepInSight(_ at: CLLocationCoordinate2D, on map: MKMapView) {
        guard map.bounds.width > 0 else { return }
        let clear = map.bounds.inset(by: routePadding(in: map))
        let point = map.convert(at, toPointTo: map)
        guard clear.width > 0, clear.height > 0, !clear.contains(point) else { return }
        let middle = CGPoint(x: map.bounds.midX + point.x - clear.midX, y: map.bounds.midY + point.y - clear.midY)
        map.setCenter(map.convert(middle, toCoordinateFrom: map), animated: true)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var overlay: ChartTileOverlay?
        var courseLine: MKPolyline?
        var courseShown: Course?
        var checkpointsShown: [Checkpoint] = []
        var proceduresShown: [[CLLocationCoordinate2D]] = []
        var plane: PlaneAnnotation?
        var simulatedAt: Date?
        var procedureLines: [ProcedurePolyline] = []
        var checkpointMarks: [CheckpointAnnotation] = []
        var onAirport: ((String) -> Void)?
        var onRegion: ((CLLocationCoordinate2D, Double) -> Void)?
        private var trafficShown: [String: TrafficAnnotation] = [:]
        var setFollowing: ((Bool) -> Void)?
        var setRouteAway: ((Bool) -> Void)?
        var fitted = 0
        var flight: FlightMapLayer?
        let locations = CLLocationManager()
        private var followed = false
        private var fetching: Task<Void, Never>?
        private var shown: [String: AirportAnnotation] = [:]
        let extras = MapExtrasState()
        /// The chart's renderer and the course's, kept to restyle when
        /// the appearance or the setting changes; MapKit asks for a
        /// renderer once per overlay.
        private var tiles: NightTileRenderer?
        private var courseRenderer: MKPolylineRenderer?
        private var shade: CGFloat = 0

        func dim(_ shade: CGFloat) {
            guard shade != self.shade else { return }
            self.shade = shade
            tiles?.shade = shade
            courseRenderer?.strokeColor = NightPalette.course(night: shade > 0)
            courseRenderer?.setNeedsDisplay()
        }

        func mapView(_ mapView: MKMapView, annotationView view: MKAnnotationView, calloutAccessoryControlTapped control: UIControl) {
            MainActor.assumeIsolated { extras.calloutTapped(view) }
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
            if let renderer = flight?.renderer(for: overlay) { return renderer }
            if let chart = overlay as? ChartTileOverlay {
                let renderer = NightTileRenderer(tileOverlay: chart)
                renderer.shade = shade
                tiles = renderer
                return renderer
            }
            if let tiles = overlay as? MKTileOverlay { return MKTileOverlayRenderer(tileOverlay: tiles) }
            if let plate = overlay as? PlateMapOverlay { return PlateRenderer(overlay: plate) }
            if let procedure = overlay as? ProcedurePolyline {
                // A procedure's path in the chart's procedure violet, as
                // the web app draws a picked one.
                let renderer = MKPolylineRenderer(polyline: procedure)
                renderer.strokeColor = UIColor(red: 0.36, green: 0.36, blue: 0.84, alpha: 1)
                renderer.lineWidth = 3
                renderer.lineJoin = .round
                return renderer
            }
            if let line = overlay as? MKPolyline {
                // The web app's magenta course line, the night's lighter
                // one over a dimmed chart.
                let renderer = MKPolylineRenderer(polyline: line)
                renderer.strokeColor = NightPalette.course(night: shade > 0)
                courseRenderer = renderer
                renderer.lineWidth = 3
                renderer.lineJoin = .round
                renderer.lineCap = .round
                return renderer
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
            if let plane = annotation as? PlaneAnnotation {
                let view = (mapView.dequeueReusableAnnotationView(withIdentifier: PlaneMarkView.reuse) as? PlaneMarkView) ?? PlaneMarkView(annotation: plane, reuseIdentifier: PlaneMarkView.reuse)
                view.annotation = plane
                view.turn(to: plane.heading)
                return view
            }
            if let view = flight?.view(for: annotation, on: mapView) { return view }
            if let mark = annotation as? TrafficAnnotation {
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: TrafficMarkView.reuse, for: mark) as! TrafficMarkView
                view.show(mark)
                return view
            }
            if let extra = MainActor.assumeIsolated({ extras.view(for: annotation, on: mapView) }) { return extra }
            if annotation is CheckpointAnnotation {
                return mapView.dequeueReusableAnnotationView(withIdentifier: CheckpointMarkView.reuse, for: annotation)
            }
            guard annotation is AirportAnnotation else { return nil }
            return mapView.dequeueReusableAnnotationView(withIdentifier: AirportMarkView.reuse, for: annotation)
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            if flight?.selected(view, on: mapView) == true { return }
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

        func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
            flight?.regionWillChange(mapView)
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
            MainActor.assumeIsolated { extras.regionChanged(mapView) }
            fetching?.cancel()
            let region = mapView.region
            let corner = CLLocation(latitude: region.center.latitude + region.span.latitudeDelta / 2, longitude: region.center.longitude + region.span.longitudeDelta / 2)
            onRegion?(region.center, corner.distance(from: CLLocation(latitude: region.center.latitude, longitude: region.center.longitude)) / 1852)
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

        /// The airplanes moved to their new reports, the ones no longer
        /// heard taken off, the new ones added.
        @MainActor
        func show(_ planes: [TrafficAircraft], ownFt: Double?, on map: MKMapView) {
            let fresh = Dictionary(planes.map { ($0.hex, $0) }, uniquingKeysWith: { a, _ in a })
            let gone = trafficShown.filter { fresh[$0.key] == nil }
            map.removeAnnotations(Array(gone.values))
            for hex in gone.keys { trafficShown[hex] = nil }
            for (hex, plane) in fresh {
                if let mark = trafficShown[hex] {
                    guard mark.plane != plane || mark.ownFt != ownFt else { continue }
                    mark.plane = plane
                    mark.ownFt = ownFt
                    mark.coordinate = CLLocationCoordinate2D(latitude: plane.lat, longitude: plane.lon)
                    (map.view(for: mark) as? TrafficMarkView)?.show(mark)
                } else {
                    let mark = TrafficAnnotation(plane, ownFt: ownFt)
                    trafficShown[hex] = mark
                    map.addAnnotation(mark)
                }
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
