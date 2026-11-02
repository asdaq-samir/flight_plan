import Foundation
import WingtipEngine

/// The flight's figures from the engine (native/ffi), the planner's own:
/// the wind triangle, 14 CFR 91.159's cruising altitudes, 91.151's
/// reserve, the atmosphere, WMM-2025 variation and when a weather report
/// stops counting offline (the owner's rule, 2026-11-02).
enum FlightRules {
    struct Triangle: Equatable {
        let wcaDeg: Double
        let headingDeg: Double
        let groundspeedKt: Double
    }

    /// Nil where no heading holds the course.
    static func windTriangle(trueCourseDeg: Double, tasKt: Double, windFromDeg: Double, windKt: Double) -> Triangle? {
        var wca = 0.0, heading = 0.0, gs = 0.0
        guard wt_wind_triangle(trueCourseDeg, tasKt, windFromDeg, windKt, &wca, &heading, &gs) == 1 else { return nil }
        return Triangle(wcaDeg: wca, headingDeg: heading, groundspeedKt: gs)
    }

    static func lowestVfrAltitude(floorFt: Double, magneticCourseDeg: Double) -> Double {
        wt_lowest_vfr_altitude(floorFt, magneticCourseDeg)
    }

    static func reserveMinutes(ifr: Bool, night: Bool) -> Double {
        wt_reserve_min(ifr ? 1 : 0, night ? 1 : 0)
    }

    static func densityAltitudeFt(pressureAltitudeFt: Double, oatC: Double) -> Double {
        wt_density_altitude_ft(pressureAltitudeFt, oatC)
    }

    static func pressureAltitudeFt(elevationFt: Double, altimeterInHg: Double) -> Double {
        wt_pressure_altitude_ft(elevationFt, altimeterInHg)
    }

    /// Degrees, east positive, for a decimal year (2026.5 is mid-2026).
    static func declination(lat: Double, lon: Double, year: Double) -> Double {
        wt_declination(lat, lon, year)
    }

    enum Product: Int32 { case metar = 0, speci, taf, winds, advisory }

    /// Whether a report still counts at `now`, its times as Unix seconds.
    static func inForce(_ product: Product, now: Int64, observed: Int64? = nil, lastRoutine: Int64? = nil,
                        validFrom: Int64? = nil, validTo: Int64? = nil) -> Bool {
        wt_weather_in_force(product.rawValue, now, observed ?? .min, lastRoutine ?? .min, validFrom ?? .min, validTo ?? .min) == 1
    }
}
