import SwiftUI

/// The strip in the air: the ribbon with the airplane on it, the flown
/// part grey and the way ahead magenta; the next point large with the
/// leg's heading from the nav log and the miles to it; the flight's
/// figures counting down (FiguresStrip, the planner's own); and the
/// field as the radio under them (StripFieldRow with `flying`). Controls
/// are 60 points here, as the canvas asks in the air.
struct StripAir: View {
    let points: [StripPoint]
    let position: (leg: Int, along: Double)?
    /// The airplane's fix, the dry run's or own ship's.
    let fix: OwnShip.Fix?
    @Environment(\.chartInk) private var ink

    private var next: StripPoint? { StripData.nextPoint(points, position: position) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RibbonLine(points: points, position: position).padding(.horizontal, 4)
            if let next {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Next").condensedCaps(.caption).foregroundStyle(ink.muted)
                        Text(next.name)
                            .font(ChartInk.figure(28))
                            .foregroundStyle(next.field ? ink.field : ink.brown)
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let leg = next.leg {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("MH").condensedCaps(.caption).foregroundStyle(ink.muted)
                            Text(String(format: "%03d", Int(leg.magneticHeadingDeg.rounded()))).font(ChartInk.figure(28))
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Magnetic heading \(SpokenFigures.degrees(leg.magneticHeadingDeg))")
                    }
                    if let fix, let at = next.coordinate {
                        let nm = Flight.nm(from: fix.coordinate, to: at)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("To go").condensedCaps(.caption).foregroundStyle(ink.muted)
                            Text(Formats.number(nm, decimals: nm < 10 ? 1 : 0)).font(ChartInk.figure(28))
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(SpokenFigures.nauticalMiles(nm)) to go")
                    }
                }
                .padding(16)
                .inkCard()
            }
            FiguresStrip()
                .padding(.vertical, 8)
                .inkCard()
        }
        .accessibilityIdentifier("strip-air")
    }
}
