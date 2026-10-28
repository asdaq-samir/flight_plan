import Foundation
import Testing
@testable import Wingtip

/// The rules the app keeps its own copy of, for flight with no signal
/// (docs/NATIVE.md), each checked against the web's shared fixture of
/// examples (web/src/lib/fixtures, bundled into this target by
/// project.yml, not copied): the web's vitest tests read the same files,
/// so a copy that drifts from the other fails CI.
private final class FixtureBundle {}

private struct FixtureMissing: Error { let name: String }

private func fixture<T: Decodable>(_ name: String, as type: T.Type, decoder: JSONDecoder = JSONDecoder()) throws -> T {
    guard let url = Bundle(for: FixtureBundle.self).url(forResource: name, withExtension: "json") else { throw FixtureMissing(name: name) }
    return try decoder.decode(T.self, from: Data(contentsOf: url))
}

/// Doubles as close as their arithmetic allows: the fixtures are written
/// by JavaScript's numbers, the copies work in Swift's.
private func roughly(_ a: Double?, _ b: Double?, within: Double = 1e-9) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case let (a?, b?): return abs(a - b) <= within
    default: return false
    }
}

private struct HoldsFixture: Decodable {
    struct Flat: Decodable, Equatable {
        let fix: String
        let inbound: Int
        let right: Bool
        let legMin: Double?
        let legNm: Double?
        let turns: Int?
        let minutes: Int?
    }
    struct Parse: Decodable { let text: String; let hold: Flat?; let written: String?; let words: String? }
    struct Leg: Decodable { let altitudeFt: Double; let minutes: Double }
    let parse: [Parse]
    let legMinutes: [Leg]
}

private struct ChecklistFixture: Decodable {
    struct Case: Decodable { let text: String; let checklist: Checklist; let written: String }
    let cases: [Case]
}

private struct DrillsFixture: Decodable {
    struct CardF: Decodable { let id, prompt, answer: String; let detail: String?; let colours: [String]; let flashing: Bool }
    struct DeckF: Decodable { let key, title, source, url: String; let cards: [CardF] }
    struct StandingF: Decodable { let box: Int; let due: Double }
    struct Answer: Decodable { let progress: [String: StandingF]; let card: String; let knew: Bool; let now: Double; let result: [String: StandingF] }
    struct Due: Decodable { let deck: String; let progress: [String: StandingF]; let now: Double; let ids: [String]; let next: Double? }
    let intervalDays: [Int]
    let decks: [DeckF]
    let answered: [Answer]
    let due: [Due]
}

private struct LostCommsFixture: Decodable {
    struct Route: Decodable { let key, label, rule: String }
    struct Leave: Decodable { let approachFix: Bool; let efc, eta, words: String }
    let routes: [Route]
    let leaveLimit: [Leave]
}

private struct FilingFormFixture: Decodable {
    struct Speed: Decodable { let tasKt: Double; let item: String }
    struct Level: Decodable { let altitudeFt: Double; let item: String }
    struct Time: Decodable { let minutes: Int; let item: String }
    struct Route: Decodable { let stops: [String]; let airways: [String]; let item: String }
    let cruisingSpeed: [Speed]
    let cruisingLevel: [Level]
    let hhmm: [Time]
    let route: [Route]
}

private struct TrafficFixture: Decodable {
    struct Case: Decodable { let plane: TrafficAircraft; let ownFt: Double?; let label: String; let near: Bool }
    let cases: [Case]
}

private struct LogbookFixture: Decodable {
    struct Export: Decodable { let entries: [LogbookEntry]; let csv: String }
    struct Skip: Decodable { let line: Int; let reason: String }
    struct Import: Decodable { let name: String; let text: String; let entries: [LogbookEntryRequest]; let skipped: [Skip] }
    let exports: [Export]
    let imports: [Import]
    enum CodingKeys: String, CodingKey { case exports = "export", imports = "import" }
}

@MainActor
struct SharedFixturesTests {
    @Test func aHoldIsReadAndWrittenAsTheWebAndThePlannerDo() throws {
        let f = try fixture("holds", as: HoldsFixture.self)
        #expect(f.parse.count >= 5)
        for c in f.parse {
            let hold = Hold.parse(c.text)
            let flat = hold.map { HoldsFixture.Flat(fix: $0.fix, inbound: $0.inbound, right: $0.right, legMin: $0.legMin, legNm: $0.legNm, turns: $0.turns, minutes: $0.minutes) }
            #expect(flat == c.hold, "\(c.text)")
            #expect(hold?.text == c.written, "\(c.text)")
            #expect(hold?.words == c.words, "\(c.text)")
        }
        for c in f.legMinutes {
            #expect(roughly(Hold.legMinutes(altitudeFt: c.altitudeFt), c.minutes), "\(c.altitudeFt) ft")
        }
    }

    @Test func aChecklistIsReadAndWrittenAsTheWebDoes() throws {
        let f = try fixture("checklist", as: ChecklistFixture.self)
        #expect(!f.cases.isEmpty)
        for (i, c) in f.cases.enumerated() {
            let read = ChecklistText.parse(c.text)
            #expect(read == c.checklist, "case \(i)")
            #expect(ChecklistText.text(of: read) == c.written, "case \(i)")
        }
    }

    @Test func theDrillsCardsAreTheWebsCardByCard() throws {
        let f = try fixture("drills", as: DrillsFixture.self)
        #expect(Drills.intervalDays == f.intervalDays)
        let decks = [Drills.lightGun, Drills.vfrMinimums]
        #expect(decks.map(\.key) == f.decks.map(\.key))
        for (deck, want) in zip(decks, f.decks) {
            #expect(deck.title == want.title && deck.source == want.source && deck.url.absoluteString == want.url, "\(deck.key)")
            #expect(deck.cards.count == want.cards.count, "\(deck.key)")
            for (card, w) in zip(deck.cards, want.cards) {
                #expect(card.id == w.id && card.prompt == w.prompt && card.answer == w.answer && card.detail == w.detail, "\(card.id)")
                #expect(card.colours.map(\.rawValue) == w.colours && card.flashing == w.flashing, "\(card.id)")
            }
        }
    }

    @Test func theDrillsBoxesMoveAsTheWebsDo() throws {
        let f = try fixture("drills", as: DrillsFixture.self)
        func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
        func ms(_ d: Date) -> Double { d.timeIntervalSince1970 * 1000 }
        func progress(_ p: [String: DrillsFixture.StandingF]) -> Drills.Progress { p.mapValues { Drills.Standing(box: $0.box, due: date($0.due)) } }
        for c in f.answered {
            let got = Drills.answered(progress(c.progress), card: c.card, knew: c.knew, now: date(c.now))
            #expect(Set(got.keys) == Set(c.result.keys), "\(c.card)")
            for (id, want) in c.result {
                #expect(got[id]?.box == want.box && roughly(got[id].map { ms($0.due) }, want.due, within: 1), "\(c.card): \(id)")
            }
        }
        for c in f.due {
            let deck = c.deck == Drills.lightGun.key ? Drills.lightGun : Drills.vfrMinimums
            #expect(Drills.due(deck, progress(c.progress), now: date(c.now)).map(\.id) == c.ids, "\(c.deck)")
            #expect(roughly(Drills.nextDue(deck, progress(c.progress), now: date(c.now)).map(ms), c.next, within: 1), "\(c.deck)")
        }
    }

    @Test func lostCommsSays91_185AsTheWebDoes() throws {
        let f = try fixture("lostComms", as: LostCommsFixture.self)
        #expect(LostComms.routes.map { [$0.key, $0.label, $0.rule] } == f.routes.map { [$0.key, $0.label, $0.rule] })
        for c in f.leaveLimit {
            #expect(LostComms.leaveLimit(approachFix: c.approachFix, efc: c.efc, eta: c.eta) == c.words, "\(c.approachFix) '\(c.efc)' '\(c.eta)'")
        }
    }

    @Test func theFilingFormsItemsAreWrittenAsTheWebWritesThem() throws {
        let f = try fixture("filingForm", as: FilingFormFixture.self)
        for c in f.cruisingSpeed { #expect(FilingForm.cruisingSpeed(c.tasKt) == c.item, "\(c.tasKt) kt") }
        for c in f.cruisingLevel { #expect(FilingForm.cruisingLevel(c.altitudeFt) == c.item, "\(c.altitudeFt) ft") }
        for c in f.hhmm { #expect(FilingForm.hhmm(c.minutes) == c.item, "\(c.minutes) min") }
        for c in f.route { #expect(FilingForm.route(c.stops, isAirway: { c.airways.contains($0) }) == c.item, "\(c.stops)") }
    }

    @Test func trafficIsLabelledAsTheWebLabelsIt() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let f = try fixture("traffic", as: TrafficFixture.self, decoder: decoder)
        #expect(!f.cases.isEmpty)
        for c in f.cases {
            let said = "\(c.plane.altitudeFt.map { "\($0)" } ?? "none") ft against \(c.ownFt.map { "\($0)" } ?? "none")"
            #expect(Traffic.label(c.plane, ownFt: c.ownFt) == c.label, "\(said)")
            #expect(Traffic.near(c.plane, ownFt: c.ownFt) == c.near, "\(said)")
        }
    }

    @Test func theLogbookIsWrittenAndReadAsTheWebDoes() throws {
        let f = try fixture("logbookCsv", as: LogbookFixture.self)
        for c in f.exports { #expect(LogbookCSV.csv(c.entries) == c.csv) }
        // Field by field, each a Bool, so the type checker has no long
        // chain to solve.
        func same(_ a: LogbookEntryRequest, _ b: LogbookEntryRequest) -> Bool {
            let fields: [Bool] = [
                a.flownOn == b.flownOn, a.aircraft == b.aircraft, a.aircraftType == b.aircraftType, a.route == b.route, a.remarks == b.remarks,
                roughly(a.totalHours, b.totalHours), roughly(a.nightHours, b.nightHours), roughly(a.crossCountryHours, b.crossCountryHours),
                roughly(a.dualHours, b.dualHours), roughly(a.soloHours, b.soloHours), roughly(a.instrumentHours, b.instrumentHours),
                a.dayLandings == b.dayLandings, a.nightLandings == b.nightLandings, a.toweredLandings == b.toweredLandings,
                roughly(a.distanceNm, b.distanceNm), roughly(a.longestLegNm, b.longestLegNm), a.approaches == b.approaches,
                a.holding == b.holding, a.tracking == b.tracking,
            ]
            return !fields.contains(false)
        }
        for c in f.imports {
            let read = LogbookCSV.read(c.text)
            #expect(read.entries.count == c.entries.count, "\(c.name)")
            for (got, want) in zip(read.entries, c.entries) { #expect(same(got, want), "\(c.name): \(want.flownOn)") }
            #expect(read.skipped == c.skipped.map { LogbookCSV.Skipped(line: $0.line, reason: $0.reason) }, "\(c.name)")
        }
    }
}
