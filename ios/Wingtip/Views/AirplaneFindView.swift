import SwiftUI

/// What the planner finds in the air by a name a pilot knows an airplane
/// by (/api/traffic/find, adsb.lol's open data): its callsign, its
/// registration or its ICAO address, and a US airplane's FAA record.
struct TrafficFound: Codable, Equatable, Sendable {
    var aircraft: [TrafficAircraft]
    var registered: AircraftRegistration?
    var source: String?
    var license: String?
}

extension Planner {
    static func findTraffic(_ q: String) async throws -> TrafficFound {
        try await fetch(TrafficFound.self, "/api/traffic/find", ["q": q])
    }
}

/// An airplane kept on this device (the web app's favoriteAircraft): its
/// ICAO address, what it is called and its type, for its row before
/// anything is asked.
struct KeptAirplane: Codable, Equatable, Sendable, Identifiable {
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

/// The Aircraft tab's search for an airplane in the air (the web app's
/// AircraftCard): what is typed asked about once it has rested half a
/// second, as adsb.lol paces searches (vfr.traffic); before anything is
/// typed, the airplanes kept, each a tap to find it again.
struct AirplaneFindView: View {
    @State private var typed = ""
    @State private var found: TrafficFound?
    @State private var searching = false
    @State private var problem: String?
    @State private var kept = KeptAirplane.all()

    private var wanted: String { typed.filter { !$0.isWhitespace }.uppercased() }

    var body: some View {
        List {
            Section {
                TextField("Callsign, registration or address", text: $typed)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled().font(.body.monospaced())
            }
            if wanted.count < 3 {
                if !kept.isEmpty {
                    Section("Favorites") {
                        ForEach(kept) { k in
                            Button { typed = k.hex.uppercased() } label: {
                                LabeledContent(k.name, value: k.type ?? "")
                            }
                            .foregroundStyle(.primary)
                        }
                        .onDelete { at in kept.remove(atOffsets: at); KeptAirplane.save(kept) }
                    }
                }
            } else if let found {
                Section {
                    if found.aircraft.isEmpty { Text(searching ? "Searching…" : "None in the air by that name now").foregroundStyle(.secondary) }
                    ForEach(found.aircraft, id: \.hex) { plane in
                        NavigationLink {
                            AirplaneDetailView(plane: plane, registered: found.registered, kept: $kept)
                        } label: {
                            AirplaneRow(plane: plane)
                        }
                    }
                } footer: {
                    if !found.aircraft.isEmpty, let source = found.source { Text(Traffic.credit(source)) }
                }
            } else if searching {
                ProgressView()
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("Find an Airplane")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: wanted) {
            guard wanted.count >= 3 else { found = nil; return }
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            searching = true
            defer { searching = false }
            do { found = try await Planner.findTraffic(String(wanted.prefix(12))); problem = nil } catch {
                if !Task.isCancelled { problem = error.localizedDescription }
            }
        }
    }
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

/// An airplane found: what it sends, the FAA's record of a US one, and a
/// star to keep it.
struct AirplaneDetailView: View {
    let plane: TrafficAircraft
    let registered: AircraftRegistration?
    @Binding var kept: [KeptAirplane]

    /// Whether the registry's record is this airplane's: by its Mode S
    /// address, else its registration.
    static func same(_ plane: TrafficAircraft, _ r: AircraftRegistration) -> Bool {
        if let hex = r.modeSHex, hex.lowercased() == plane.hex.lowercased() { return true }
        let n = r.nNumber.uppercased().hasPrefix("N") ? r.nNumber.uppercased() : "N" + r.nNumber.uppercased()
        return plane.registration?.uppercased().replacingOccurrences(of: "-", with: "") == n
    }

    var body: some View {
        List {
            Section {
                if let c = plane.callsign { LabeledContent("Callsign", value: c) }
                if let r = plane.registration { LabeledContent("Registration", value: r) }
                LabeledContent("Address", value: plane.hex.uppercased())
                if let t = plane.type { LabeledContent("Type", value: t) }
                if let ft = plane.altitudeFt { LabeledContent("Altitude", value: "\(Int(ft).formatted()) ft") }
                if let kt = plane.speedKt { LabeledContent("Groundspeed", value: "\(Int(kt.rounded())) kt") }
                if let track = plane.trackDeg { LabeledContent("Track", value: String(format: "%03.0f°", track)) }
                if let fpm = plane.verticalFpm { LabeledContent("Vertical rate", value: "\(Int(fpm).formatted()) fpm") }
            }
            if let registered, Self.same(plane, registered) {
                Section("FAA registry") {
                    LabeledContent("N-number", value: registered.nNumber.hasPrefix("N") ? registered.nNumber : "N\(registered.nNumber)")
                    if let m = registered.manufacturer { LabeledContent("Make", value: m) }
                    if let m = registered.model { LabeledContent("Model", value: m) }
                    if let y = registered.year { LabeledContent("Year", value: String(y)) }
                    if let o = registered.owner { LabeledContent("Owner", value: o) }
                    if let c = registered.city { LabeledContent("City", value: [c, registered.state].compactMap { $0 }.joined(separator: ", ")) }
                }
            }
        }
        .navigationTitle(KeptAirplane.name(plane))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                let isKept = kept.contains { $0.hex == plane.hex }
                Button {
                    kept = KeptAirplane.toggled(kept, plane)
                    KeptAirplane.save(kept)
                } label: {
                    Label(isKept ? "Remove from Favorites" : "Add to Favorites", systemImage: isKept ? "star.fill" : "star")
                }
            }
        }
    }
}
