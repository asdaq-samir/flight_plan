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
