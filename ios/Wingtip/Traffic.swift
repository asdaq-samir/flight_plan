import CoreLocation
import Foundation
import Observation

/// The airplanes ADS-B receivers hear about the map, from the planner
/// (/api/traffic, vfr.traffic, adsb.lol's open data), as the web app's
/// TrafficLayer asks for them: every five seconds, about own ship where
/// there is a fix, else the middle of the map, out to the map's corners
/// (10 to 60 nm). For knowing what is about, never for avoiding it.
@MainActor
@Observable
final class Traffic {
    /// The planner asks adsb.lol about a region at most every five
    /// seconds (vfr.traffic), so no sooner than that.
    static let every: Duration = .seconds(5)
    /// No newer report than this, s, and the airplane is not drawn: the
    /// web app's CARRY_S.
    static let staleS = 30.0
    /// Within this of own ship's height an airplane is drawn amber, the
    /// traffic to look for first. A design choice, the web app's: 1,000 ft
    /// is the spacing VFR cruising altitudes keep between opposite
    /// directions (14 CFR 91.159).
    static let nearFt = 1000.0
    /// A vertical rate this or more gets an arrow by the height, as a TCAS
    /// display draws one (the FAA's Introduction to TCAS II, version 7.1).
    static let arrowFpm = 500.0

    var on: Bool = UserDefaults.standard.object(forKey: "traffic") as? Bool ?? true {
        didSet { UserDefaults.standard.set(on, forKey: "traffic"); if !on { planes = [] } }
    }
    private(set) var planes: [TrafficAircraft] = []
    private(set) var source: String?
    /// When the airplanes last heard were where they are given: the
    /// answer's time less its own age (TrafficAnswer.age_s).
    private(set) var heardAt: Date?
    /// The middle of the map and the miles to its corner, as the map last
    /// rested.
    var mapCentre: CLLocationCoordinate2D?
    var mapRadiusNm = 30.0

    /// Ask again and again while the map is shown.
    func run(near ownShip: @escaping @MainActor () -> CLLocationCoordinate2D?) async {
        while !Task.isCancelled {
            if on, let at = ownShip() ?? mapCentre {
                let radius = min(60, max(10, mapRadiusNm))
                if let answer = try? await Planner.traffic(lat: at.latitude, lon: at.longitude, radiusNm: radius), on {
                    planes = answer.aircraft.filter { ($0.seenS ?? 0) + (answer.ageS ?? 0) <= Self.staleS }
                    source = answer.source
                    heardAt = Date().addingTimeInterval(-(answer.ageS ?? 0))
                }
            }
            try? await Task.sleep(for: Self.every)
        }
    }

    /// Under the airplane: its height against own ship's in hundreds of
    /// feet, "+05" above and "-12" below, as TCAS writes it, with an arrow
    /// climbing or descending; with own ship's height not known, its own
    /// height in feet, "4,500". Nothing where it sends none. The web app's
    /// trafficLabel, kept the same.
    static func label(_ plane: TrafficAircraft, ownFt: Double?) -> String {
        guard let ft = plane.altitudeFt else { return "" }
        let rate = plane.verticalFpm ?? 0
        let arrow = rate >= arrowFpm ? "↑" : rate <= -arrowFpm ? "↓" : ""
        guard let ownFt else { return "\((Int((ft / 100).rounded()) * 100).formatted())\(arrow)" }
        let hundreds = Int(((ft - ownFt) / 100).rounded())
        return "\(hundreds >= 0 ? "+" : "-")\(String(format: "%02d", abs(hundreds)))\(arrow)"
    }

    static func near(_ plane: TrafficAircraft, ownFt: Double?) -> Bool {
        guard let ownFt, let ft = plane.altitudeFt else { return false }
        return abs(ft - ownFt) <= nearFt
    }

    /// What the Open Database License asks of a map that draws adsb.lol's
    /// data: its source and the licence, named (the web app's
    /// trafficCredit).
    static func credit(_ source: String?) -> String {
        let credits = ["adsb.lol": "Traffic adsb.lol, ODbL", "ADS-B Exchange": "ADS-B Exchange", "adsb.fi": "adsb.fi"]
        let named = (source ?? "adsb.lol").components(separatedBy: " and ").compactMap { credits[$0] }
        guard let first = named.first else { return "Traffic adsb.lol, ODbL" }
        return first == "Traffic adsb.lol, ODbL" ? ([first] + named.dropFirst()).joined(separator: " · ") : "Traffic \(named.joined(separator: " · "))"
    }
}
