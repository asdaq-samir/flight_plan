import SwiftUI

/// Airport: fields by ident or name as they are typed, and towns and
/// addresses to find the fields nearest them; with nothing typed, the
/// strip of Favorites, Recents or the nearest fields (the web app's
/// AirportPill) and the fields nearest the phone.
struct AirportSearchView: View {
    @Environment(OwnShip.self) private var ownShip
    @State private var nearest: [NearestAirport] = []
    /// The cards open over the search, newest last, as AirportRoute
    /// writes them: a field tapped on the chart opens its card here, a
    /// point held on it the airspace there.
    @Binding var path: [String]
    @State private var query = ""
    @State private var found: [AirportSuggestion] = []
    @State private var places: [PlaceFound] = []
    @State private var searching: Task<Void, Never>?
    private var shelf: AirportShelf { .shared }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if query.isEmpty {
                    AirportStrip(nearest: nearest, open: { path.append($0) })
                    if shelf.shows != .nearest, !nearest.isEmpty {
                        Section("Nearest") {
                            ForEach(nearest.prefix(5)) { field in
                                NavigationLink(value: field.ident) { NearestRow(field: field) }
                            }
                        }
                    }
                } else if found.isEmpty && places.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    if !found.isEmpty {
                        Section("Airports") {
                            ForEach(found) { field in
                                NavigationLink(value: field.ident) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(field.ident).font(.headline)
                                        Text([field.name, field.municipality, field.region].compactMap { $0 }.joined(separator: " · "))
                                            .font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    // A town or a street address: the fields nearest it,
                    // as Maps' search asks where (the web app's Nearest).
                    let towns = places.filter { $0.kind != "airport" }
                    if !towns.isEmpty {
                        Section("Fields near") {
                            ForEach(towns) { place in
                                NavigationLink(value: AirportRoute.nearFrom(lat: place.lat, lon: place.lon, label: place.label).text) {
                                    Label(place.label, systemImage: place.kind == "address" ? "mappin" : "building.2")
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Airport")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { text in AirportDestination(route: AirportRoute(text), nearest: nearest) }
            .searchable(text: $query, prompt: "Identifier, name or town")
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            // The nearest fields from where the phone is, asked again once
            // it has moved a mile.
            .task(id: ownShip.fix.map { "\(($0.coordinate.latitude * 60).rounded()),\(($0.coordinate.longitude * 60).rounded())" }) {
                guard let at = ownShip.fix?.coordinate else { return }
                if let fields = try? await Planner.nearest(lat: at.latitude, lon: at.longitude, limit: 25) { nearest = fields }
            }
            .onChange(of: query) { _, q in
                searching?.cancel()
                let q = q.trimmingCharacters(in: .whitespaces)
                guard q.count >= 2 else { found = []; places = []; return }
                searching = Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    async let airports = try? Planner.search(q)
                    // The geocoder is a request a word, not a letter: asked
                    // once the typing has stopped, as the airports are.
                    async let towns = try? Planner.places(q)
                    let (fields, spots) = await (airports, towns)
                    guard !Task.isCancelled else { return }
                    found = fields ?? []
                    places = spots ?? []
                }
            }
        }
    }
}

/// What the stack opens, by its route.
struct AirportDestination: View {
    let route: AirportRoute
    let nearest: [NearestAirport]

    var body: some View {
        switch route {
        case .airport(let ident): AirportCard(ident: ident)
        case .airspace(let lat, let lon): AirspaceCard(lat: lat, lon: lon)
        case .list(let shows): AirportListView(shows: shows, nearest: nearest)
        case .nearFrom(let lat, let lon, let label): NearFromView(lat: lat, lon: lon, label: label)
        }
    }
}

/// The strip under the search, "one row", as the web app's: the
/// Favorites, the airports opened last or the nearest fields, picked
/// from the filter menu at its heading's right; the heading itself the
/// list in full (the owner's, 2026-10-15).
struct AirportStrip: View {
    let nearest: [NearestAirport]
    let open: (String) -> Void
    private var shelf: AirportShelf { .shared }

    var body: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    switch shelf.shows {
                    case .favorites:
                        ForEach(shelf.favorites) { field in tile(field.ident, field.name) }
                    case .recents:
                        ForEach(shelf.recents) { field in tile(field.ident, field.name) }
                    case .nearest:
                        ForEach(nearest.prefix(12)) { field in tile(field.ident, String(format: "%.0f nm", field.distanceNm), category: field.flightCategory) }
                    }
                    if empty { Text(emptyWords).foregroundStyle(.secondary).padding(.vertical, 12) }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .listRowInsets(EdgeInsets())
        } header: {
            HStack {
                Button { open(AirportRoute.list(shelf.shows).text) } label: {
                    HStack(spacing: 4) {
                        Text(shelf.shows.title)
                        Image(systemName: "chevron.right").font(.caption.weight(.bold))
                    }
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                }
                .accessibilityLabel("\(shelf.shows.title), all")
                Spacer()
                Menu {
                    Picker("Shows", selection: Binding(get: { shelf.shows }, set: { shelf.show($0) })) {
                        ForEach(AirportShelf.Shows.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle").font(.title3)
                }
                .accessibilityLabel("What the strip shows")
            }
            .textCase(nil)
        }
    }

    private var empty: Bool {
        switch shelf.shows {
        case .favorites: shelf.favorites.isEmpty
        case .recents: shelf.recents.isEmpty
        case .nearest: nearest.isEmpty
        }
    }

    private var emptyWords: String {
        switch shelf.shows {
        case .favorites: "No Favorites"
        case .recents: "No Recents"
        case .nearest: "Waiting for the position"
        }
    }

    private func tile(_ ident: String, _ under: String, category: String? = nil) -> some View {
        Button { open(ident) } label: {
            VStack(spacing: 4) {
                Text(ident)
                    .font(.caption.weight(.bold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(width: 52, height: 52)
                    .background(Circle().fill(Color.accentColor.opacity(0.15)))
                    .overlay(Circle().strokeBorder(category.map { Color(uiColor: AirportAnnotation.colour($0)) } ?? .clear, lineWidth: 3))
                Text(under).font(.caption2).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.center)
            }
            .frame(width: 72)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(ident), \(under)")
    }
}

/// A strip's list in full: the Favorites to change and put in order, the
/// Recents to take off, the nearest fields.
struct AirportListView: View {
    let shows: AirportShelf.Shows
    let nearest: [NearestAirport]
    private var shelf: AirportShelf { .shared }

    var body: some View {
        List {
            switch shows {
            case .favorites:
                if shelf.favorites.isEmpty { Text("No Favorites").foregroundStyle(.secondary) }
                ForEach(shelf.favorites) { field in NavigationLink(value: field.ident) { keptRow(field) } }
                    .onDelete { shelf.removeFavorites(at: $0) }
                    .onMove { shelf.moveFavorites(from: $0, to: $1) }
            case .recents:
                if shelf.recents.isEmpty { Text("No Recents").foregroundStyle(.secondary) }
                ForEach(shelf.recents) { field in NavigationLink(value: field.ident) { keptRow(field) } }
                    .onDelete { shelf.removeRecents(at: $0) }
            case .nearest:
                if nearest.isEmpty { Text("Waiting for the position").foregroundStyle(.secondary) }
                ForEach(nearest) { field in NavigationLink(value: field.ident) { NearestRow(field: field) } }
            }
        }
        .navigationTitle(shows.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if shows == .favorites, !shelf.favorites.isEmpty { EditButton() }
            if shows == .recents, !shelf.recents.isEmpty { Button("Clear") { shelf.clearRecents() } }
        }
    }

    private func keptRow(_ field: KeptAirport) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(field.ident).font(.headline)
            Text([field.name, field.municipality].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

/// The fields nearest a town or an address typed in the search, nearest
/// first, as the planner measures them from it.
struct NearFromView: View {
    let lat: Double
    let lon: Double
    let label: String
    @State private var fields: [NearestAirport]?
    @State private var problem: String?

    var body: some View {
        List {
            if let fields {
                Section("Nearest \(label)") {
                    ForEach(fields) { field in NavigationLink(value: field.ident) { NearestRow(field: field) } }
                }
            } else if let problem {
                Text(problem).foregroundStyle(.red)
            } else {
                ProgressView("Fetching the nearest fields…")
            }
        }
        .navigationTitle("Nearest")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: label) {
            do { fields = try await Planner.nearest(lat: lat, lon: lon, limit: 25) } catch { problem = error.localizedDescription }
        }
    }
}

/// A field near the phone: its identifier and name, how far and which
/// way (true, as the planner gives it), and its longest runway, with its
/// flight category's colour.
struct NearestRow: View {
    let field: NearestAirport

    var body: some View {
        HStack(spacing: 12) {
            Circle().strokeBorder(Color(uiColor: AirportAnnotation.colour(field.flightCategory)), lineWidth: 2.5).frame(width: 12, height: 12)
            VStack(alignment: .leading, spacing: 2) {
                Text(field.ident).font(.headline)
                Text([field.name, field.longestRunwayFt.map { "\($0.formatted()) ft" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.0f nm", field.distanceNm)).font(.body.monospacedDigit())
                Text(String(format: "%03.0f°T", field.bearingDeg.truncatingRemainder(dividingBy: 360))).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
    }
}
