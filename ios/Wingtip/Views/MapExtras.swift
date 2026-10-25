import MapKit
import UIKit

/// What the map draws beyond the fields and the route: the chart's VFR
/// waypoints close in, the Class B fields' weather, the approach plates
/// picked, and the pin a held finger drops (the web app's WaypointsLayer,
/// ClassBLayer, PlateLayer and the airspace card's point).
enum MapExtras {
    /// From this zoom in, as the web app's waypoints and airports: further
    /// out the diamonds would be a scatter over every city's airspace.
    static let waypointsFromZoom = 8.0

    /// The web map's zoom level for a span shown across a width of
    /// points: 256-point tiles, the world's 360 degrees at zoom 0.
    static func zoom(longitudeDelta: Double, width: Double) -> Double {
        guard longitudeDelta > 0, width > 0 else { return 0 }
        return log2(360 * width / 256 / longitudeDelta)
    }

    /// A Class B field as the map's airport mark takes it: its ring in
    /// the colour of what it reports now.
    static func pin(_ field: ClassBAirport) -> AirportPin {
        AirportPin(ident: field.ident, name: field.name, lat: field.lat, lon: field.lon, kind: "large",
                   flightCategory: field.flightCategory, airspaceClass: "B", military: nil, isPrivate: false)
    }
}

/// A VFR waypoint (VPBNG): the chart's magenta diamond, its ident and
/// what it is in its callout, and with a route open a + that puts it in
/// the stops to be flown through.
final class WaypointAnnotation: NSObject, MKAnnotation {
    let waypoint: WaypointPin
    let coordinate: CLLocationCoordinate2D

    init(_ waypoint: WaypointPin) {
        self.waypoint = waypoint
        coordinate = CLLocationCoordinate2D(latitude: waypoint.lat, longitude: waypoint.lon)
    }

    var title: String? { waypoint.ident }
    var subtitle: String? {
        ["VFR waypoint", waypoint.description.map { AirportWords.faaWords($0) }].compactMap { $0 }.joined(separator: " · ")
    }
}

final class WaypointMarkView: MKAnnotationView {
    static let reuse = "waypoint"
    /// The sectional's magenta (web lib/useAirspace MAGENTA).
    static let magenta = UIColor(red: 0xc0 / 255.0, green: 0x30 / 255.0, blue: 0x9f / 255.0, alpha: 1)
    private let diamond = UIView()

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        // The mark small, its tap the 44 points round it.
        frame = CGRect(x: 0, y: 0, width: 44, height: 44)
        diamond.frame = CGRect(x: 16, y: 16, width: 12, height: 12)
        diamond.backgroundColor = Self.magenta
        diamond.layer.borderColor = UIColor.white.cgColor
        diamond.layer.borderWidth = 2
        diamond.layer.cornerRadius = 2
        diamond.transform = CGAffineTransform(rotationAngle: .pi / 4)
        addSubview(diamond)
        canShowCallout = true
        displayPriority = .defaultLow
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }
}

/// The pin a held finger drops, where the airspace card is for.
final class HeldAnnotation: MKPointAnnotation {}

/// An approach plate's plan view laid on the chart where the planner
/// places it by the FAA's georeference (vfr.plates), on its white sheet,
/// the procedure's own lines over it: a sketch to fly the dry run
/// against, not the chart to navigate by.
final class PlateMapOverlay: NSObject, MKOverlay {
    let key: String
    let image: UIImage
    let boundingMapRect: MKMapRect
    let coordinate: CLLocationCoordinate2D

    init(key: String, plate: PlateOverlay, image: UIImage) {
        self.key = key
        self.image = image
        let northWest = MKMapPoint(CLLocationCoordinate2D(latitude: plate.north, longitude: plate.west))
        let southEast = MKMapPoint(CLLocationCoordinate2D(latitude: plate.south, longitude: plate.east))
        boundingMapRect = MKMapRect(x: northWest.x, y: northWest.y, width: southEast.x - northWest.x, height: southEast.y - northWest.y)
        coordinate = CLLocationCoordinate2D(latitude: (plate.north + plate.south) / 2, longitude: (plate.west + plate.east) / 2)
    }
}

final class PlateRenderer: MKOverlayRenderer {
    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext) {
        guard let plate = overlay as? PlateMapOverlay else { return }
        let rect = self.rect(for: plate.boundingMapRect)
        UIGraphicsPushContext(context)
        plate.image.draw(in: rect)
        UIGraphicsPopContext()
    }
}

/// What the root view hands the map for these: the pin, the switches
/// from Setup, the approaches picked, and what a hold or a waypoint's +
/// does.
struct MapExtrasInput {
    var held: CLLocationCoordinate2D?
    var waypoints = false
    var classB = false
    var plates = true
    var approaches: [ProcedurePick] = []
    var onHold: ((CLLocationCoordinate2D) -> Void)?
    var onWaypointStop: ((String) -> Void)?

    /// Setup's switches, kept on the device (the web app's preferences:
    /// waypoints and Class B off until a pilot turns them on, plates on).
    enum Keys {
        static let waypoints = "map.waypoints"
        static let classB = "map.classB"
        static let plates = "map.plates"
    }
}

/// The map's coordinator's part for these, kept apart from the rest of
/// it: the held finger, the waypoints asked for as the map rests, the
/// Class B fields, the plates. On the main actor, as the map is; the
/// coordinator's delegate calls come in through MainActor.assumeIsolated.
@MainActor
final class MapExtrasState: NSObject {
    var onHold: ((CLLocationCoordinate2D) -> Void)?
    var onWaypointStop: ((String) -> Void)?
    private var held: HeldAnnotation?
    private var showWaypoints = false
    private var showClassB = false
    private var plateKeys: [String] = []
    private var waypointMarks: [String: WaypointAnnotation] = [:]
    private var classBMarks: [AirportAnnotation] = []
    private var plates: [PlateMapOverlay] = []
    private var waypointTask: Task<Void, Never>?
    private var classBTask: Task<Void, Never>?
    private var plateTask: Task<Void, Never>?

    nonisolated override init() { super.init() }

    /// A finger held on the map asks what is there, as Maps drops a pin.
    func attach(to map: MKMapView) {
        map.register(WaypointMarkView.self, forAnnotationViewWithReuseIdentifier: WaypointMarkView.reuse)
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
        hold.minimumPressDuration = 0.5
        map.addGestureRecognizer(hold)
    }

    @objc private func held(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began, let map = gesture.view as? MKMapView else { return }
        let at = map.convert(gesture.location(in: map), toCoordinateFrom: map)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        onHold?(at)
    }

    func update(_ map: MKMapView, _ input: MapExtrasInput, tiles: (any MKOverlay)?) {
        onHold = input.onHold
        onWaypointStop = input.onWaypointStop
        if let point = input.held {
            if let pin = held {
                if pin.coordinate.latitude != point.latitude || pin.coordinate.longitude != point.longitude { pin.coordinate = point }
            } else {
                let pin = HeldAnnotation()
                pin.coordinate = point
                held = pin
                map.addAnnotation(pin)
            }
        } else if let pin = held {
            map.removeAnnotation(pin)
            held = nil
        }
        if input.waypoints != showWaypoints {
            showWaypoints = input.waypoints
            refreshWaypoints(map, after: 0)
        }
        if input.classB != showClassB {
            showClassB = input.classB
            refreshClassB(map)
        }
        let picks = input.plates ? input.approaches.filter { $0.kind == "approach" } : []
        let keys = picks.map { "\($0.ident):\($0.id)" }
        if keys != plateKeys {
            plateKeys = keys
            refreshPlates(map, picks: picks, tiles: tiles)
        }
    }

    /// The map rested: the waypoints in view asked for again.
    func regionChanged(_ map: MKMapView) {
        if showWaypoints || !waypointMarks.isEmpty { refreshWaypoints(map, after: 300) }
    }

    func view(for annotation: any MKAnnotation, on map: MKMapView) -> MKAnnotationView? {
        if let mark = annotation as? WaypointAnnotation {
            let view = map.dequeueReusableAnnotationView(withIdentifier: WaypointMarkView.reuse, for: mark)
            if onWaypointStop != nil {
                let add = UIButton(type: .contactAdd)
                add.accessibilityLabel = "Add as a Stop"
                view.rightCalloutAccessoryView = add
            } else {
                view.rightCalloutAccessoryView = nil
            }
            return view
        }
        if annotation is HeldAnnotation {
            let view = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: nil)
            view.markerTintColor = .systemRed
            view.displayPriority = .required
            return view
        }
        return nil
    }

    func calloutTapped(_ view: MKAnnotationView) {
        guard let mark = view.annotation as? WaypointAnnotation else { return }
        view.setSelected(false, animated: true)
        onWaypointStop?(mark.waypoint.ident)
    }

    private func refreshWaypoints(_ map: MKMapView, after ms: Int) {
        waypointTask?.cancel()
        let region = map.region
        let zoom = MapExtras.zoom(longitudeDelta: region.span.longitudeDelta, width: Double(map.bounds.width))
        guard showWaypoints, zoom >= MapExtras.waypointsFromZoom else {
            map.removeAnnotations(Array(waypointMarks.values))
            waypointMarks = [:]
            return
        }
        waypointTask = Task { @MainActor [weak self, weak map] in
            if ms > 0 { try? await Task.sleep(for: .milliseconds(ms)) }
            guard !Task.isCancelled else { return }
            let south = region.center.latitude - region.span.latitudeDelta / 2, north = region.center.latitude + region.span.latitudeDelta / 2
            let west = region.center.longitude - region.span.longitudeDelta / 2, east = region.center.longitude + region.span.longitudeDelta / 2
            guard let found = try? await Planner.waypoints(south: south, west: west, north: north, east: east),
                  !Task.isCancelled, let self, let map else { return }
            let fresh = Dictionary(found.map { ($0.ident, $0) }, uniquingKeysWith: { a, _ in a })
            let gone = waypointMarks.filter { fresh[$0.key] == nil }
            map.removeAnnotations(Array(gone.values))
            for ident in gone.keys { waypointMarks[ident] = nil }
            for (ident, pin) in fresh where waypointMarks[ident] == nil {
                let mark = WaypointAnnotation(pin)
                waypointMarks[ident] = mark
                map.addAnnotation(mark)
            }
        }
    }

    private func refreshClassB(_ map: MKMapView) {
        classBTask?.cancel()
        map.removeAnnotations(classBMarks)
        classBMarks = []
        guard showClassB else { return }
        classBTask = Task { @MainActor [weak self, weak map] in
            guard let fields = try? await Planner.classB(), !Task.isCancelled, let self, let map else { return }
            classBMarks = fields.map { AirportAnnotation(MapExtras.pin($0)) }
            map.addAnnotations(classBMarks)
        }
    }

    private func refreshPlates(_ map: MKMapView, picks: [ProcedurePick], tiles: (any MKOverlay)?) {
        plateTask?.cancel()
        map.removeOverlays(plates)
        plates = []
        guard !picks.isEmpty else { return }
        plateTask = Task { @MainActor [weak self, weak map] in
            for pick in picks {
                // A plate without a georeference draws nothing: the coded
                // lines alone.
                guard let plate = try? await Planner.plate(pick.ident, procedure: pick.id),
                      [plate.south, plate.west, plate.north, plate.east].allSatisfy(\.isFinite),
                      let image = try? await PictureCache.image(Planner.platePicturePath(cycle: plate.cycle, ident: pick.ident, procedure: pick.id)),
                      !Task.isCancelled, let self, let map else { continue }
                let overlay = PlateMapOverlay(key: "\(pick.ident):\(pick.id)", plate: plate, image: image)
                plates.append(overlay)
                if let tiles, map.overlays.contains(where: { $0 === tiles }) {
                    map.insertOverlay(overlay, above: tiles)
                } else {
                    map.addOverlay(overlay, level: .aboveLabels)
                }
            }
        }
    }
}
