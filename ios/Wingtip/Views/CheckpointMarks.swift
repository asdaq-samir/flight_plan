import MapKit
import UIKit

/// A checkpoint on the chart as the web app draws it (lib/map/icons.ts
/// dotIcon): a numbered dot in the colour of the chart model's score for
/// it, in a white casing with a dark hairline outside, so it holds over
/// any chart colour, and its name beside it.
final class CheckpointAnnotation: NSObject, MKAnnotation {
    let number: Int
    let name: String
    let score: Double
    let coordinate: CLLocationCoordinate2D

    init(number: Int, checkpoint: Checkpoint) {
        self.number = number
        name = checkpoint.name ?? checkpoint.waypoint ?? checkpoint.category
        score = checkpoint.predictedScore
        coordinate = CLLocationCoordinate2D(latitude: checkpoint.lat, longitude: checkpoint.lon)
    }

    var title: String? { name }

    /// The rating scale's steps (lib/scoreScale SCORE_STEPS, format.ts
    /// scoreColor): the deeper the brown, the better the checkpoint.
    static func colour(for score: Double) -> UIColor {
        UIColor(hex: score >= 4.5 ? 0x4E3406 : score >= 4.0 ? 0x724D09 : score >= 3.5 ? 0x96660E : score >= 3.0 ? 0xB98014 : 0xD99A1E)
    }

    /// White on the three deeper steps, ink on the two palest, as the web
    /// app's inkOn picks it.
    static func ink(for score: Double) -> UIColor { score >= 3.5 ? .white : UIColor(white: 0.1, alpha: 1) }
}

final class CheckpointMarkView: MKAnnotationView {
    static let reuse = "checkpoint"
    private let dot = UILabel()
    private let name = UILabel()

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 24, height: 24)
        dot.frame = bounds
        dot.layer.cornerRadius = 12
        dot.layer.borderWidth = 2.5
        dot.layer.borderColor = UIColor.white.cgColor
        dot.layer.masksToBounds = true
        dot.font = UIFont.systemFont(ofSize: 11, weight: .bold)
        dot.textAlignment = .center
        addSubview(dot)
        // The dark hairline outside the white casing and the shadow under
        // it, on the view itself so the dot's own layer stays clipped.
        layer.cornerRadius = 12
        layer.borderWidth = 1
        layer.borderColor = UIColor(red: 10 / 255, green: 20 / 255, blue: 28 / 255, alpha: 0.55).cgColor
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.45
        layer.shadowRadius = 2
        layer.shadowOffset = CGSize(width: 0, height: 1)
        name.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        name.textColor = .white
        name.backgroundColor = UIColor(white: 0.1, alpha: 0.85)
        name.layer.cornerRadius = 4
        name.layer.masksToBounds = true
        addSubview(name)
        canShowCallout = false
        displayPriority = .required
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var annotation: (any MKAnnotation)? {
        didSet { show() }
    }

    private func show() {
        guard let point = annotation as? CheckpointAnnotation else { return }
        dot.text = String(point.number)
        dot.backgroundColor = CheckpointAnnotation.colour(for: point.score)
        dot.textColor = CheckpointAnnotation.ink(for: point.score)
        name.text = " \(point.name.uppercased()) "
        name.sizeToFit()
        // Beside the dot on its right, a gap away, as the web app's label.
        name.frame = CGRect(x: 24 + 8, y: (24 - 18) / 2, width: name.bounds.width, height: 18)
    }
}
