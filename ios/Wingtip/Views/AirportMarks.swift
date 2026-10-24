import MapKit
import UIKit

/// A field on the chart: its mark, in the colour of its flight category
/// where it reports one (the web app's flightCategory colours), with its
/// ident under it.
final class AirportAnnotation: NSObject, MKAnnotation {
    let ident: String
    let kind: String
    let category: String?
    let coordinate: CLLocationCoordinate2D

    init(_ pin: AirportPin) {
        ident = pin.ident
        kind = pin.kind
        category = pin.flightCategory
        coordinate = CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lon)
    }

    var title: String? { ident }

    /// The web app's flight category colours (lib/map/flightCategory.ts):
    /// VFR green, MVFR blue, IFR red, LIFR magenta; grey with no report.
    var colour: UIColor {
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
        ring.backgroundColor = UIColor.white.withAlphaComponent(0.85)
        label.frame = CGRect(x: 0, y: 13, width: 44, height: 14)
        label.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        label.textAlignment = .center
        label.textColor = .label
        label.shadowColor = UIColor.white.withAlphaComponent(0.9)
        label.shadowOffset = CGSize(width: 0, height: 0)
        addSubview(ring)
        addSubview(label)
        canShowCallout = false
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
    }
}
