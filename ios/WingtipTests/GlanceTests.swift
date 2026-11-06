import Foundation
import Testing
@testable import Wingtip

/// The Go / No-Go at a glance (Glance): at most three one-sentence lines,
/// none past 140 characters, worst first, and the rest in one row; from
/// the planner's answer as GoNoGoTests shapes it.
struct GlanceTests {
    private func answer(_ json: String = GoNoGoTests.answer) throws -> GoNoGoAnswer {
        try Planner.snakeCase.decode(GoNoGoAnswer.self, from: Data(json.utf8))
    }

    @Test func atMostThreeLinesWorstFirstEachOneSentence() throws {
        let lines = Glance.lines(try answer())
        #expect(lines.count == 3)
        #expect(lines.map(\.key) == ["balance", "weather", "risk"])
        #expect(lines.map(\.finding) == ["stop", "caution", "caution"])
        for line in lines {
            #expect(line.words.count <= Glance.longest, "\(line.words)")
            #expect(line.words.hasSuffix("."), "\(line.words)")
            #expect(!line.words.dropLast().contains(Character(".")), "one sentence: \(line.words)")
        }
        #expect(lines[0].words == "Weight & balance: The baggage, 170 lb in all, is over its 120 lb.")
    }

    @Test func theRestIsOneRowTheClearOnesNamedAndTheOverflowCounted() throws {
        let a = try answer()
        let rest = Glance.rest(a)
        // The runways, not worked out, ran over the three lines; the clear
        // findings follow in the planner's order.
        #expect(rest.map(\.key) == ["runways", "airspace", "altitude", "fuel"])
        #expect(Glance.restWords(a) == "1 more to look at; TFRs & special use, altitude and fuel: nothing to fix")
    }

    @Test func nothingFoldedWhereTheLinesSaidEverything() throws {
        let json = #"{"line":{"finding":"pending","words":"Still checking: Risk"},"items":[{"key":"risk","label":"Risk","finding":"pending","detail":"Waiting on the briefing…","tab":"preflight","section":"Risk Assessment"}]}"#
        let a = try answer(json)
        #expect(Glance.lines(a).map(\.words) == ["Risk: Waiting on the briefing…"])
        #expect(Glance.rest(a).isEmpty && Glance.restWords(a) == nil)
    }

    @Test func aLongFindingIsCutAtAWordToTheLongestLine() {
        let detail = String(repeating: "cloud layers along the route ", count: 8)
        let item = VerdictItem(key: "weather", label: "Weather", finding: "caution", detail: detail, tab: "enroute")
        let words = Glance.sentence(item)
        #expect(words.count <= Glance.longest)
        #expect(words.hasSuffix("…") && !words.hasSuffix(" …"))
        #expect(words.hasPrefix("Weather: cloud layers"))
    }

    @Test func aClearFlightHasNoLinesAndOneRow() throws {
        let json = #"{"line":{"finding":"ok","words":"Go"},"items":[{"key":"weather","label":"Weather","finding":"ok","detail":"VFR","tab":"enroute"},{"key":"fuel","label":"Fuel","finding":"ok","detail":"Plenty","tab":"preflight"}]}"#
        let a = try answer(json)
        #expect(Glance.lines(a).isEmpty)
        #expect(Glance.restWords(a) == "Weather and fuel: nothing to fix")
    }
}
