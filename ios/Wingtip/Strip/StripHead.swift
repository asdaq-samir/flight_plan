import SwiftUI

/// The strip's head: the verdict -- go, caution or no-go, in the planner's
/// words (Verdict, POST /api/go-no-go) -- on a paper card, the route's
/// line under it in condensed capitals ("C81 → KJVL → KDLH · C172 ·
/// FL-045 · leaving now"), the route's other ways as chips, and at most
/// three one-line findings from the glance (Glance.lines), each a row
/// into the Brief. The route's menu (Share, File, Clear) at the head's
/// corner, where the tabs' route box had it. No photo behind the
/// verdict: of the canvas's looks the owner kept the chart's ink and the
/// glass cockpit alone (2026-11-04).
struct StripHead: View {
    @Environment(Plan.self) private var plan
    @Environment(Verdict.self) private var verdict
    @Environment(\.chartInk) private var ink
    /// A finding's row, or the verdict, tapped: the Brief.
    let onBrief: () -> Void
    let onFile: () -> Void

    private var line: String {
        StripData.headLine(dep: plan.dep, dest: plan.dest, stops: plan.stops, airplane: plan.tail ?? plan.aircraft.uppercased(),
                           cruiseFt: plan.ownAltitudeFt ?? plan.altitudeFt, departAt: nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            card
            ways
            if let answer = verdict.answer {
                ForEach(Glance.lines(answer)) { glanceLine in
                    Button(action: onBrief) {
                        HStack(spacing: 10) {
                            Image(systemName: FindingStyle.symbol(glanceLine.finding))
                                .foregroundStyle(ink.finding(glanceLine.finding))
                                .accessibilityHidden(true)
                            Text(glanceLine.words)
                                .font(ChartInk.text.weight(.medium))
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "chevron.right").foregroundStyle(ink.tint).accessibilityHidden(true)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .inkCard()
                    .accessibilityLabel("\(FindingStyle.word(glanceLine.finding)): \(glanceLine.words)")
                    .accessibilityHint("Opens the Brief")
                }
            }
        }
        .accessibilityIdentifier("strip-head")
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Spacer(minLength: 0)
                menu
            }
            if let answer = verdict.answer {
                Button(action: onBrief) {
                    HStack(spacing: 10) {
                        Image(systemName: FindingStyle.symbol(answer.line.finding))
                            .font(.title2)
                            .foregroundStyle(ink.finding(answer.line.finding))
                            .accessibilityHidden(true)
                        Text(answer.line.words)
                            .font(ChartInk.heading)
                            .foregroundStyle(ink.finding(answer.line.finding))
                            .multilineTextAlignment(.leading)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(FindingStyle.word(answer.line.finding)): \(answer.line.words)")
                .accessibilityHint("Opens the Brief")
            } else if let problem = verdict.problem {
                ProblemLine(problem)
            } else {
                Text("Reading the brief…").font(ChartInk.heading).foregroundStyle(ink.muted)
            }
            Text(line)
                .condensedCaps()
                .foregroundStyle(ink.magenta)
                .lineLimit(1)
                .accessibilityLabel(line)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .bottomLeading)
        .inkCard()
    }

    /// The route's menu: Share (its own menu, the web's ShareMenu), File,
    /// Clear.
    private var menu: some View {
        Menu {
            ShareMenu()
            Button { onFile() } label: { Label("File flight plan", systemImage: "paperplane") }
            Divider()
            Button(role: .destructive) { plan.clear() } label: { Label("Clear route", systemImage: "xmark") }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.body.weight(.medium))
                .foregroundStyle(ink.tint)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle().inset(by: -6))
        }
        .accessibilityLabel("The route's menu")
    }

    /// The route's other ways (the planner's chips): each a chip, the one
    /// flown filled; a tap flies it (Plan.use).
    @ViewBuilder
    private var ways: some View {
        if let chips = plan.routes?.chips, chips.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(chips) { chip in
                        let picked = (plan.pickedChip?.key ?? "none") == chip.key
                        Button(chip.label) { plan.use(chip) }
                            .buttonStyle(InkChipStyle(filled: picked))
                            .accessibilityAddTraits(picked ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 2).padding(.vertical, 6)
            }
            .accessibilityLabel("The route's ways")
        }
    }
}
