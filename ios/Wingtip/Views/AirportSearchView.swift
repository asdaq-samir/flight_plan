import SwiftUI

/// Airport: fields by ident or name as they are typed, each a tap from
/// the route (the departure where there is none, else the destination).
struct AirportSearchView: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @State private var nearest: [NearestAirport] = []
    /// The cards open over the search, newest last: a field tapped on the
    /// chart opens its card here.
    @Binding var path: [String]
    @State private var query = ""
    @State private var found: [AirportSuggestion] = []
    @State private var searching: Task<Void, Never>?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if query.isEmpty {
                    if nearest.isEmpty {
                        ContentUnavailableView("Find a field", systemImage: "magnifyingglass",
                                               description: Text("By its identifier or its name: KDLH, Duluth."))
                    } else {
                        Section("Nearest") {
                            ForEach(nearest) { field in
                                NavigationLink(value: field.ident) { NearestRow(field: field) }
                            }
                        }
                    }
                } else if found.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
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
            .navigationTitle("Airport")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { ident in AirportCard(ident: ident) }
            .searchable(text: $query, prompt: "Identifier or name")
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            // The nearest fields from where the phone is, asked again once
            // it has moved a mile.
            .task(id: ownShip.fix.map { "\(($0.coordinate.latitude * 60).rounded()),\(($0.coordinate.longitude * 60).rounded())" }) {
                guard let at = ownShip.fix?.coordinate else { return }
                if let fields = try? await Planner.nearest(lat: at.latitude, lon: at.longitude) { nearest = fields }
            }
            .onChange(of: query) { _, q in
                searching?.cancel()
                let q = q.trimmingCharacters(in: .whitespaces)
                guard q.count >= 2 else { found = []; return }
                searching = Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled, let fields = try? await Planner.search(q), !Task.isCancelled else { return }
                    found = fields
                }
            }
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
