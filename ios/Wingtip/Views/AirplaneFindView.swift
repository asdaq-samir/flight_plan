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
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(KeptAirplane.name(plane)).font(.headline)
                Text(AirplaneRow.line(plane)).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityLabel(Self.spoken(plane))
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// The line as VoiceOver says it: the height and speed in words.
    static func spoken(_ plane: TrafficAircraft) -> String {
        [plane.type, plane.altitudeFt.map { SpokenFigures.feet(($0 / 100).rounded() * 100) }, plane.speedKt.map(SpokenFigures.knots)]
            .compactMap { $0 }.joined(separator: ", ")
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

#Preview("AirplaneRow") {
    List {
        AirplaneRow(plane: TrafficAircraft(altitudeFt: 4500, callsign: "N3429J", hex: "a8c2e1", lat: 46.84, lon: -92.19, registration: "N3429J",
                                           speedKt: 112, trackDeg: 215, type: "P28A"))
        AirplaneRow(plane: TrafficAircraft(altitudeFt: 3000, hex: "a1b2c3", lat: 46.90, lon: -92.30, registration: "N172SP", speedKt: 98, trackDeg: 40, type: "C172"))
    }
}
