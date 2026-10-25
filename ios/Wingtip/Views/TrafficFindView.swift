import SwiftUI

/// An airplane found by what a pilot knows it by -- its callsign
/// (UAL2088), registration (N174HA) or ICAO address -- anywhere in
/// adsb.lol's coverage, as the web app's Aircraft card finds one; before
/// anything is typed, the Favorites and the Recents. A tap opens its card
/// and tracks it.
struct TrafficFindView: View {
    @Environment(Traffic.self) private var traffic
    @State private var typed = ""
    @State private var found: TrafficFound?
    @State private var asked = ""
    @State private var failed = false
    @State private var searching: Task<Void, Never>?
    private var tracking: Tracking { Tracking.shared }

    /// adsb.lol answers one request every few seconds from the planner's
    /// address: a search it could not be asked for yet is asked again,
    /// past the planner's fifteen-second wait, three times at most.
    static let retries = 3
    static let retryEvery: Duration = .seconds(6)

    private var wanted: String { typed.filter { !$0.isWhitespace }.uppercased() }

    /// Whether an airplane's callsign, registration or address begins with
    /// what is typed (a registration's hyphen aside).
    static func named(_ plane: TrafficAircraft, _ text: String) -> Bool {
        let bare = text.replacingOccurrences(of: "-", with: "")
        return (plane.callsign ?? "").uppercased().hasPrefix(text)
            || (plane.registration ?? "").replacingOccurrences(of: "-", with: "").uppercased().hasPrefix(bare)
            || plane.hex.uppercased().hasPrefix(text)
    }

    /// The airplanes on the map whose name begins with it, before adsb.lol's
    /// answer for the rest; then that answer's, eight at most.
    private var listed: [TrafficAircraft] {
        guard wanted.count >= 3 else { return [] }
        let heard = traffic.planes.filter { Self.named($0, wanted) }
        let more = (asked == wanted ? found?.aircraft ?? [] : []).filter { plane in !heard.contains { $0.hex == plane.hex } }
        return Array((heard + more).prefix(8))
    }

    var body: some View {
        List {
            if wanted.count >= 3 {
                Section(found?.source == "ADS-B Exchange" && asked == wanted ? "Found by ADS-B Exchange" : "Found") {
                    ForEach(listed, id: \.hex) { plane in
                        Button { open(plane.hex, plane: plane) } label: { TrafficRow(plane: plane) }
                            .foregroundStyle(.primary)
                    }
                    if listed.isEmpty, asked == wanted, let record = found?.registered {
                        // None in the air by that name: the FAA's record,
                        // its card opened all the same.
                        Button {
                            if let hex = record.modeSHex { open(hex.lowercased(), plane: nil) }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(record.nNumber).font(.headline)
                                Text([[record.manufacturer, record.model].compactMap { $0 }.joined(separator: " ").nonEmpty,
                                      found?.checked == false ? "not yet known whether it is flying" : "not in the air now"]
                                    .compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        .foregroundStyle(.primary)
                        .disabled(record.modeSHex == nil)
                    } else if listed.isEmpty, asked == wanted, found != nil, found?.checked != false {
                        Text("None in the air by that name is heard now").foregroundStyle(.secondary)
                    }
                    if asked == wanted, found?.checked == false {
                        Text("adsb.lol is busy; asking again…").font(.footnote).foregroundStyle(.secondary)
                    }
                    if failed, asked == wanted {
                        Text("Couldn't search. Try again in a moment.").font(.footnote).foregroundStyle(.red)
                    } else if asked != wanted || found == nil, listed.isEmpty {
                        Text("Fetching \(wanted)…").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            } else {
                if !tracking.favorites.isEmpty {
                    Section("Favorites") {
                        ForEach(tracking.favorites) { kept in
                            Button { open(kept.hex, plane: nil) } label: { KeptRow(kept: kept) }.foregroundStyle(.primary)
                        }
                    }
                }
                Section("Recents") {
                    if tracking.recents.isEmpty {
                        Text("None yet: the airplanes opened are kept here.").foregroundStyle(.secondary)
                    }
                    ForEach(tracking.recents) { kept in
                        Button { open(kept.hex, plane: nil) } label: { KeptRow(kept: kept) }.foregroundStyle(.primary)
                    }
                    .onDelete { at in
                        for hex in at.map({ tracking.recents[$0].hex }) { tracking.forget(recent: hex) }
                    }
                }
            }
        }
        .navigationTitle("Find an airplane")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $typed, prompt: "Callsign, N-number or address")
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
        .onSubmit(of: .search) {
            if let first = listed.first { open(first.hex, plane: first) } else { ask(wanted, now: true) }
        }
        .onChange(of: wanted) { _, next in ask(next, now: false) }
    }

    /// Asked once the typing pauses, half a second: each search is a
    /// request adsb.lol paces.
    private func ask(_ text: String, now: Bool) {
        searching?.cancel()
        guard text.count >= 3 else { return }
        searching = Task {
            if !now { try? await Task.sleep(for: .milliseconds(500)) }
            for attempt in 0...Self.retries {
                guard !Task.isCancelled else { return }
                do {
                    let answer = try await Planner.findTraffic(text)
                    guard !Task.isCancelled else { return }
                    found = answer
                    asked = text
                    failed = false
                    if answer.checked != false { return }
                } catch {
                    guard !Task.isCancelled else { return }
                    asked = text
                    failed = true
                    return
                }
                if attempt < Self.retries { try? await Task.sleep(for: Self.retryEvery) }
            }
        }
    }

    private func open(_ hex: String, plane: TrafficAircraft?) {
        tracking.track(hex, plane: plane)
        FlightUI.shared.card = .airplane(hex.lowercased())
    }
}

/// An airplane heard: its name, type, height and speed.
struct TrafficRow: View {
    let plane: TrafficAircraft

    var body: some View {
        HStack {
            Image(systemName: "airplane").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(plane.callsign ?? plane.registration ?? plane.hex.uppercased()).font(.headline)
                Text([plane.registration != plane.callsign ? plane.registration : nil, plane.type,
                      plane.altitudeFt.map { "\((Int(($0 / 100).rounded()) * 100).formatted()) ft" },
                      plane.speedKt.map { "\(Int($0.rounded())) kt" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

struct KeptRow: View {
    let kept: KeptAircraft

    var body: some View {
        HStack {
            Image(systemName: "airplane").foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(kept.name).font(.headline)
                if let type = kept.type { Text(type).font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }
}
