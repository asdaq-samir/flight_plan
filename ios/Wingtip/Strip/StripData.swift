import CoreLocation
import Foundation

/// The strip's points, figures and words, apart from its views, so each
/// is tested on its own (StripTests): the web app's
/// features/strip/stripData.ts, with the strip built from the plan's
/// own parts (its legs, checkpoints and course) where the web builds it
/// from the nav log's rows. Every figure here is the planner's -- a
/// leg's heading, distance and minutes, the totals -- only put in order
/// and written; nothing aviation is worked out.

/// A point on the strip, in the order flown: the departure, a checkpoint
/// (brown), a stop or the destination (green).
struct StripPoint: Equatable, Identifiable, Sendable {
    enum Kind: Equatable, Sendable { case departure, checkpoint, stop, destination }

    let key: String
    let kind: Kind
    /// The field's ident, or the checkpoint's name as the nav log has it.
    let name: String
    /// The field's long name; "" for a checkpoint.
    var longName = ""
    var lat: Double?
    var lon: Double?
    /// Minutes from the departure to here, the planner's legs added up;
    /// nil until the nav log is in.
    var minutesFlown: Double?
    /// The leg flown into this point, for its row's figures.
    var leg: Leg?

    var id: String { key }
    var field: Bool { kind != .checkpoint }
    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lon else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

enum StripData {
    /// More checkpoints than this fold in the middle, the first three and
    /// the last two kept (the canvas's "N more checkpoints").
    static let shown = 6
    static let first = 3
    static let last = 2

    /// The strip's points from the plan: the departure, then each leg's
    /// end in order -- a stop where the route lands there, the destination
    /// last, a checkpoint otherwise -- with the minutes to each from the
    /// legs' own, and the minutes on the ground at a stop added after it,
    /// as the planner's briefing counts them. Before the nav log is in,
    /// the route's fields alone from the course, so the ribbon has its
    /// ends.
    static func points(dep: String, dest: String, stops: [String], legs: [Leg], checkpoints: [Checkpoint], course: Course?) -> [StripPoint] {
        guard !dep.isEmpty, !dest.isEmpty else { return [] }
        let ends = [course?.departure] + (course?.stops ?? []).map { Optional($0) } + [course?.destination]
        func end(_ ident: String) -> CourseEnd? {
            ends.compactMap { $0 }.first { $0.ident.uppercased() == ident.uppercased() }
        }
        func field(_ ident: String, _ kind: StripPoint.Kind, key: String) -> StripPoint {
            let found = end(ident)
            return StripPoint(key: key, kind: kind, name: ident.uppercased(), longName: found?.name ?? "", lat: found?.lat, lon: found?.lon)
        }
        var out = [field(dep, .departure, key: "dep")]
        if legs.isEmpty {
            out += stops.enumerated().map { field($1, .stop, key: "stop-\($0)") }
            out.append(field(dest, .destination, key: "dest"))
            return out
        }
        let stopIdents = Set(stops.map { $0.uppercased() })
        var minutes = 0.0
        out[0].minutesFlown = 0
        for (i, leg) in legs.enumerated() {
            minutes += leg.eteMin ?? 0
            let to = leg.to.uppercased()
            let kind: StripPoint.Kind
            if i == legs.count - 1 {
                kind = .destination
            } else if stopIdents.contains(to) || leg.groundMin != nil || leg.procedure?.landing == true {
                kind = .stop
            } else {
                kind = .checkpoint
            }
            var point: StripPoint
            if kind == .checkpoint {
                let mark = checkpoints.first { ($0.name ?? $0.waypoint ?? "").uppercased() == to }
                point = StripPoint(key: "leg-\(i)", kind: .checkpoint, name: leg.to, lat: mark?.lat, lon: mark?.lon)
            } else {
                point = field(leg.to, kind, key: "leg-\(i)")
            }
            point.minutesFlown = minutes
            point.leg = leg
            out.append(point)
            if let ground = leg.groundMin, kind == .stop { minutes += ground }
        }
        return out
    }

    /// Where the airplane is along the strip, for the ribbon: the leg it is
    /// on (0 the first) and how far along it, 0 to 1. The nearest point of
    /// the route is found, and the airplane put on the leg before or after
    /// it by which of the two it is closer to going on to -- a glance, not
    /// navigation: the next checkpoint's own figures are the nav log's.
    /// Points with no position (a checkpoint the chart read has not
    /// placed) are left out of the measuring.
    static func positionAlong(_ points: [StripPoint], fix: CLLocationCoordinate2D?) -> (leg: Int, along: Double)? {
        let placed = points.enumerated().compactMap { i, p in p.coordinate.map { (index: i, at: $0) } }
        guard let fix, placed.count >= 2 else { return nil }
        var nearest = 0
        var least = Double.infinity
        for (k, p) in placed.enumerated() {
            let d = Flight.nm(from: fix, to: p.at)
            if d < least { least = d; nearest = k }
        }
        let next = nearest + 1 < placed.count ? placed[nearest + 1] : nil
        let before = nearest > 0 ? placed[nearest - 1] : nil
        // Past the nearest point, on the way to the next: along that leg;
        // else still on the way to it from the one before.
        if let next, before == nil || Flight.nm(from: fix, to: next.at) < Flight.nm(from: placed[nearest].at, to: next.at) {
            let legNm = Flight.nm(from: placed[nearest].at, to: next.at)
            return (placed[nearest].index, legNm > 0 ? min(1, least / legNm) : 0)
        }
        if let before {
            let legNm = Flight.nm(from: before.at, to: placed[nearest].at)
            return (before.index, legNm > 0 ? max(0, 1 - least / legNm) : 1)
        }
        return (0, 0)
    }

    /// The next point ahead of the airplane: the end of the leg it is on.
    static func nextPoint(_ points: [StripPoint], position: (leg: Int, along: Double)?) -> StripPoint? {
        guard let position, position.leg + 1 < points.count else { return nil }
        return points[position.leg + 1]
    }

    /// The pilot's initials from their name ("Asdaq Samir" is AS), or the
    /// first letter of their address; "" signed out.
    static func initials(name: String?, email: String?) -> String {
        let name = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty, !name.contains("@") {
            let parts = name.split(whereSeparator: { $0.isWhitespace })
            if parts.count > 1, let a = parts[0].first, let b = parts[parts.count - 1].first { return String([a, b]).uppercased() }
            return String(name.prefix(2)).uppercased()
        }
        let address = (email?.isEmpty == false ? email : nil) ?? (name.isEmpty ? nil : name)
        return address?.first.map { String($0).uppercased() } ?? ""
    }

    /// A duration as the web app writes every one, "1h 5m", "45m", "3h",
    /// and "0m" for none (lib/clock duration, Intl's narrow style): the
    /// minutes rounded first, so 119.6 is "2h", not "1h 60m".
    static func duration(_ minutes: Double) -> String {
        let whole = Int(minutes.rounded())
        let h = whole / 60, m = whole % 60
        if h > 0 && m > 0 { return "\(h)h \(m)m" }
        if h > 0 { return "\(h)h" }
        return "\(m)m"
    }

    /// A route's name as the capsule and a saved flight name it, "C81 →
    /// KMSN → KDLH"; one field to itself with no stop, "KDLH local".
    static func routeName(dep: String, dest: String, stops: [String]) -> String {
        if !dep.isEmpty, dep == dest, stops.isEmpty { return "\(dep) local" }
        return ([dep] + stops + [dest]).joined(separator: " → ")
    }

    /// The route's line as the canvas writes it under the verdict: the
    /// route by its points, the airplane, the altitude as FL, when. The
    /// phone's plan leaves at once, so "leaving now" unless a time is given.
    static func headLine(dep: String, dest: String, stops: [String], airplane: String, cruiseFt: Double?, departAt: Date?) -> String {
        var parts = [routeName(dep: dep, dest: dest, stops: stops)]
        if !airplane.isEmpty { parts.append(airplane) }
        if let cruiseFt { parts.append(flightLevel(cruiseFt)) }
        parts.append(departAt.map { "leaving \(Formats.time($0))" } ?? "leaving now")
        return parts.joined(separator: " · ")
    }

    /// The ribbon's figures at the right: the time and the fuel, "2h 45m ·
    /// 29.1 gal"; "" with neither.
    static func figures(eteMin: Double?, fuelGal: Double?) -> String {
        [eteMin.map(duration), fuelGal.map { Formats.gal($0) }].compactMap { $0 }.joined(separator: " · ")
    }

    /// The verdict's tag, as the ribbon wears it; nil for a finding with
    /// no tag (pending, unknown).
    static func tag(_ finding: String) -> String? {
        switch finding {
        case "ok": return "Go"
        case "caution": return "Caution"
        case "stop": return "No-go"
        default: return nil
        }
    }

    /// The screens the field's chips offer, each handled as typed: how a
    /// pilot finds the rest without tabs (the web's stripSuggestions).
    static func suggestions(routed: Bool, dest: String) -> [String] {
        if routed {
            return ["Brief me", "Weather at \(dest)", "Nav log", "Routes", "Altitude", "Procedures", "Stops", "Nearest fuel",
                    "File flight plan", "Dry run", "Clearance", "My airplane", "Saved flights"]
        }
        return ["Nearest fuel", "Nearest airports", "Saved flights", "Favorites", "Recents", "My airplane", "Logbook", "Settings"]
    }

    /// A chip on a field's card: its label in capitals and the words it
    /// says in full (for VoiceOver).
    struct Chip: Equatable, Sendable {
        let label: String
        let words: String
    }

    /// The frequency chips a field's card offers: its ATIS (or AWOS/ASOS),
    /// its tower where it has one, else its CTAF -- the one so called, else
    /// a UNICOM that is also the CTAF, else MULTICOM's 122.9 (AC 90-66C
    /// 9.6, as the web's lib/frequencies ctafOf has it from the engine).
    /// The types are OurAirports' as the planner sends them.
    static func radioChips(_ frequencies: [Frequency], towered: Bool) -> [Chip] {
        var out: [Chip] = []
        func kind(_ f: Frequency) -> String { (f.type ?? "").uppercased() }
        func first(_ types: [String]) -> Frequency? {
            for type in types {
                if let found = frequencies.first(where: { kind($0) == type && $0.frequencyMhz != nil }) { return found }
            }
            return nil
        }
        if let atis = first(["ATIS", "AWOS", "ASOS"]), let mhz = atis.frequencyMhz {
            out.append(Chip(label: kind(atis), words: "\(kind(atis)) \(AirportWords.mhz(mhz))"))
        }
        if towered, let tower = first(["TWR", "TOWER"]), let mhz = tower.frequencyMhz {
            out.append(Chip(label: "TOWER", words: "Tower \(AirportWords.mhz(mhz))"))
        } else {
            let unicom = frequencies.first { kind($0) == "UNICOM" && ($0.description ?? "").uppercased().contains("CTAF") && $0.frequencyMhz != nil }
            let mhz = first(["CTAF"])?.frequencyMhz ?? unicom?.frequencyMhz ?? 122.9
            out.append(Chip(label: "CTAF", words: "CTAF \(AirportWords.mhz(mhz))"))
        }
        return out
    }

    /// A field's weather in a line for its card: its flight category and
    /// the wind reported, from the planner's METAR for it.
    static func weatherLine(_ metar: Metar?) -> String? {
        guard let metar else { return nil }
        var parts: [String] = []
        if let category = metar.flightCategory { parts.append(category) }
        if metar.windSpeedKt != nil || metar.windDirTrueDeg != nil {
            parts.append("wind \(AirportWords.windLine(dirTrueDeg: metar.windDirTrueDeg, speedKt: metar.windSpeedKt, gustKt: metar.windGustKt))")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The runway the planner marks in use, from its wind on each.
    static func runwayInUse(_ runways: [Runway]) -> String? {
        runways.first { $0.wind?.inUse == true }?.wind?.end
    }

    /// The strip's middle rows folded: the checkpoints past `shown` are
    /// cut to the first three and the last two, nil where the fold goes;
    /// the count folded away is the second value. Only checkpoints count
    /// towards the fold; the stops between are kept where they fall.
    static func folded(_ middle: [StripPoint], unfolded: Bool) -> (rows: [StripPoint?], hidden: Int) {
        let checkpoints = middle.filter { $0.kind == .checkpoint }.count
        guard !unfolded, checkpoints > shown, middle.count > first + last else { return (middle.map { Optional($0) }, 0) }
        let rows: [StripPoint?] = middle.prefix(first).map { Optional($0) } + [nil] + middle.suffix(last).map { Optional($0) }
        return (rows, middle.count - first - last)
    }

    /// Each checkpoint's number as the log counts them, whatever is folded.
    static func numbers(_ middle: [StripPoint]) -> [String: Int] {
        var out: [String: Int] = [:]
        var n = 0
        for point in middle where point.kind == .checkpoint {
            n += 1
            out[point.key] = n
        }
        return out
    }
}
