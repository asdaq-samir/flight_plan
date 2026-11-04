import SwiftUI

/// The Ask pill inside the field at its right end (the owner's pick of
/// 2026-11-04 after Target's "Ask Target" pill): a sparkle and the word
/// "Ask" in the tint, a 32-point capsule with a hairline outline -- one
/// tint, no gradient, the app's rule -- filled while the field is in ask
/// mode, where whatever is typed or said goes to the assistant and is
/// never read as a route. The 44-point hit area is round it, not in it:
/// the pill does not grow.
struct AskPill: View {
    /// Ask mode on: the pill filled, the field the assistant's.
    var on = false
    let action: () -> Void
    @Environment(\.chartInk) private var ink

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "sparkle")
                    .font(.caption.weight(.semibold))
                    .accessibilityHidden(true)
                Text("Ask")
                    .condensedCaps(.footnote, weight: .semibold)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .foregroundStyle(on ? Color.white : ink.tint)
            .background(on ? ink.tint : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(ink.tint.opacity(on ? 0 : 0.6), lineWidth: 1))
            .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(on ? "Asking the assistant" : "Ask the assistant")
        .accessibilityHint(on ? "Tap to go back to planning in the field" : "What you type or say goes to the assistant")
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("ask-pill")
    }
}

#Preview("AskPill") {
    HStack(spacing: 16) {
        AskPill(action: {})
        AskPill(on: true, action: {})
    }
    .padding()
    .chartInkTheme()
}
