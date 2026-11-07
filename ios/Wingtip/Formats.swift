import Foundation

/// The app's figures written by Foundation's formatters, in one place,
/// where each screen wrote its own `String(format:)`: a distance to a
/// tenth, whole knots, feet grouped, hours and minutes, a date. No
/// figure is worked out here, only written; the rounding is the one the
/// screens had (schoolbook for a whole number, Foundation's to the
/// nearest for a decimal), so what a pilot reads is what they read
/// before.
///
/// The locale is fixed to en_US on purpose: the figures are written as
/// the web app writes them and as the FAA prints them ("10,162 ft",
/// "12.3 nm"), whatever the phone's region, as `AirportWords.grouped`
/// always did. Set `locale` to `.current` and every figure follows the
/// phone's region instead (a German phone would read "10.162 ft" and
/// "12,3 nm"); the choice is one line.
enum Formats {
    /// The locale every figure is written in.
    static let locale = Locale(identifier: "en_US")

    // MARK: Numbers

    /// A whole number grouped as pilots read it: "10,162"; rounded
    /// schoolbook-style first (2.5 is 3), and never "-0".
    static func grouped(_ n: Double) -> String {
        let whole = n.rounded()
        return (whole == 0 ? 0 : whole).formatted(.number.precision(.fractionLength(0)).locale(locale))
    }

    /// A figure to so many places, as "%.1f" wrote it: "12.3", "0.0".
    static func number(_ x: Double, decimals: Int) -> String {
        x.formatted(.number.precision(.fractionLength(decimals)).grouping(.never).locale(locale))
    }

    /// A figure to a tenth, without a ".0" it does not have: "3", "1.5".
    static func tenths(_ x: Double) -> String {
        x == x.rounded() && abs(x) < 1e9 ? String(Int(x)) : number(x, decimals: 1)
    }

    // MARK: Measurements

    /// Feet, grouped, whole: "1,500 ft" (Foundation's own symbol for the
    /// foot is the pilot's).
    static func feet(_ ft: Double) -> String {
        Measurement(value: ft.rounded(), unit: UnitLength.feet)
            .formatted(.measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(0))).locale(locale))
    }

    /// The same with nothing known written as a dash.
    static func feet(_ ft: Double?) -> String { ft.map(feet) ?? "—" }

    /// Nautical miles with the unit pilots write, "12.3 nm": Foundation's
    /// own symbol is "nmi", which no nav log uses, so the number is
    /// Foundation's and the word the app's.
    static func nm(_ x: Double, decimals: Int = 1) -> String { "\(number(x, decimals: decimals)) nm" }

    /// Knots, whole, "112 kt": Foundation writes the knot "kn", so as the
    /// nautical mile.
    static func kt(_ x: Double) -> String { "\(number(x, decimals: 0)) kt" }

    /// Fuel to a tenth, "8.4 gal", Foundation's gallon.
    static func gal(_ x: Double, decimals: Int = 1) -> String {
        Measurement(value: x, unit: UnitVolume.gallons)
            .formatted(.measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(decimals)).grouping(.never)).locale(locale))
    }

    /// Hours to a tenth as a logbook keeps them, "1.5 h".
    static func hours(_ h: Double, decimals: Int = 1) -> String { "\(number(h, decimals: decimals)) h" }

    /// Whole minutes, "12 min".
    static func minutes(_ min: Double) -> String { "\(number(min.rounded(), decimals: 0)) min" }

    /// A course or heading as the nav log prints it, three figures, "093°".
    static func degrees(_ x: Double) -> String {
        "\(number(x, decimals: 0).leftPadded(to: 3))°"
    }

    // MARK: Dates

    /// A clock time in the phone's own style, "2:07 PM".
    static func time(_ date: Date) -> String { date.formatted(date: .omitted, time: .shortened) }

    /// A day in the phone's own style, "Nov 3, 2026".
    static func day(_ date: Date) -> String { date.formatted(date: .abbreviated, time: .omitted) }
}

extension String {
    /// Padded with zeros on the left to a width, "7" to "007".
    func leftPadded(to width: Int) -> String {
        count >= width ? self : String(repeating: "0", count: width - count) + self
    }
}
