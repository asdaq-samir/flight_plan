import MapKit
import UIKit

/// Night: the cockpit palette the owner picked (26 October 2026), the
/// same as the web app's dark theme (web index.css .dark), for the colours
/// the app sets itself -- the map's marks, the course line, the chart's
/// dimming. Everything else is the system's, which follows dark
/// appearance by itself; the tint stays iOS's blue.
enum NightPalette {
    /// The night's ground and surface (web --background, --card).
    static let ground = UIColor(hex: 0x0B1422)
    static let surface = UIColor(hex: 0x17283A)
    /// The course over a dimmed chart: a lighter magenta than the
    /// printed one, which goes dull on the dimmed paper.
    static let route = UIColor(hex: 0xF277E6)
    /// What is live or in hand: other traffic, as the web app's cyan.
    static let active = UIColor(hex: 0x78D9FF)
    /// Caution, as web --caution in dark.
    static let caution = UIColor(hex: 0xF5B85E)
    /// A check passed, as web --go in dark.
    static let positive = UIColor(hex: 0x75D7A3)

    /// The course line's magenta by day, as the web app's COURSE_MAGENTA
    /// (lib/map/chartColors).
    static let courseByDay = UIColor(hex: 0xE600E6)

    /// The course line's colour: the printed magenta, or the night's over
    /// a dimmed chart (as web index.css's course-core).
    static func course(night: Bool) -> UIColor { night ? route : courseByDay }

    /// The casing under a line on the chart: white by day, the night's
    /// ground over a dimmed chart, where white would be the brightest line
    /// on the screen.
    static func casing(night: Bool) -> UIColor {
        night ? ground.withAlphaComponent(0.85) : UIColor.white.withAlphaComponent(0.85)
    }

    /// The halo behind a mark's words on the chart. By day white round the
    /// label's dark words; in dark appearance the words are light (.label)
    /// and a white halo made them unreadable, so the halo is the night's
    /// ground.
    static let halo = UIColor(light: UIColor.white.withAlphaComponent(0.9), dark: ground.withAlphaComponent(0.9))

    /// The fill of a field's ring and own ship's disc on the chart.
    static let markFill = UIColor(light: UIColor.white.withAlphaComponent(0.85), dark: surface.withAlphaComponent(0.9))

    /// Traffic: near (within the alert's band) and the rest, the web app's
    /// amber and cyan by day, the palette's at night.
    static let trafficNear = UIColor(light: UIColor(red: 0.96, green: 0.62, blue: 0.04, alpha: 1), dark: caution)
    static let trafficFar = UIColor(light: UIColor(red: 0.02, green: 0.71, blue: 0.83, alpha: 1), dark: active)

    /// WCAG 2's contrast ratio between two opaque colours, 1 to 21, as the
    /// web app's lib/contrast measures its tokens (WCAG 1.4.3 asks 4.5:1
    /// of words).
    static func contrast(_ a: UIColor, _ b: UIColor) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// WCAG 2's relative luminance of a colour in sRGB.
    static func luminance(_ colour: UIColor) -> Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        colour.getRed(&r, green: &g, blue: &b, alpha: &a)
        func linear(_ c: CGFloat) -> Double {
            let c = Double(c)
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }
}

/// The chart in dark appearance, from Setup: as printed, or dimmed so the
/// white paper chart does not take the pilot's night vision. Dimmed unless
/// asked otherwise, as the web app's Settings has it (Chart at night).
enum ChartNight: String, CaseIterable, Identifiable {
    case normal, dimmed

    /// The key Setup and the map share, as the web app's preference.
    static let key = "chartAtNight"

    var id: String { rawValue }
    var label: String { self == .normal ? "Normal" : "Dimmed" }

    /// How much of the night's ground is laid over each tile: none by day
    /// or as printed; at night the paper down to about a fifth of its
    /// light, as the web app's brightness(0.5) filter takes it, its black
    /// type still 5:1 on it.
    func shade(dark: Bool) -> CGFloat { dark && self == .dimmed ? 0.5 : 0 }
}

extension UILabel {
    /// A soft halo round a mark's words on the chart, so they read over
    /// any of its colours: NightPalette.halo for the appearance, resolved
    /// here because a layer's colour does not follow it by itself.
    func halo(for traits: UITraitCollection) {
        layer.shadowColor = NightPalette.halo.resolvedColor(with: traits).cgColor
        layer.shadowOffset = .zero
        layer.shadowRadius = 1.5
        layer.shadowOpacity = 1
    }
}

extension UIColor {
    /// A colour from its 0xRRGGBB, opaque.
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }

    /// One colour by day and another in dark appearance, resolved by the
    /// view it is drawn in.
    convenience init(light: UIColor, dark: UIColor) {
        self.init { $0.userInterfaceStyle == .dark ? dark : light }
    }
}

/// The chart's tiles, with the night's ground laid over each at the
/// setting's shade: a dimming drawn by the renderer, so the marks, the
/// course and the sheets over the chart are untouched. Where a tile is
/// not in yet, the ground alone.
final class NightTileRenderer: MKTileOverlayRenderer {
    var shade: CGFloat = 0 {
        didSet { if shade != oldValue { setNeedsDisplay() } }
    }

    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext) {
        super.draw(mapRect, zoomScale: zoomScale, in: context)
        guard shade > 0 else { return }
        context.setFillColor(NightPalette.ground.withAlphaComponent(shade).cgColor)
        context.fill(rect(for: mapRect))
    }
}
