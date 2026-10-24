import SwiftUI

/// Airport: fields by ident or name as they are typed, each a tap from
/// the route (the departure where there is none, else the destination).
struct AirportSearchView: View {
    @Environment(Plan.self) private var plan
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
                    ContentUnavailableView("Find a field", systemImage: "magnifyingglass",
                                           description: Text("By its identifier or its name: KDLH, Duluth."))
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
