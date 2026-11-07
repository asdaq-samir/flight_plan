import Foundation
import UIKit

/// A figure as VoiceOver should say it to a pilot: the number in words
/// with its unit, as the figure is read over the radio -- "four thousand
/// five hundred feet", "one one eight point one", "zero nine zero
/// degrees" -- where the screen writes "4,500 ft", "118.1" and "090°",
/// which VoiceOver would read letter by letter or as a telephone number.
/// The screen's own text is untouched; these go in accessibility labels.
enum SpokenFigures {
    private static let words: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .spellOut
        return f
    }()

    /// A number in words: 4,500 as "four thousand five hundred", 12.3 as
    /// "twelve point three".
    static func number(_ x: Double, decimals: Int = 0) -> String {
        let rounded = (x * pow(10, Double(decimals))).rounded() / pow(10, Double(decimals))
        return words.string(from: NSNumber(value: rounded)) ?? String(rounded)
    }

    /// A number and its unit, the unit singular for one.
    private static func measure(_ x: Double, decimals: Int, _ one: String, _ many: String) -> String {
        let rounded = (x * pow(10, Double(decimals))).rounded() / pow(10, Double(decimals))
        return "\(number(rounded, decimals: decimals)) \(rounded == 1 ? one : many)"
    }

    static func feet(_ ft: Double) -> String { measure(ft, decimals: 0, "foot", "feet") }
    static func knots(_ kt: Double) -> String { measure(kt, decimals: 0, "knot", "knots") }
    static func nauticalMiles(_ nm: Double) -> String { measure(nm, decimals: 1, "nautical mile", "nautical miles") }
    static func statuteMiles(_ sm: Double) -> String { measure(sm, decimals: 1, "statute mile", "statute miles") }
    static func gallons(_ gal: Double) -> String { measure(gal, decimals: 1, "gallon", "gallons") }
    static func feetPerMinute(_ fpm: Double) -> String { "\(number(fpm)) feet per minute" }

    /// Minutes as "one hour two minutes", "forty minutes".
    static func minutes(_ minutes: Double) -> String {
        let whole = Int(minutes.rounded())
        let h = whole / 60, m = whole % 60
        var parts: [String] = []
        if h > 0 { parts.append("\(number(Double(h))) \(h == 1 ? "hour" : "hours")") }
        if m > 0 || h == 0 { parts.append("\(number(Double(m))) \(m == 1 ? "minute" : "minutes")") }
        return parts.joined(separator: " ")
    }

    private static let digitWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]

    /// Each figure said on its own, as a radio frequency, a heading or a
    /// transponder code is: "118.1" as "one one eight point one".
    static func digits(_ text: String) -> String {
        text.compactMap { c -> String? in
            if let d = c.wholeNumberValue, (0...9).contains(d) { return digitWords[d] }
            if c == "." { return "point" }
            return nil
        }.joined(separator: " ")
    }

    /// A heading or course of three figures: "090" as "zero nine zero degrees".
    static func degrees(_ deg: Double) -> String {
        "\(digits(String(format: "%03.0f", deg))) degrees"
    }

    /// A radio frequency, as AirportWords.mhz writes it, figure by figure.
    static func frequency(_ mhz: Double) -> String { digits(AirportWords.mhz(mhz)) }

    /// The compass point in full, the engine's word (AirportWords.compassWord).
    static func compass(_ deg: Double) -> String { AirportWords.compassWord(deg) }

    /// A flight category's code as pilots say it: "VFR" is read as its
    /// letters by VoiceOver already; "LIFR" and "MVFR" are not.
    static func flightCategory(_ code: String?) -> String {
        switch code {
        case "VFR": "VFR"
        case "MVFR": "marginal VFR"
        case "IFR": "IFR"
        case "LIFR": "low IFR"
        default: "no weather report"
        }
    }
}

/// Whether the map's moves are animated: not with Reduce Motion on, when
/// a pan or a zoom steps to its end instead (the UIKit side of SwiftUI's
/// accessibilityReduceMotion, read where MapKit is driven).
enum MapMotion {
    static var animated: Bool { !UIAccessibility.isReduceMotionEnabled }
}
