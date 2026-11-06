import MapKit
import UIKit

/// A field on the chart: its mark, in the colour of its flight category
/// where it reports one (the web app's flightCategory colours), with its
/// ident under it.
final class AirportAnnotation: NSObject, MKAnnotation {
    let ident: String
    let kind: String
    let category: String?
    /// The class of airspace at the field's surface (B, C, D, E, G), for
    /// how soon its mark must show.
    let airspaceClass: String?
    /// The class of airspace (B, C, D) the field is the primary airport of
    /// (AirportPin.primaryOf), or nil: the one mark the rings are named
    /// for, kept before any other where they would collide.
    let primaryOf: String?
    let coordinate: CLLocationCoordinate2D
    /// A field of the route (its ends and stops): always drawn, never
    /// folded into a cluster.
    var onRoute = false

    init(_ pin: AirportPin, onRoute: Bool = false) {
        ident = pin.ident
        kind = pin.kind
        category = pin.flightCategory
        airspaceClass = pin.airspaceClass
        primaryOf = pin.primaryOf
        coordinate = CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lon)
        self.onRoute = onRoute
    }

    var title: String? { ident }

    /// Which marks MapKit keeps when they would overlap, as the web app's
    /// AirportsLayer ranks the fields far out (PRIMARY_RANK, shownFrom
    /// and KIND_RANK: the field each class of airspace is named for
    /// before every other, so Dallas's rings show DFW and not Love, then
    /// a Class B field from the country's zoom, a Class C from a few
    /// states', the airline airports before the regional ones, the small
    /// fields at the sectional's own scale): the route's fields always,
    /// then the primaries of Class B and C, then the large and the Class B
    /// and C, then the primary of a Class D, then medium and Class D,
    /// then the rest. Hundreds of views at a low zoom drew over each
    /// other with nothing dropping any (the owner, 2026-11-03).
    var priority: MKFeatureDisplayPriority {
        if onRoute { return .required }
        switch primaryOf {
        case "B": return MKFeatureDisplayPriority(rawValue: 900)
        case "C": return MKFeatureDisplayPriority(rawValue: 800)
        default: break
        }
        if kind == "large" || airspaceClass == "B" || airspaceClass == "C" { return .defaultHigh }
        if primaryOf == "D" { return MKFeatureDisplayPriority(rawValue: 700) }
        if kind == "medium" || airspaceClass == "D" { return MKFeatureDisplayPriority(rawValue: 500) }
        return .defaultLow
    }

    /// The web app's flight category colours (lib/map/flightCategory.ts):
    /// VFR green, MVFR blue, IFR red, LIFR magenta; grey with no report.
    var colour: UIColor { Self.colour(category) }

    static func colour(_ category: String?) -> UIColor {
        switch category {
        case "VFR": return UIColor(red: 0.13, green: 0.62, blue: 0.27, alpha: 1)
        case "MVFR": return UIColor(red: 0.16, green: 0.45, blue: 0.85, alpha: 1)
        case "IFR": return UIColor(red: 0.85, green: 0.18, blue: 0.18, alpha: 1)
        case "LIFR": return UIColor(red: 0.75, green: 0.12, blue: 0.65, alpha: 1)
        default: return UIColor.systemGray
        }
    }
}

/// The mark: a ring in the category's colour, the ident in a small label
/// under it. One view class reused for every field.
final class AirportMarkView: MKAnnotationView {
    static let reuse = "airport"
    private let ring = UIView()
    private let label = UILabel()

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 44, height: 30)
        centerOffset = CGPoint(x: 0, y: -4)
        ring.frame = CGRect(x: 16, y: 0, width: 12, height: 12)
        ring.layer.cornerRadius = 6
        ring.layer.borderWidth = 2.5
        ring.backgroundColor = NightPalette.markFill
        label.frame = CGRect(x: 0, y: 13, width: 44, height: 14)
        label.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        label.textAlignment = .center
        label.textColor = .label
        // A halo round the words, white by day and the night's ground in
        // dark appearance, where .label turns light (NightPalette.halo).
        label.haloFollowing(self)
        addSubview(ring)
        addSubview(label)
        canShowCallout = false
        // A tap opens the field's card, so VoiceOver has it as a button
        // named with its weather, which the ring's colour alone would not
        // tell.
        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var annotation: (any MKAnnotation)? {
        didSet { show() }
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        show()
    }

    private func show() {
        guard let field = annotation as? AirportAnnotation else { return }
        ring.layer.borderColor = field.colour.cgColor
        label.text = field.ident
        accessibilityLabel = "\(field.ident), \(SpokenFigures.flightCategory(field.category))"
        // MapKit folds marks that would overlap into one cluster view and
        // drops the lesser of two that collide, by these: the route's
        // fields stand on their own.
        clusteringIdentifier = field.onRoute ? nil : AirportMarkView.cluster
        displayPriority = field.priority
        collisionMode = .rectangle
    }

    /// The identifier the fields cluster under.
    static let cluster = "airport"
}

/// Several fields' marks folded into one where they would overlap: a
/// ring in the app's grey with how many, which MapKit opens as the map
/// zooms in. One view class reused for every cluster.
final class AirportClusterView: MKAnnotationView {
    static let reuse = "airport-cluster"
    private let ring = UIView()
    private let count = UILabel()

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 30, height: 30)
        ring.frame = bounds
        ring.layer.cornerRadius = 15
        ring.layer.borderWidth = 2.5
        ring.layer.borderColor = UIColor.systemGray.cgColor
        ring.backgroundColor = NightPalette.markFill
        count.frame = bounds
        count.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        count.textAlignment = .center
        count.textColor = .label
        addSubview(ring)
        addSubview(count)
        canShowCallout = false
        collisionMode = .circle
        displayPriority = .defaultHigh
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var annotation: (any MKAnnotation)? {
        didSet { show() }
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        show()
    }

    private func show() {
        guard let cluster = annotation as? MKClusterAnnotation else { return }
        count.text = String(cluster.memberAnnotations.count)
        // Read as one thing: "12 airports", opened by a zoom in.
        isAccessibilityElement = true
        accessibilityLabel = "\(cluster.memberAnnotations.count) airports"
    }
}
