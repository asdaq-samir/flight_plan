import SwiftUI

/// The route line's chips as the planner sends them (RouteOptions.chips,
/// the canvas "Redesign: route options", 2026-10-26): its words and its
/// order, "None" first, so the web app and the phone offer the same.
enum RouteLine {
    /// "None", for the route as typed before the planner answers or where
    /// it sends no chips.
    static let none = RouteChip(key: "none", label: "None")

    static func chips(_ routes: RouteOptions?) -> [RouteChip] {
        let sent = routes?.chips ?? []
        return sent.isEmpty ? [none] : sent
    }

    /// The chip standing for the way flown: "None" for the typed route,
    /// else the picked chip, as the latest answer words it where it still
    /// offers it.
    static func picked(_ chips: [RouteChip], chip: RouteChip?) -> RouteChip {
        guard let chip else { return chips.first { $0.key == "none" } ?? none }
        return chips.first { $0.key == chip.key && $0.stops == chip.stops } ?? chip
    }

    /// Whether the line is drawn: not where the planner has answered that
    /// there is no way but the route itself, unless a way is flown.
    static func shows(_ routes: RouteOptions?, picked: RouteChip?, problem: String?) -> Bool {
        guard let routes, problem == nil, picked == nil else { return true }
        return !(routes.chips ?? []).isEmpty
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
        let chips = RouteLine.chips(plan.routes)
        let picked = RouteLine.picked(chips, chip: plan.pickedChip)
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
            // for "None", the typed route's.
            if let routes = plan.routes {
                ForEach(Array((picked.crosses ?? []).enumerated()), id: \.offset) { _, index in
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
        if chip.key == "none" {
            plan.useTyped()
        } else if plan.pickedChip != chip {
            plan.use(chip)
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
