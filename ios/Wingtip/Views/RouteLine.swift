import SwiftUI

/// One of the route line's chips: "None" for the route as the pilot typed
/// it, or one of the planner's ways, named by its kind and the stops it
/// flies by ("Fastest · KTBN").
struct RouteChip: Identifiable, Equatable {
    let id: String
    let label: String
    /// The way the chip flies; nil for "None".
    let way: RouteOption?
}

/// The chips the route line offers, in the owner's order (the canvas
/// "Redesign: route options", 2026-10-26): "None" first, then the
/// planner's ways as /api/route-options sends them, named by the
/// planner's own titles. "Your Route" is the pilot's route with the
/// planner's fuel stops put in; where it adds nothing to the typed route
/// it is the same as "None" and is left out.
enum RouteLine {
    static let none = RouteChip(id: "none", label: "None", way: nil)

    /// The planner's own words for the chip where it sends them, else its
    /// title and the stops the way adds.
    static func label(_ way: RouteOption) -> String {
        if let label = way.label, !label.isEmpty { return label }
        return way.stops.isEmpty ? way.title : way.title + " · " + way.stops.joined(separator: " ")
    }

    static func chips(_ routes: RouteOptions?, typed: [String]) -> [RouteChip] {
        guard let routes else { return [none] }
        let typed = typed.map { $0.uppercased() }
        var ways: [RouteOption] = []
        if let own = routes.own, own.stops.map({ $0.uppercased() }) != typed { ways.append(own) }
        ways += routes.options
        // Each way once: the planner gives a way that is the best of
        // several kinds once already, and a repeat would be a second chip
        // flying the same thing.
        var seen = Set<String>()
        let chips = ways.filter { seen.insert($0.id).inserted }.map { RouteChip(id: $0.id, label: label($0), way: $0) }
        return [none] + chips
    }

    /// The chip standing for the way flown: "None" for the typed route,
    /// else the picked way's own chip, kept even when a later answer no
    /// longer offers it.
    static func picked(_ chips: [RouteChip], way: RouteOption?) -> RouteChip {
        guard let way else { return none }
        return chips.first { $0.way == way } ?? RouteChip(id: way.id, label: label(way), way: way)
    }
}

/// The route line under the route's ends, folding as the runway line
/// does on the web app (ProceduresRoute, RUNWAY_LINE_FOLD_MS): folded, the
/// route symbol and the way flown; tapped, every way in a sliding row of
/// chips, folding back to the one picked after two seconds untouched. A
/// chip tapped is flown at once, the course, the stops and the nav log
/// following; there is nothing to accept, and "None" goes back to the
/// route as typed. Nothing is refused: what the way flown still crosses
/// is said under it, in the planner's words.
struct RouteLineRow: View {
    @Environment(Plan.self) private var plan
    @State private var open = false
    @State private var folding: Task<Void, Never>?

    /// The owner's two seconds for the runway line ("Runways can
    /// collapse in 2 seconds"), the same for the route's.
    static let foldAfter: Duration = .seconds(2)

    var body: some View {
        let chips = RouteLine.chips(plan.routes, typed: plan.typedStops)
        let picked = RouteLine.picked(chips, way: plan.pickedWay)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                    .foregroundStyle(Color.accentColor)
                    .accessibilityLabel("Route options")
                if open {
                    ScrollViewReader { reader in
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(chips) { chip in
                                    RouteChipButton(label: chip.label, picked: chip.id == picked.id) { take(chip) }
                                        .id(chip.id)
                                }
                            }
                        }
                        // A slide holds the row open; let go, the two
                        // seconds start again.
                        .onScrollPhaseChange { _, phase in
                            if phase == .idle { foldLater() } else { folding?.cancel() }
                        }
                        .onAppear { reader.scrollTo(picked.id, anchor: .center) }
                    }
                } else {
                    RouteChipButton(label: picked.label, picked: true) {
                        open = true
                        foldLater()
                    }
                    .accessibilityHint("Shows the ways to fly the route")
                    if plan.routes == nil && plan.routesProblem == nil {
                        ProgressView().controlSize(.small)
                    }
                    Spacer(minLength: 0)
                }
            }
            if let problem = plan.routesProblem {
                Label(problem, systemImage: "exclamationmark.triangle")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            // What the way flown still crosses, as the planner names it:
            // for "None", the pilot's own route's.
            if let routes = plan.routes, let way = picked.way ?? routes.own {
                ForEach(Array(way.crosses.enumerated()), id: \.offset) { _, index in
                    if routes.hazards.indices.contains(index), routes.hazards[index].kind != "fuel" {
                        let hazard = routes.hazards[index]
                        Label(hazard.title ?? hazard.name ?? hazard.kind ?? "Hazard", systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote).foregroundStyle(.orange)
                    }
                }
            }
        }
        .animation(.easeOut(duration: 0.25), value: open)
        .onDisappear { folding?.cancel(); open = false }
    }

    private func take(_ chip: RouteChip) {
        if let way = chip.way {
            if plan.pickedWay != way { plan.use(way) }
        } else {
            plan.useTyped()
        }
        foldLater()
    }

    private func foldLater() {
        folding?.cancel()
        folding = Task {
            try? await Task.sleep(for: Self.foldAfter)
            if !Task.isCancelled { open = false }
        }
    }
}

/// A route line chip in the prototype's look: a capsule, the one flown
/// tinted, the rest plain.
private struct RouteChipButton: View {
    let label: String
    let picked: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 12)
                .frame(height: 32)
                .foregroundStyle(picked ? Color.accentColor : Color.primary)
                .background(Capsule().fill(picked ? Color.accentColor.opacity(0.14) : Color(uiColor: .secondarySystemBackground)))
                .overlay(Capsule().strokeBorder(picked ? Color.accentColor.opacity(0.3) : Color(uiColor: .separator), lineWidth: 1))
                // The 44-point hit area round the 32-point chip, as the
                // app's rows have it; the chip itself does not grow.
                .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(picked ? .isSelected : [])
    }
}
