import SwiftUI

/// What is ahead on the track, over the map as the web app's AlertsBanner
/// has it: the planner's alerts in its words, the nearest first, red
/// where it says so and amber otherwise, with the minutes to it.
struct AlertsBanner: View {
    let alerts: [AheadAlert]

    var body: some View {
        if let first = alerts.sorted(by: { $0.seconds < $1.seconds }).first {
            HStack(spacing: 8) {
                // The octagon and the triangle tell the two levels apart
                // without their colours; VoiceOver says the level.
                let danger = first.level == "stop" || first.level == "danger"
                Image(systemName: danger ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
                    .accessibilityLabel(danger ? "Danger ahead" : "Caution ahead")
                VStack(alignment: .leading, spacing: 1) {
                    Text(first.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text("\(first.need) · \(Int((first.seconds / 60).rounded())) min, \(String(format: "%.1f", first.distanceNm)) nm").font(.footnote).lineLimit(1)
                        .accessibilityLabel("\(first.need), in \(SpokenFigures.minutes(first.seconds / 60)), \(SpokenFigures.nauticalMiles(first.distanceNm))")
                }
                Spacer(minLength: 0)
                if alerts.count > 1 {
                    Text("+\(alerts.count - 1)").font(.footnote.weight(.semibold))
                        .accessibilityLabel("and \(alerts.count - 1) more")
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .foregroundStyle(.white)
            .background(first.level == "stop" || first.level == "danger" ? Color.red : Color.orange, in: RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .accessibilityElement(children: .combine)
        }
    }
}
