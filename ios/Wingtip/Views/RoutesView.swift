import SwiftUI

/// Routes: the ways to fly the route as Maps offers its routes, the
/// planner's cards. The pilot's own route stays whatever it is, with what
/// it crosses said; the others are only ways round, each a tap to use.
/// Nothing is refused, at the owner's rule: a way through a hazard is
/// offered with its label.
struct RoutesView: View {
    @Environment(Plan.self) private var plan
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            if let routes = plan.routes {
                if !routes.unchecked.isEmpty {
                    Section {
                        Text("Not checked: " + routes.unchecked.joined(separator: ", ")).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let own = routes.own {
                    Section("Your route") { card(own, hazards: routes.hazards, isOwn: true) }
                }
                Section(routes.options.isEmpty ? "No other way found" : "Other ways") {
                    ForEach(routes.options) { way in card(way, hazards: routes.hazards, isOwn: false) }
                }
            } else if let problem = plan.routesProblem {
                ContentUnavailableView("No routes", systemImage: "exclamationmark.triangle", description: Text(problem))
            } else {
                ProgressView("Finding the ways…")
            }
        }
        .navigationTitle("Routes")
        .navigationBarTitleDisplayMode(.inline)
        .task { if plan.routes == nil { await plan.findRoutes() } }
        .onDisappear { plan.shownWay = nil }
    }

    private func card(_ way: RouteOption, hazards: [RouteHazard], isOwn: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(way.title).font(.headline)
                Spacer()
                if plan.shownWay == way { Image(systemName: "eye").foregroundStyle(.tint) }
            }
            HStack(spacing: 12) {
                Text(String(format: "%.0f nm", way.distanceNm))
                Text(hoursMinutes(way.airMin + way.groundMin))
                Text(String(format: "%.0f gal", way.fuelGal))
                if way.landings > 0 { Text("\(way.landings) \(way.landings == 1 ? "stop" : "stops")") }
                if let tail = way.tailKt, abs(tail) >= 1 { Text(String(format: "%@%.0f kt", tail > 0 ? "+" : "", tail)) }
            }
            .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            if !way.stops.isEmpty { Text("via " + way.stops.joined(separator: " ")).font(.footnote.monospaced()) }
            // What this way still crosses, in the planner's words, and
            // what it passes near.
            let crossed = way.crosses.compactMap { hazards.indices.contains($0) ? hazards[$0] : nil }
            let near = way.marginal.compactMap { hazards.indices.contains($0) ? hazards[$0] : nil }
            ForEach(Array(crossed.enumerated()), id: \.offset) { _, h in
                Label(h.title ?? h.name ?? h.kind ?? "hazard", systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.red)
            }
            ForEach(Array(near.enumerated()), id: \.offset) { _, h in
                Label("near " + (h.title ?? h.name ?? h.kind ?? "hazard"), systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
            }
            HStack {
                Button(plan.shownWay == way ? "Hide" : "Show on Map") { plan.shownWay = plan.shownWay == way ? nil : way }
                    .buttonStyle(.bordered)
                if !isOwn {
                    Button("Use") { plan.use(way); dismiss() }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
