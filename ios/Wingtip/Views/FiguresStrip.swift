import SwiftUI

/// The flight's figures in one line -- To, Dist, ETE, Fuel -- what the
/// web app's pill shows at the sheet's foot (FlightLine), and what the
/// pilot glances at in the air. Fuel red where it lands under the
/// reserve the planner holds it to (14 CFR 91.151, in the planner).
struct FiguresStrip: View {
    @Environment(Plan.self) private var plan

    var body: some View {
        HStack {
            figure("TO", plan.routed ? plan.dest : "—")
            figure("DIST", plan.totals?.distanceNm.map { String(format: "%.1f nm", $0) } ?? plan.course.map { String(format: "%.1f nm", $0.distanceNm) } ?? "—")
            figure("ETE", plan.totals?.eteMin.map(hoursMinutes) ?? "—")
            figure("FUEL", plan.totals?.fuelGal.map { String(format: "%.1f gal", $0) } ?? "—", warn: (plan.totals?.fuelMarginGal ?? 0) < 0)
        }
        .padding(.horizontal)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func figure(_ name: String, _ value: String, warn: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(name).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.headline.monospacedDigit()).foregroundStyle(warn ? Color.red : Color.primary)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
    }
}
