import MapKit
import UIKit

/// One airplane heard about the map, kept by its ICAO address so a new
/// report moves the mark rather than drawing another.
final class TrafficAnnotation: NSObject, MKAnnotation {
    let hex: String
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var plane: TrafficAircraft
    var ownFt: Double?

    init(_ plane: TrafficAircraft, ownFt: Double?) {
        hex = plane.hex
        self.plane = plane
        self.ownFt = ownFt
        coordinate = CLLocationCoordinate2D(latitude: plane.lat, longitude: plane.lon)
    }

    var title: String? { plane.callsign ?? plane.registration ?? plane.hex }
}

/// A chevron on the airplane's track, amber within 1,000 ft of own ship's
/// height and cyan otherwise (the web app's TRAFFIC_COLOURS), with its
/// height under it as TCAS writes it and its callsign beside.
final class TrafficMarkView: MKAnnotationView {
    static let reuse = "traffic"
    private let chevron = UIImageView(image: UIImage(systemName: "location.north.fill"))
    private let label = UILabel()

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 64, height: 34)
        chevron.frame = CGRect(x: 23, y: 0, width: 18, height: 18)
        chevron.contentMode = .scaleAspectFit
        label.frame = CGRect(x: 0, y: 18, width: 64, height: 14)
        label.font = UIFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
        label.textAlignment = .center
        label.textColor = .label
        label.halo(for: traitCollection)
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: TrafficMarkView, _: UITraitCollection) in
            view.label.halo(for: view.traitCollection)
        }
        addSubview(chevron)
        addSubview(label)
        // A tap opens its card (FlightMapLayer), not a callout.
        canShowCallout = false
        displayPriority = .defaultHigh
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    func show(_ mark: TrafficAnnotation) {
        let near = Traffic.near(mark.plane, ownFt: mark.ownFt)
        chevron.tintColor = near ? NightPalette.trafficNear : NightPalette.trafficFar
        chevron.transform = CGAffineTransform(rotationAngle: CGFloat((mark.plane.trackDeg ?? 0) * .pi / 180))
        label.text = Traffic.label(mark.plane, ownFt: mark.ownFt)
        accessibilityLabel = "\(mark.title ?? "Airplane"), \(label.text ?? "")"
    }
}
