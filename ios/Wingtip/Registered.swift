import Foundation

/// An airplane by its N-number, as the web app picks one
/// (lib/aircraftChoice): the FAA's registry says its make, model and year,
/// and the type's planner profile is the one whose handbook figures it
/// flies on -- the Cherokee 140 by its year, the 1970 "D" (14,300 ft) from
/// the 1973-on Cruiser (10,950 ft), from the owner's own handbook page.
enum Registered {
    /// 14 CFR 47.15's shape for an N-number: N, then up to five characters,
    /// digits first and at most two letters at the end.
    static let nNumber = try! NSRegularExpression(pattern: "^N[1-9][0-9]{0,4}$|^N[1-9][0-9]{0,3}[A-Z]$|^N[1-9][0-9]{0,2}[A-Z]{2}$")

    static func isNNumber(_ s: String) -> Bool {
        let range = NSRange(s.startIndex..., in: s)
        return nNumber.firstMatch(in: s, range: range) != nil
    }

    private struct Known {
        let maker: String
        let model: String
        let profile: String
        var before: Int? = nil
    }

    /// The types the planner has handbook figures for, by the registry's
    /// make and model (web REGISTERED_TYPES, kept the same).
    private static let known: [Known] = [
        Known(maker: "CESSNA", model: "^F?A?150[A-M]?$|^FA150L$", profile: "c150"),
        Known(maker: "CESSNA", model: "^[AF]?152$", profile: "c152"),
        Known(maker: "CESSNA", model: "^172[A-Z]?$", profile: "c172"),
        Known(maker: "CESSNA", model: "^182[ST]$", profile: "c182"),
        Known(maker: "PIPER", model: "^PA28181", profile: "pa28"),
        Known(maker: "PIPER", model: "^PA28140$", profile: "pa28140", before: 1973),
        Known(maker: "PIPER", model: "^PA28140$", profile: "pa28140cruiser"),
        Known(maker: "PIPER", model: "^PA28161$", profile: "pa28161"),
        Known(maker: "PIPER", model: "^PA28R201$", profile: "pa28r201"),
        Known(maker: "MOONEY", model: "^M20J$", profile: "m20j"),
        Known(maker: "CIRRUS", model: "^SR20$", profile: "sr20"),
        Known(maker: "CIRRUS", model: "^SR22$", profile: "sr22"),
        Known(maker: "DIAMOND", model: "^DA40NG$", profile: "da40ng"),
    ]

    /// The planner profile for a registered airplane, or nil where the
    /// planner has no figures for its type.
    static func profile(manufacturer: String?, model: String?, year: Int?) -> String? {
        let maker = (manufacturer ?? "").uppercased()
        let model = (model ?? "").uppercased().replacingOccurrences(of: "[\\s-]+", with: "", options: .regularExpression)
        for type in known where maker.contains(type.maker) && model.range(of: type.model, options: .regularExpression) != nil {
            if let before = type.before {
                guard let year, year < before else { continue }
            }
            return type.profile
        }
        return nil
    }
}

/// The FAA registry's record (AircraftRegistration), the parts the app
/// uses.
struct AircraftRegistration: Codable, Equatable, Sendable {
    let nNumber: String
    var manufacturer: String?
    var model: String?
    var year: Int?
    var modeSHex: String?
    var owner: String?
    var city: String?
    var state: String?
    // `n_number` and `mode_s_hex` come through Planner.snakeCase as
    // nNumber and modeSHex; a key spelt by hand would not match them.
}

/// The figures the nav log flies an airplane on: the type's, or the
/// pilot's own where set.
struct Figures: Codable, Equatable, Sendable {
    var cruiseTasKt: Double?
    var fuelBurnGph: Double?
    var usableFuelGal: Double?
    var cruisePowerPct: Double?
    var climbTasKt: Double?
    var climbFuelBurnGph: Double?
    var serviceCeilingFt: Double?

    /// The nav log's query for them, only the ones set.
    var query: [String: String?] {
        [
            "cruise_tas_kt": cruiseTasKt.map { String($0) }, "fuel_burn_gph": fuelBurnGph.map { String($0) },
            "usable_fuel_gal": usableFuelGal.map { String($0) }, "cruise_power_pct": cruisePowerPct.map { String($0) },
            "climb_tas_kt": climbTasKt.map { String($0) }, "climb_fuel_burn_gph": climbFuelBurnGph.map { String($0) },
            "service_ceiling_ft": serviceCeilingFt.map { String($0) },
        ]
    }

    init(cruiseTasKt: Double? = nil, fuelBurnGph: Double? = nil, usableFuelGal: Double? = nil, cruisePowerPct: Double? = nil, climbTasKt: Double? = nil, climbFuelBurnGph: Double? = nil, serviceCeilingFt: Double? = nil) {
        self.cruiseTasKt = cruiseTasKt; self.fuelBurnGph = fuelBurnGph; self.usableFuelGal = usableFuelGal
        self.cruisePowerPct = cruisePowerPct; self.climbTasKt = climbTasKt; self.climbFuelBurnGph = climbFuelBurnGph
        self.serviceCeilingFt = serviceCeilingFt
    }

    init(_ own: OwnAircraftRecord) {
        self.init(cruiseTasKt: own.cruiseTasKt, fuelBurnGph: own.fuelBurnGph, usableFuelGal: own.usableFuelGal, cruisePowerPct: own.cruisePowerPct,
                  climbTasKt: own.climbTasKt, climbFuelBurnGph: own.climbFuelBurnGph)
    }
}
