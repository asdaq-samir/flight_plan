import CoreLocation
import Foundation
import Observation

/// The airplanes ADS-B receivers hear about the map, from the planner
/// (/api/traffic, wingtip.traffic, adsb.lol's open data), as the web app's
/// TrafficLayer asks for them: every five seconds, about own ship where
/// there is a fix, else the middle of the map, out to the map's corners
/// (10 to 60 nm). For knowing what is about, never for avoiding it.
@MainActor
@Observable
final class Traffic {
    /// The planner asks adsb.lol about a region at most every five
    /// seconds (wingtip.traffic), so no sooner than that; twice that with the
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
    /// The airplanes near own ship at the last answer, each told once.
    private var nearHexes: Set<String> = []

    /// An airplane within this of own ship, with its height within 1,000
    /// ft (`near`), is told while the app is not in front. A design
    /// choice, no rule: the amber mark says it on the screen out to the
    /// map's edge, but a notification is for traffic a pilot looks for
    /// now, so the horizontal bound keeps an airplane 40 nm off quiet.
    static let tellWithinNm = 5.0

    /// Ask again and again while the map is shown, on the app's one clock,
    /// about own ship where there is a fix (its height tells which
    /// airplanes are near), else about the middle of the map.
    func run(near ownShip: @escaping @MainActor () -> OwnShip.Fix?) async {
        await Ticker.shared.run(every: Self.everyS) { [weak self] in
            await self?.ask(near: ownShip())
        }
    }

    /// One answer about a point, where traffic is on and there is one.
    private func ask(near fix: OwnShip.Fix?) async {
        guard on, let at = fix?.coordinate ?? mapCentre else { return }
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
        await tellNear(fix)
    }

    /// The airplanes near own ship (the engine's `traffic_marks`, the
    /// amber mark: within 1,000 ft of its height) and within
    /// `tellWithinNm`, each told once as it comes near, as a
    /// time-sensitive notification while the app is not in front
    /// (Notifications); on the screen the amber mark says it, so nothing
    /// is sent then. Permission is asked the first time traffic is near
    /// with the app in front, the moment the pilot sees what it is for.
    private func tellNear(_ fix: OwnShip.Fix?) async {
        guard let fix, let ownFt = fix.altitudeFt else {
            nearHexes = []
            return
        }
        let marks = Self.marks(planes, ownFt: ownFt)
        var near: Set<String> = []
        for (plane, mark) in zip(planes, marks) where mark.near {
            let here = CLLocationCoordinate2D(latitude: plane.lat, longitude: plane.lon)
            let nm = Flight.nm(from: fix.coordinate, to: here)
            guard nm <= Self.tellWithinNm else { continue }
            near.insert(plane.hex)
            guard !nearHexes.contains(plane.hex) else { continue }
            if Notifications.inFront {
                await Notifications.allow()
                continue
            }
            let name = plane.callsign ?? plane.registration ?? plane.hex
            let against = plane.altitudeFt.map { ", \(FlightWords.against($0 - ownFt))" } ?? ""
            let place = "\(Formats.nm(nm, decimals: 0)) \(AirportWords.compassPoint(Flight.bearing(from: fix.coordinate, to: here))) of you"
            Notifications.tell("Traffic near you", "\(name), \(place)\(against)", id: "traffic-\(plane.hex)")
        }
        nearHexes = near
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
    /// The engine's own answer, its type generated from the engine's
    /// contract (EngineContract.swift, scripts/engine-contract-apps.sh).
    typealias Mark = EngineTrafficMarksAnswerElement

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
