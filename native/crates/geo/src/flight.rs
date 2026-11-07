//! The flight's own figures, one copy for the planner and the phones:
//! the wind triangle, VFR cruising altitudes, the fuel reserve and the
//! atmosphere. Each is the planner's (wingtip.navlog, wingtip.altitude,
//! wingtip.performance) written again here, and tests/test_flight_rules.py
//! holds the two to the same answer; the web's TypeScript copy of the
//! wind triangle (lib/diversion) is held to the same fixture
//! (web/src/lib/fixtures/flightRules.json).

/// The wind correction angle, degrees, positive to the right: the E6B's
/// triangle (FAA-H-8083-25C, Pilot's Handbook of Aeronautical Knowledge,
/// ch. 16, "Wind triangle"). The wind is the direction it blows FROM.
/// A crosswind past the airplane's speed holds no heading; its sine is
/// held at one, as wingtip.navlog's is, and the groundspeed says the rest.
pub fn wind_correction_deg(true_course_deg: f64, wind_from_deg: f64, wind_kt: f64, tas_kt: f64) -> f64 {
    let relative = (wind_from_deg - true_course_deg).to_radians();
    let ratio = (wind_kt / tas_kt * relative.sin()).clamp(-1.0, 1.0);
    ratio.asin().to_degrees()
}

/// The groundspeed once the heading holds the course: the airspeed's
/// share along it less the wind's (the same triangle).
pub fn groundspeed_kt(true_course_deg: f64, wind_from_deg: f64, wind_kt: f64, tas_kt: f64, wca_deg: f64) -> f64 {
    let relative = (wind_from_deg - true_course_deg).to_radians();
    tas_kt * wca_deg.to_radians().cos() - wind_kt * relative.cos()
}

/// The whole triangle, as the web's diversion draws it: the correction,
/// the true heading 0-360 and the groundspeed; None where no heading
/// holds the course (a crosswind past the airspeed) or the wind stops it.
pub fn wind_triangle(true_course_deg: f64, tas_kt: f64, wind_from_deg: f64, wind_kt: f64) -> Option<(f64, f64, f64)> {
    let relative = (wind_from_deg - true_course_deg).to_radians();
    let ratio = wind_kt * relative.sin() / tas_kt;
    if ratio.abs() > 1.0 || !ratio.is_finite() {
        return None;
    }
    // A calm wind's correction is none, not -0.
    let wca = ratio.asin().to_degrees() + 0.0;
    let gs = tas_kt * wca.to_radians().cos() - wind_kt * relative.cos();
    (gs > 0.0).then(|| (wca, (true_course_deg + wca).rem_euclid(360.0), gs))
}

/// Which half of 14 CFR 91.159's rule a magnetic course is in: 000-179
/// flies odd thousands plus 500, 180-359 even thousands plus 500.
pub fn is_eastbound(magnetic_course_deg: f64) -> bool {
    let c = magnetic_course_deg.rem_euclid(360.0);
    // Python's % on a float: rem_euclid's 360.0 for a hair under zero.
    (0.0..180.0).contains(&c)
}

/// The lowest VFR cruising altitude (14 CFR 91.159(a)) at or above a
/// floor, for a magnetic course: the first odd (eastbound) or even
/// (westbound) thousand plus 500 not under it.
pub fn lowest_vfr_cruising_altitude(floor_ft: f64, magnetic_course_deg: f64) -> f64 {
    let east = is_eastbound(magnetic_course_deg);
    let mut thousands = (floor_ft / 1000.0).floor() as i64;
    let odd = thousands.rem_euclid(2) == 1;
    if east && !odd || !east && odd {
        thousands += 1;
    }
    let mut candidate = (thousands * 1000 + 500) as f64;
    while candidate < floor_ft {
        candidate += 2000.0;
    }
    candidate
}

/// 14 CFR 91.151(a): fuel to the first point of landing and then 30
/// minutes at normal cruise by day, 45 at night.
pub const DAY_RESERVE_MIN: f64 = 30.0;
pub const NIGHT_RESERVE_MIN: f64 = 45.0;
/// 14 CFR 91.167(a)(3): under IFR, 45 minutes after the alternate (or
/// the destination), day or night.
pub const IFR_RESERVE_MIN: f64 = 45.0;

/// Fuel for engine start, taxi and takeoff, gallons, where an airplane's
/// profile has no figure of its own: the Cessna 172S handbook's allowance,
/// as the planner's nav log takes it (wingtip.navlog DEFAULT_TAXI_FUEL_GAL).
pub const DEFAULT_TAXI_FUEL_GAL: f64 = 1.4;

/// The reserve in minutes for the rules flown and the time of day.
pub fn reserve_min(ifr: bool, night: bool) -> f64 {
    if ifr {
        IFR_RESERVE_MIN
    } else if night {
        NIGHT_RESERVE_MIN
    } else {
        DAY_RESERVE_MIN
    }
}

// The International Standard Atmosphere below the tropopause (ICAO Doc
// 7488): sea level 15 C (288.15 K), a lapse of 6.5 K a kilometre
// (0.0019812 C a foot), and the exponent pressure falls off by, g/(R L);
// density's is one less. wingtip.performance's constants, the same digits.
pub const ISA_SEA_LEVEL_C: f64 = 15.0;
pub const ISA_LAPSE_C_PER_FT: f64 = 0.0019812;
const SEA_LEVEL_K: f64 = 288.15;
const LAPSE_OVER_T0_PER_FT: f64 = 6.8755856e-6;
const PRESSURE_EXPONENT: f64 = 5.2558797;
const LOWEST_FT: f64 = -2000.0;
const HIGHEST_FT: f64 = 60000.0;
/// The standard altimeter setting, inches of mercury (PHAK ch. 4).
pub const STANDARD_INHG: f64 = 29.92;

/// A standard day's temperature at a pressure altitude.
pub fn isa_temp_c(altitude_ft: f64) -> f64 {
    ISA_SEA_LEVEL_C - ISA_LAPSE_C_PER_FT * altitude_ft
}

/// Sigma: the air's density at a pressure altitude and temperature over
/// a standard day's at sea level.
pub fn density_ratio(altitude_ft: f64, oat_c: f64) -> f64 {
    let altitude_ft = altitude_ft.clamp(LOWEST_FT, HIGHEST_FT);
    let pressure_ratio = (1.0 - LAPSE_OVER_T0_PER_FT * altitude_ft).powf(PRESSURE_EXPONENT);
    pressure_ratio * SEA_LEVEL_K / (oat_c + 273.15)
}

/// The altitude at which a standard day's air has density sigma.
pub fn density_altitude_ft(sigma: f64) -> f64 {
    (1.0 - sigma.powf(1.0 / (PRESSURE_EXPONENT - 1.0))) / LAPSE_OVER_T0_PER_FT
}

/// Pressure altitude from a field's elevation and its altimeter setting:
/// a thousand feet an inch from 29.92 (PHAK ch. 4, "Pressure altitude").
pub fn pressure_altitude_ft(elevation_ft: f64, altimeter_inhg: f64) -> f64 {
    elevation_ft + (STANDARD_INHG - altimeter_inhg) * 1000.0
}
