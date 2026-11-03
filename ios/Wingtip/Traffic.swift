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
    /// seconds (vfr.traffic), so no sooner than that; twice that with the
    /// app put away (Ticker).
    static let everyS: TimeInterval = 5
    /// No newer report than this, s, and the airplane is not drawn: the
    /// web app's CARRY_S.
    static let staleS = 30.0
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

    /// Ask again and again while the map is shown, on the app's one clock.
    func run(near ownShip: @escaping @MainActor () -> CLLocationCoordinate2D?) async {
        await Ticker.shared.run(every: Self.everyS) { [weak self] in
            await self?.ask(near: ownShip())
        }
    }

    /// One answer about a point, where traffic is on and there is one.
    private func ask(near at: CLLocationCoordinate2D?) async {
        guard on, let at = at ?? mapCentre else { return }
        let radius = min(60, max(10, mapRadiusNm))
        let answer: TrafficAnswer
        do {
            answer = try await Planner.traffic(lat: at.latitude, lon: at.longitude, radiusNm: radius)
        } catch {
            Log.map.notice("the traffic could not be asked for: \(error.localizedDescription, privacy: .public)")
            return
        }
        guard on else { return }
        planes = answer.aircraft.filter { ($0.seenS ?? 0) + (answer.ageS ?? 0) <= Self.staleS }
        source = answer.source
        heardAt = Date().addingTimeInterval(-(answer.ageS ?? 0))
    }

    /// What is drawn under an airplane: its height against own ship's in
    /// hundreds of feet, "+05" above and "-12" below, as TCAS writes it,
    /// with an arrow climbing or descending at 500 ft/min or more (the
    /// FAA's Introduction to TCAS II, version 7.1); with own ship's height
    /// not known, its own height in feet, "4,500"; nothing where it sends
    /// none. The hundreds cut toward own ship, never rounded away from it,
    /// so an airplane is never shown further off than it is (the owner,
    /// 2026-10-28). And whether it is near, within 1,000 ft of own ship's
    /// height, drawn amber, the traffic to look for first: a design choice,
    /// the web app's, 1,000 ft being the spacing VFR cruising altitudes
    /// keep between opposite directions (14 CFR 91.159).
    struct Mark: Decodable, Equatable {
        let label: String
        let near: Bool
    }

    /// Each airplane's mark, in one call (the engine's `traffic_marks`,
    /// the web app's trafficLabel, traffic.json); none where the engine
    /// cannot answer.
    static func marks(_ planes: [TrafficAircraft], ownFt: Double?) -> [Mark] {
        let asked: [[String: Any?]] = planes.map { ["altitude_ft": $0.altitudeFt, "vertical_fpm": $0.verticalFpm] }
        let marks: [Mark]? = try? Engine.call("traffic_marks", json: ["own_ft": ownFt, "planes": asked])
        return marks ?? []
    }

    static func label(_ plane: TrafficAircraft, ownFt: Double?) -> String {
        marks([plane], ownFt: ownFt).first?.label ?? ""
    }

    static func near(_ plane: TrafficAircraft, ownFt: Double?) -> Bool {
        marks([plane], ownFt: ownFt).first?.near ?? false
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
