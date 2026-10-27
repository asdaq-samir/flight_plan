import Testing
import UIKit
@testable import Wingtip

/// The night palette (NightPalette.swift), the same as the web app's dark
/// theme: each colour by day and at night, the chart's dimming by the
/// setting, and the contrast of a mark's words on their halo (WCAG 1.4.3's
/// 4.5:1, as the web app's contrast.test.ts holds its tokens to).
struct NightPaletteTests {
    private let day = UITraitCollection(userInterfaceStyle: .light)
    private let night = UITraitCollection(userInterfaceStyle: .dark)

    private func hex(_ colour: UIColor, _ traits: UITraitCollection) -> UInt32 {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        colour.resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a)
        return UInt32((r * 255).rounded()) << 16 | UInt32((g * 255).rounded()) << 8 | UInt32((b * 255).rounded())
    }

    private func alpha(_ colour: UIColor, _ traits: UITraitCollection) -> CGFloat {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        colour.resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a)
        return a
    }

    @Test func thePaletteIsTheOwnersCockpitColours() {
        #expect(hex(NightPalette.ground, day) == 0x0B1422)
        #expect(hex(NightPalette.surface, day) == 0x17283A)
        #expect(hex(NightPalette.route, day) == 0xF277E6)
        #expect(hex(NightPalette.active, day) == 0x78D9FF)
        #expect(hex(NightPalette.caution, day) == 0xF5B85E)
        #expect(hex(NightPalette.positive, day) == 0x75D7A3)
    }

    @Test func theCourseIsThePrintedMagentaByDayAndTheNightsOverADimmedChart() {
        #expect(hex(NightPalette.course(night: false), day) == 0xE600E6)
        #expect(hex(NightPalette.course(night: true), day) == 0xF277E6)
        #expect(hex(NightPalette.casing(night: false), day) == 0xFFFFFF)
        #expect(hex(NightPalette.casing(night: true), day) == 0x0B1422)
    }

    @Test func theHaloAndTheMarksFillFollowTheAppearance() {
        #expect(hex(NightPalette.halo, day) == 0xFFFFFF)
        #expect(hex(NightPalette.halo, night) == 0x0B1422)
        #expect(hex(NightPalette.markFill, night) == 0x17283A)
        #expect(alpha(NightPalette.halo, night) > 0.85)
        #expect(hex(NightPalette.trafficFar, night) == 0x78D9FF)
        #expect(hex(NightPalette.trafficNear, night) == 0xF5B85E)
    }

    @Test func theChartIsDimmedOnlyAtNightAndOnlyWhenTheSettingSaysSo() {
        #expect(ChartNight.dimmed.shade(dark: true) == 0.5)
        #expect(ChartNight.dimmed.shade(dark: false) == 0)
        #expect(ChartNight.normal.shade(dark: true) == 0)
        #expect(ChartNight.normal.shade(dark: false) == 0)
        #expect(ChartNight(rawValue: "dimmed") == .dimmed)
        #expect(ChartNight.allCases.map(\.label) == ["Normal", "Dimmed"])
    }

    @Test func contrastIsWCAGsRatio() {
        #expect(abs(NightPalette.contrast(.black, .white) - 21) < 0.001)
        #expect(abs(NightPalette.contrast(UIColor(hex: 0x767676), .white) - 4.54) < 0.01)
    }

    @Test func aMarksWordsReadOnTheirHaloInBothAppearances() {
        for traits in [day, night] {
            let words = UIColor.label.resolvedColor(with: traits)
            let halo = UIColor(hex: hex(NightPalette.halo, traits))
            #expect(NightPalette.contrast(words, halo) >= 4.5)
        }
        // The night's words on its surfaces, as the web app's tokens.
        #expect(NightPalette.contrast(UIColor(hex: 0xEEF3F9), NightPalette.surface) >= 4.5)
        // The course and the traffic stand off the night's ground (WCAG
        // 1.4.11's 3:1 for what is not words).
        #expect(NightPalette.contrast(NightPalette.route, NightPalette.ground) >= 3)
        #expect(NightPalette.contrast(NightPalette.active, NightPalette.ground) >= 3)
    }
}
