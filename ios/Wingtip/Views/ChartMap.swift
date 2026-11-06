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
        // Not a button, but VoiceOver finds it on the map and says which
        // way it points.
        isAccessibilityElement = true
        accessibilityTraits = .image
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    func turn(to degrees: Double) {
        arrow.transform = CGAffineTransform(rotationAngle: degrees * .pi / 180)
        accessibilityLabel = "The airplane, heading \(SpokenFigures.degrees(degrees))"
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
    /// Setup's Military fields and Private fields.
    @AppStorage(MapExtrasInput.Keys.military) var militaryFields = false
    @AppStorage(MapExtrasInput.Keys.privateFields) var privateFields = false
    /// The legs a hazard tapped in the Brief is on (HazardLegsViews.swift).
    var hazardLegs: HazardLegs?

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
        map.register(AirportClusterView.self, forAnnotationViewWithReuseIdentifier: AirportClusterView.reuse)
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
        context.coordinator.useFields(military: militaryFields, privateFields: privateFields, on: map)
        context.coordinator.show(traffic, ownFt: ownFt, on: map)
        context.coordinator.flight?.update(map, flight)
        context.coordinator.extras.update(map, extras, tiles: context.coordinator.overlay)
        context.coordinator.setFollowing = { [self] on in following = on }
        context.coordinator.setRouteAway = { [self] away in if routeAway != away { routeAway = away } }
        // Every move of the map here steps to its end with Reduce Motion
        // on (MapMotion), as Maps' own do.
        if following, map.userTrackingMode != .follow {
            map.setUserTrackingMode(.follow, animated: MapMotion.animated)
        } else if !following, map.userTrackingMode != .none {
            map.setUserTrackingMode(.none, animated: false)
        }
        if context.coordinator.fitted != fitRequest, let line = context.coordinator.courseLine {
            context.coordinator.fitted = fitRequest
            map.setVisibleMapRect(line.boundingMapRect, edgePadding: Self.routePadding(in: map), animated: MapMotion.animated)
        }
        if let template, context.coordinator.overlay?.template != template {
            if let current = context.coordinator.overlay { map.removeOverlay(current) }
            let overlay = ChartTileOverlay(template: template, minZoom: minZoom, maxZoom: maxZoom)
            map.addOverlay(overlay, level: .aboveLabels)
            context.coordinator.overlay = overlay
        }
        if context.coordinator.checkpointsShown != checkpoints {
            context.coordinator.checkpointsShown = checkpoints
            context.coordinator.showCheckpoints(checkpoints, on: map)
        }
        if !context.coordinator.proceduresShown.elementsEqual(procedurePaths, by: Self.samePath) {
            // Each path kept as it is while its points are the same; a new
            // or changed one drawn, a gone one taken off: every change to
            // the plan redrew every procedure line before.
            context.coordinator.proceduresShown = procedurePaths
            let wanted = procedurePaths.filter { $0.count >= 2 }
            var kept: [(path: [CLLocationCoordinate2D], line: ProcedurePolyline)] = []
            var unused = context.coordinator.procedureLines
            for path in wanted {
                if let i = unused.firstIndex(where: { Self.samePath($0.path, path) }) {
                    kept.append(unused.remove(at: i))
                } else {
                    let line = ProcedurePolyline(coordinates: path, count: path.count)
                    map.addOverlay(line, level: .aboveLabels)
                    kept.append((path: path, line: line))
                }
            }
            map.removeOverlays(unused.map(\.line))
            context.coordinator.procedureLines = kept
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
        context.coordinator.showHazardLegs(hazardLegs, on: map)
        let routeIdents = Set(([course?.departure, course?.destination].compactMap { $0 } + (course?.stops ?? [])).map(\.ident))
        if context.coordinator.routeIdents != routeIdents {
            context.coordinator.routeIdents = routeIdents
            context.coordinator.refreshFields(on: map)
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
                map.setVisibleMapRect(line.boundingMapRect, edgePadding: Self.routePadding(in: map), animated: MapMotion.animated)
            }
        }
    }

    /// Whether two paths are the same points, to the metre: a procedure's
    /// line is left on the map while its path has not changed.
    static func samePath(_ a: [CLLocationCoordinate2D], _ b: [CLLocationCoordinate2D]) -> Bool {
        a.count == b.count && zip(a, b).allSatisfy { abs($0.latitude - $1.latitude) < 1e-5 && abs($0.longitude - $1.longitude) < 1e-5 }
    }

    static func routePadding(in map: MKMapView) -> UIEdgeInsets {
        // On the iPad and iPhone Duo open the sidebar and the inspector
        // are beside the map (their safe areas), the figures along its
        // foot; on the iPhone the sheet covers the lower half. The sides
        // keep their own insets: iPhone Duo's differ left and right.
        let safe = map.safeAreaInsets
        let trait = map.traitCollection
        if RootLayout.of(UserInterfaceSizeClass(trait.horizontalSizeClass), UserInterfaceSizeClass(trait.verticalSizeClass)) == .split {
            return UIEdgeInsets(top: safe.top + 80, left: safe.left + 40, bottom: safe.bottom + 120, right: safe.right + 40)
        }
        return UIEdgeInsets(top: 80, left: safe.left + 40, bottom: map.bounds.height * 0.5 + 40, right: safe.right + 40)
    }

    /// A moving airplane's point brought back into the part of the map in
    /// sight, the route's padding in from its edges, once it leaves it.
    static func keepInSight(_ at: CLLocationCoordinate2D, on map: MKMapView) {
        guard map.bounds.width > 0 else { return }
        let clear = map.bounds.inset(by: routePadding(in: map))
        let point = map.convert(at, toPointTo: map)
        guard clear.width > 0, clear.height > 0, !clear.contains(point) else { return }
        let middle = CGPoint(x: map.bounds.midX + point.x - clear.midX, y: map.bounds.midY + point.y - clear.midY)
        // A step, not a glide, with Reduce Motion on: the replay's and the
        // dry run's airplane then jumps back into sight.
        map.setCenter(map.convert(middle, toCoordinateFrom: map), animated: MapMotion.animated)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var overlay: ChartTileOverlay?
        var courseLine: MKPolyline?
        var courseShown: Course?
        var hazardLines: [HazardPolyline] = []
        var hazardShown: HazardLegs?
        var checkpointsShown: [Checkpoint] = []
        var proceduresShown: [[CLLocationCoordinate2D]] = []
        var plane: PlaneAnnotation?
        var simulatedAt: Date?
        /// Each procedure's line with the path it was drawn from, kept
        /// while the path is the same (updateUIView).
        var procedureLines: [(path: [CLLocationCoordinate2D], line: ProcedurePolyline)] = []
        /// The checkpoints' marks by the checkpoint's id, with the number
        /// and place each was drawn with.
        private var checkpointMarks: [String: (number: Int, checkpoint: Checkpoint, mark: CheckpointAnnotation)] = [:]
        /// The route's fields (its ends and stops): drawn whatever the
        /// zoom, never folded into a cluster (AirportAnnotation.priority).
        var routeIdents: Set<String> = []
        var onAirport: ((String) -> Void)?

        /// The checkpoints' marks brought to `checkpoints`: a new one
        /// added, a gone one taken off, one whose number, name, place or
        /// score changed drawn again, the rest left as they are -- every
        /// change to the plan took every mark off the map and put it back
        /// before, a flicker of the whole route.
        @MainActor
        func showCheckpoints(_ checkpoints: [Checkpoint], on map: MKMapView) {
            var wanted: [String: (number: Int, checkpoint: Checkpoint)] = [:]
            for (i, checkpoint) in checkpoints.enumerated() { wanted[checkpoint.id] = (number: i + 1, checkpoint: checkpoint) }
            for (id, drawn) in checkpointMarks where wanted[id] == nil || wanted[id]!.number != drawn.number || wanted[id]!.checkpoint != drawn.checkpoint {
                map.removeAnnotation(drawn.mark)
                checkpointMarks[id] = nil
            }
            for (id, want) in wanted where checkpointMarks[id] == nil {
                let mark = CheckpointAnnotation(number: want.number, checkpoint: want.checkpoint)
                map.addAnnotation(mark)
                checkpointMarks[id] = (number: want.number, checkpoint: want.checkpoint, mark: mark)
            }
        }
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
            if let hazard = overlay as? HazardPolyline {
                // The legs a hazard tapped in the Brief is on, wide in
                // amber under the course (HazardLegsViews.swift).
                let renderer = MKPolylineRenderer(polyline: hazard)
                renderer.strokeColor = UIColor.systemOrange.withAlphaComponent(0.6)
                renderer.lineWidth = 10
                renderer.lineCap = .round
                renderer.lineJoin = .round
                return renderer
            }
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
            // Several fields folded into one where their marks would
            // overlap (AirportMarkView.cluster): the count in a ring.
            if annotation is MKClusterAnnotation {
                return mapView.dequeueReusableAnnotationView(withIdentifier: AirportClusterView.reuse, for: annotation)
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
            mapView.setRegion(MKCoordinateRegion(center: at.coordinate, latitudinalMeters: 300_000, longitudinalMeters: 300_000), animated: MapMotion.animated)
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
                // From the phone's own packs where the engine has them,
                // the planner otherwise (PackMapData).
                guard let pins = try? await PackMapData.airports(south: south, west: west, north: north, east: east), !Task.isCancelled else { return }
                await MainActor.run {
                    self.pins = pins
                    self.showFields(on: mapView)
                }
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
            // Every airplane's mark in one call of the engine (traffic_marks
            // takes the whole list), handed to each annotation: each view
            // asked for its one airplane, a screen of traffic a screen of
            // calls at every report (Session2's profile, 2026-11-03).
            let ordered = Array(fresh.values)
            let drawn = Traffic.marks(ordered, ownFt: ownFt)
            for (i, plane) in ordered.enumerated() {
                let its = i < drawn.count ? drawn[i] : nil
                if let mark = trafficShown[plane.hex] {
                    guard mark.plane != plane || mark.ownFt != ownFt || mark.drawn != its else { continue }
                    mark.plane = plane
                    mark.ownFt = ownFt
                    mark.drawn = its
                    mark.coordinate = CLLocationCoordinate2D(latitude: plane.lat, longitude: plane.lon)
                    (map.view(for: mark) as? TrafficMarkView)?.show(mark)
                } else {
                    let mark = TrafficAnnotation(plane, ownFt: ownFt, drawn: its)
                    trafficShown[plane.hex] = mark
                    map.addAnnotation(mark)
                }
            }
        }

        /// The marks changed, not every mark drawn again: the ones gone
        /// out of view removed, the new ones added, the rest left be.
        @MainActor
        /// The fields in the view as the planner gave them, and which of
        /// them Setup draws.
        private var pins: [AirportPin] = []
        private var fieldUse = (military: false, privateFields: false)

        /// Setup's settings put to the marks already drawn, at once.
        @MainActor
        func useFields(military: Bool, privateFields: Bool, on map: MKMapView) {
            guard fieldUse.military != military || fieldUse.privateFields != privateFields else { return }
            fieldUse = (military: military, privateFields: privateFields)
            showFields(on: map)
        }

        @MainActor
        private func showFields(on map: MKMapView) {
            let kept = AirportPin.shown(pins, military: fieldUse.military, privateFields: fieldUse.privateFields)
            show(kept.map { AirportAnnotation($0, onRoute: routeIdents.contains($0.ident)) }, on: map)
        }

        /// The marks drawn again as the route changes, for which stand on
        /// their own and which may cluster (AirportAnnotation.onRoute).
        @MainActor
        func refreshFields(on map: MKMapView) {
            guard !pins.isEmpty else { return }
            showFields(on: map)
        }

        private func show(_ fields: [AirportAnnotation], on map: MKMapView) {
            let fresh = Dictionary(fields.map { ($0.ident, $0) }, uniquingKeysWith: { a, _ in a })
            let gone = shown.filter { fresh[$0.key] == nil }.map(\.value)
            let new = fresh.filter { shown[$0.key] == nil }.map(\.value)
            map.removeAnnotations(gone)
            map.addAnnotations(new)
            for mark in gone { shown[mark.ident] = nil }
            for mark in new { shown[mark.ident] = mark }
            // A mark kept whose standing changed (a field now on the
            // route, or no longer): its view told again, which sets its
            // clustering and priority afresh.
            for (ident, mark) in shown where new.contains(where: { $0.ident == ident }) == false {
                if let want = fresh[ident], want.onRoute != mark.onRoute {
                    mark.onRoute = want.onRoute
                    (map.view(for: mark) as? AirportMarkView)?.annotation = mark
                }
            }
        }
    }
}
