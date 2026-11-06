import MapKit
import UIKit

/// One airplane heard about the map, kept by its ICAO address so a new
/// report moves the mark rather than drawing another.
final class TrafficAnnotation: NSObject, MKAnnotation {
    let hex: String
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var plane: TrafficAircraft
    var ownFt: Double?
    /// Its mark as the engine drew it for the whole answer at once
    /// (Traffic.marks, ChartMap's show): the view reads it, where each
    /// view asked the engine for its one airplane and a screen of traffic
    /// was a screen of calls (Session2's profile, 2026-11-03).
    var drawn: Traffic.Mark?

    init(_ plane: TrafficAircraft, ownFt: Double?, drawn: Traffic.Mark? = nil) {
        hex = plane.hex
        self.plane = plane
        self.ownFt = ownFt
        self.drawn = drawn
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
        label.haloFollowing(self)
        addSubview(chevron)
        addSubview(label)
        // A tap opens its card (FlightMapLayer), not a callout.
        canShowCallout = false
        displayPriority = .defaultHigh
        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    func show(_ mark: TrafficAnnotation) {
        let drawn = mark.drawn
        chevron.tintColor = drawn?.near == true ? NightPalette.trafficNear : NightPalette.trafficFar
        chevron.transform = CGAffineTransform(rotationAngle: CGFloat((mark.plane.trackDeg ?? 0) * .pi / 180))
        label.text = drawn?.label ?? ""
        // Its height against own ship in words, and "near" said where the
        // amber alone says it on the screen.
        let height = mark.plane.altitudeFt.map { ", \(SpokenFigures.feet($0))" } ?? ""
        let against = mark.ownFt.flatMap { own in mark.plane.altitudeFt.map { ", " + FlightWords.against($0 - own) } } ?? ""
        accessibilityLabel = "\(mark.title ?? "Airplane")\(height)\(against)\(drawn?.near == true ? ", near" : "")"
    }
}
