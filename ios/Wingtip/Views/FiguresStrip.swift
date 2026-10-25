import SwiftUI

/// The flight's figures in one line -- To, Dist, ETE, Fuel -- what the
/// web app's pill shows at the sheet's foot (FlightLine), and what the
/// pilot glances at in the air. Fuel red where it lands under the
/// reserve the planner holds it to (14 CFR 91.151, in the planner).
struct FiguresStrip: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(DryRun.self) private var dryRun

    /// In the air on the route -- moving, within 3 nm of the line -- the
    /// figures count down from where the airplane is, as the web app's do
    /// in a dry run (Flight): what is left to the destination at the
    /// groundspeed now, and the fuel still required.
    private var flying: (leftNm: Double, minutes: Double?, fuelGal: Double?)? {
        // A dry run's airplane counts as flying; else own ship, moving.
        guard let fix = dryRun.fix ?? ownShip.fix, let gs = fix.groundspeedKt, gs > 30, let course = plan.course,
              let along = Flight.along(fix.coordinate, line: course.coordinates),
              Flight.off(fix.coordinate, line: course.coordinates) <= 3 else { return nil }
        let required = plan.totals?.fuelRequiredGal.map { max(0, $0 - Flight.burnt(legs: plan.legs, alongNm: along.alongNm)) }
        return (along.leftNm, along.leftNm / gs * 60, required)
    }

    var body: some View {
        HStack {
            figure("TO", plan.routed ? plan.dest : "—")
            if let flying {
                figure("DIST", String(format: "%.1f nm", flying.leftNm))
                figure("ETE", flying.minutes.map(hoursMinutes) ?? "—")
                figure("FUEL", flying.fuelGal.map { String(format: "%.1f gal", $0) } ?? "—", warn: (plan.totals?.fuelMarginGal ?? 0) < 0)
            } else {
                figure("DIST", plan.totals?.distanceNm.map { String(format: "%.1f nm", $0) } ?? plan.course.map { String(format: "%.1f nm", $0.distanceNm) } ?? "—")
                figure("ETE", plan.totals?.eteMin.map(hoursMinutes) ?? "—")
                figure("FUEL", plan.totals?.fuelGal.map { String(format: "%.1f gal", $0) } ?? "—", warn: (plan.totals?.fuelMarginGal ?? 0) < 0)
            }
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
