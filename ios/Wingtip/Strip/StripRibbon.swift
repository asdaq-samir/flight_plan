import SwiftUI

/// The route's points on one line, in order: the fields' dots green, the
/// checkpoints' brown, the course's magenta line between them, each leg
/// the same width whatever its miles (a schematic, as a transit map's).
/// In the air (`position`: the leg flown, 0 the first, and how far along
/// it, 0 to 1) the airplane rides the line, what is flown grey behind it.
struct RibbonLine: View {
    let points: [StripPoint]
    var position: (leg: Int, along: Double)?
    @Environment(\.chartInk) private var ink

    /// Where along the line the airplane is, in legs; nil on the ground.
    private var at: Double? {
        guard let position else { return nil }
        let legs = Double(max(1, points.count - 1))
        return min(legs, max(0, Double(position.leg) + min(1, max(0, position.along))))
    }

    var body: some View {
        if points.count >= 2 {
            let legs = points.count - 1
            let at = at
            HStack(spacing: 0) {
                ForEach(Array(points.enumerated()), id: \.element.key) { i, p in
                    Circle()
                        .fill(at != nil && Double(i) < at! ? ink.flown : p.field ? ink.field : ink.brown)
                        .frame(width: p.field ? 10 : 8, height: p.field ? 10 : 8)
                    if i < legs {
                        legLine(i, at: at)
                            .frame(height: 4)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .overlay {
                if let at {
                    GeometryReader { geo in
                        Image(systemName: "airplane")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(ink.magenta)
                            .rotationEffect(.degrees(-45))
                            .position(x: geo.size.width * CGFloat(at / Double(legs)), y: geo.size.height / 2)
                            .accessibilityLabel("The airplane, on leg \(Int(at) + 1) of \(legs)")
                    }
                }
            }
            .frame(height: 16)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("The route: \(points.map(\.name).joined(separator: ", "))")
        }
    }

    /// A leg's colour on the line: flown (at past its end) grey, ahead the
    /// course's magenta, the one under the airplane grey as far as it has come.
    @ViewBuilder
    private func legLine(_ leg: Int, at: Double?) -> some View {
        if let at, at > Double(leg) {
            if at >= Double(leg + 1) {
                Rectangle().fill(ink.flown)
            } else {
                GeometryReader { geo in
                    HStack(spacing: 0) {
                        Rectangle().fill(ink.flown).frame(width: geo.size.width * CGFloat(at - Double(leg)))
                        Rectangle().fill(ink.magenta)
                    }
                }
            }
        } else {
            Rectangle().fill(ink.magenta)
        }
    }
}

/// The strip's ribbon: the first row of the sheet's half and full sizes
/// (the owner's change of 2026-11-04 after Apple Maps: the pill is the
/// field's row alone, so the ribbon moves here) -- the verdict's tag, the
/// route's ends, its time and fuel at the right, and under them the
/// route's points on one line (RibbonLine). With no route, the app's name
/// and a word on what the field takes.
struct StripRibbonRow: View {
    let dep: String
    let dest: String
    /// The planner's verdict line: its finding and words (VerdictLine).
    var verdict: VerdictLine?
    var eteMin: Double?
    var fuelGal: Double?
    let points: [StripPoint]
    var position: (leg: Int, along: Double)?
    @Environment(\.chartInk) private var ink

    private var route: String {
        if !dest.isEmpty { return "\(dep.isEmpty ? "Here" : dep) → \(dest)" }
        return dep.isEmpty ? "Wingtip" : dep
    }

    var body: some View {
        let figures = StripData.figures(eteMin: eteMin, fuelGal: fuelGal)
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                if let verdict, let tag = StripData.tag(verdict.finding) {
                    Text(tag)
                        .condensedCaps(.caption, weight: .bold)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .foregroundStyle(ink.finding(verdict.finding))
                        .background(ink.finding(verdict.finding).opacity(0.14), in: Capsule())
                        .accessibilityLabel("Verdict: \(verdict.words)")
                }
                Text(route)
                    .font(ChartInk.text.weight(.semibold))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !figures.isEmpty {
                    Text(figures).font(ChartInk.detail.monospacedDigit()).foregroundStyle(ink.muted)
                } else if dest.isEmpty {
                    Text("Where to, or ask").font(ChartInk.note).foregroundStyle(ink.muted)
                }
            }
            RibbonLine(points: points, position: position)
        }
        .padding(.horizontal, 4)
        .accessibilityIdentifier("strip-ribbon")
    }
}
