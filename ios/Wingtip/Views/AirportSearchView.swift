import PlannerAPI
import SwiftUI

/// Airport: fields by ident or name as they are typed, each a tap from
/// the route (the departure where there is none, else the destination).
struct AirportSearchView: View {
    @Environment(Plan.self) private var plan
    @State private var query = ""
    @State private var found: [Components.Schemas.AirportSuggestion] = []
    @State private var searching: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    ContentUnavailableView("Find a field", systemImage: "magnifyingglass",
                                           description: Text("By its identifier or its name: KDLH, Duluth."))
                } else if found.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    ForEach(found, id: \.ident) { field in
                        Button {
                            if plan.dep.isEmpty { plan.dep = field.ident } else { plan.dest = field.ident; plan.plan() }
                        } label: {
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
