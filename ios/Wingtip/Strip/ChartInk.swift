import SwiftUI

/// The strip layout's palette and type roles, "chart ink": the owner's
/// pick of the redesign's looks (2026-11-04, "I like chart ink and glass
/// cockpit only"), the web app's `--ink-*` tokens (web/src/index.css) in
/// the phone's own idiom. Paper under white cards by day; the night
/// scheme's dark ground and cards with a cyan tint, the same scheme the
/// theme's own dark mode is. Applied through the environment
/// (`chartInkTheme()`), so every view of the strip reads one source and a
/// view in a test can be given either scheme.
///
/// The chart's own inks name what a thing is: magenta for the course and
/// the idents at the head, brown for a checkpoint, green for a field. One
/// tint for everything tappable; amber for a caution and green for go,
/// iOS's own system colours so they match the rest of the app
/// (FindingStyle). The fonts are the system's in the same roles the
/// web's Barlow and Barlow Condensed play, never a bundled font: SF Pro
/// for text, its condensed width with letterspaced capitals for the
/// figures' labels, idents and buttons.
struct ChartInk: Equatable, Sendable {
    /// The sheet's ground and a card's surface.
    let paper: Color
    let card: Color
    /// The course's magenta, a checkpoint's brown, a field's green.
    let magenta: Color
    let brown: Color
    let field: Color
    /// What is flown already, on the ribbon.
    let flown: Color
    /// Everything tappable.
    let tint: Color
    let caution: Color
    let go: Color
    /// Words, and the quieter words.
    let ink: Color
    let muted: Color
    let night: Bool

    /// A colour from its 0xRRGGBB, as NightPalette makes a UIColor.
    static func hex(_ value: UInt32) -> Color {
        Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }

    /// By day: paper #f7f2e7, white cards, the chart's magenta #b3338c,
    /// brown #8a5a2b, green #1d7a46; the tint #0a84ff; amber #ff9f0a and
    /// green #34c759 (the canvas's boards, 2026-11-04).
    static let light = ChartInk(
        paper: hex(0xF7F2E7), card: .white,
        magenta: hex(0xB3338C), brown: hex(0x8A5A2B), field: hex(0x1D7A46), flown: hex(0x8E8E93),
        tint: hex(0x0A84FF), caution: hex(0xFF9F0A), go: hex(0x34C759),
        ink: hex(0x1C1C1E), muted: hex(0x6E6E73), night: false
    )

    /// At night: ground #14161c, cards #1d2027, a cyan tint (the canvas's
    /// night board); the inks lifted as NightPalette lifts the course over
    /// a dimmed chart, so each keeps 4.5:1 on the dark card (WCAG 1.4.3).
    static let night = ChartInk(
        paper: hex(0x14161C), card: hex(0x1D2027),
        magenta: hex(0xF277E6), brown: hex(0xD39A62), field: hex(0x75D7A3), flown: hex(0x8E8E93),
        tint: hex(0x78D9FF), caution: hex(0xF5B85E), go: hex(0x75D7A3),
        ink: hex(0xF2F2F7), muted: hex(0xA1A1AA), night: true
    )

    /// The scheme for the appearance.
    static func scheme(dark: Bool) -> ChartInk { dark ? night : light }

    /// A finding's colour on the strip: go, caution, no-go; the rest muted.
    func finding(_ finding: String) -> Color {
        switch finding {
        case "ok": return go
        case "caution": return caution
        case "stop": return .red
        default: return muted
        }
    }

    // MARK: Type roles

    /// Text at 17, 15 and 13 points: the system's body, subheadline and
    /// footnote, which follow Dynamic Type.
    static let text = Font.body
    static let detail = Font.subheadline
    static let note = Font.footnote
    /// A figure, 26 to 40 points bold with tabular digits.
    static func figure(_ size: CGFloat = 26) -> Font {
        Font.system(size: size, weight: .bold, design: .default).monospacedDigit()
    }
    /// A section's title, as the app's 20-point titles are.
    static let heading = Font.title3.weight(.semibold)
}

private struct ChartInkKey: EnvironmentKey {
    static let defaultValue = ChartInk.light
}

extension EnvironmentValues {
    /// The strip's palette for the appearance the view is drawn in.
    var chartInk: ChartInk {
        get { self[ChartInkKey.self] }
        set { self[ChartInkKey.self] = newValue }
    }
}

/// The theme put in the environment for the appearance, and the tint set
/// for every control under it.
private struct ChartInkTheme: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let ink = ChartInk.scheme(dark: scheme == .dark)
        content
            .environment(\.chartInk, ink)
            .tint(ink.tint)
    }
}

/// The condensed letterspaced capitals of a label, an ident or a chip's
/// words: the web's Barlow Condensed role, in SF Pro's condensed width.
private struct CondensedCaps: ViewModifier {
    let size: Font.TextStyle
    let weight: Font.Weight

    func body(content: Content) -> some View {
        content
            .font(Font.system(size, design: .default).weight(weight))
            .fontWidth(.condensed)
            .textCase(.uppercase)
            .tracking(0.8)
    }
}

/// A card of the strip: 18-point corners, the card's colour on the
/// paper, a hair of shadow (the canvas's boards: "white cards with a
/// 4 px shadow, 18 px corners").
private struct InkCard: ViewModifier {
    @Environment(\.chartInk) private var ink

    func body(content: Content) -> some View {
        content
            .background(ink.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: Color.black.opacity(ink.night ? 0.3 : 0.08), radius: 4, x: 0, y: 1)
    }
}

extension View {
    func chartInkTheme() -> some View { modifier(ChartInkTheme()) }

    /// Condensed letterspaced capitals: a figure's label at the caption
    /// size, an ident or a chip's words at the footnote's.
    func condensedCaps(_ size: Font.TextStyle = .footnote, weight: Font.Weight = .semibold) -> some View {
        modifier(CondensedCaps(size: size, weight: weight))
    }

    func inkCard() -> some View { modifier(InkCard()) }
}

/// A chip: a 999-radius capsule, 32 points tall, its words the tint's in
/// condensed capitals, white (the card's colour) or filled with the tint
/// when it is the one picked. The 44-point hit area is round it, not in
/// it: the chip does not grow, and rows of chips sit at an 8-point gap
/// so the areas meet.
struct InkChipStyle: ButtonStyle {
    @Environment(\.chartInk) private var ink
    var filled = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .condensedCaps()
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(height: 32)
            .foregroundStyle(filled ? Color.white : ink.tint)
            .background(filled ? ink.tint : ink.card, in: Capsule())
            .overlay(Capsule().strokeBorder(ink.tint.opacity(filled ? 0 : 0.5), lineWidth: 1))
            .opacity(configuration.isPressed ? 0.6 : 1)
            .contentShape(Rectangle().inset(by: -6))
    }
}

extension ButtonStyle where Self == InkChipStyle {
    static var inkChip: InkChipStyle { InkChipStyle() }
    static var inkChipFilled: InkChipStyle { InkChipStyle(filled: true) }
}
