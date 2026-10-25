import SwiftUI

/// An airplane kept on this device (the web app's favoriteAircraft): its
/// ICAO address, what it is called and its type, for its row before
/// anything is asked.
struct KeptAirplane: Codable, Hashable, Sendable, Identifiable {
    let hex: String
    var name: String
    var type: String?
    var id: String { hex }

    static let key = "aircraftFavorites"

    static func all(_ defaults: UserDefaults = .standard) -> [KeptAirplane] {
        guard let data = defaults.data(forKey: key), let list = try? JSONDecoder().decode([KeptAirplane].self, from: data) else { return [] }
        return list
    }

    static func save(_ list: [KeptAirplane], _ defaults: UserDefaults = .standard) {
        defaults.set(try? JSONEncoder().encode(list), forKey: key)
    }

    /// Kept, or let go where it was kept already.
    static func toggled(_ list: [KeptAirplane], _ plane: TrafficAircraft) -> [KeptAirplane] {
        if list.contains(where: { $0.hex == plane.hex }) { return list.filter { $0.hex != plane.hex } }
        return list + [KeptAirplane(hex: plane.hex, name: name(plane), type: plane.type)]
    }

    /// Its callsign, else its registration, else its address.
    static func name(_ plane: TrafficAircraft) -> String { plane.callsign ?? plane.registration ?? plane.hex.uppercased() }
}

/// One airplane in a list: its name, what it is, its height and speed.
struct AirplaneRow: View {
    let plane: TrafficAircraft

    var body: some View {
        HStack {
            Image(systemName: "airplane").rotationEffect(.degrees((plane.trackDeg ?? 90) - 90)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(KeptAirplane.name(plane)).font(.headline)
                Text(AirplaneRow.line(plane)).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    /// Its type, height in hundreds of feet as reported, and speed.
    static func line(_ plane: TrafficAircraft) -> String {
        var parts: [String] = []
        if let type = plane.type { parts.append(type) }
        if let ft = plane.altitudeFt { parts.append("\(Int((ft / 100).rounded() * 100).formatted()) ft") }
        if let kt = plane.speedKt { parts.append("\(Int(kt.rounded())) kt") }
        return parts.joined(separator: " · ")
    }
}
