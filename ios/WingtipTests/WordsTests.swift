import Foundation
import Testing
@testable import Wingtip

/// The words over the briefing and the Go / No-Go (Words.swift): where
/// they come from, in order, and the guard every sentence passes.
struct WordsTests {
    /// A provider that answers with given words, or throws.
    struct Fake: WordsProvider {
        var words: Words?
        var error: any Error = WordsUnavailable(why: "Not here.")
        func words(_ ask: WordsAsk) async throws -> Words {
            if let words { return words }
            throw error
        }
    }

    static let figures = [
        WordsSource(id: "metar:KMSN", label: "KMSN METAR, VFR", text: "KMSN 031853Z 27008KT 10SM FEW045 12/03 A3012"),
        WordsSource(id: "finding:fuel", label: "Fuel: ok", text: "Needs 30.2 gal with taxi and a 30 min reserve; 22.8 gal spare"),
    ]

    static func ask() throws -> WordsAsk {
        try WordsAsk(kind: .weather, body: WeatherWordsAsk(dep: "KMSN", dest: "KDLH"), figures: figures)
    }

    static let planners = Words(sentences: [WordsSentence(text: "KMSN is VFR.", sources: ["metar:KMSN"])],
                                sources: [figures[0]], model: "claude", unavailable: nil)
    static let devices = Words(sentences: [WordsSentence(text: "Fuel is enough.", sources: ["finding:fuel"])],
                               sources: [figures[1]], model: "apple-on-device", unavailable: nil)

    @Test func theFacadePicksThePlannersWordsWhenItAnswers() async throws {
        let said = await WordsFor(planner: Fake(words: Self.planners), device: Fake(words: Self.devices)).said(try Self.ask())
        #expect(said.origin == .planner)
        #expect(said.words.sentences.map(\.text) == ["KMSN is VFR."])
        #expect(said.origin.caption == "From the planner")
    }

    @Test func theFacadeFallsToThisIphoneWhenThePlannerThrows() async throws {
        let offline = Planner.Failure(status: 0, detail: "no signal")
        let said = await WordsFor(planner: Fake(words: nil, error: offline), device: Fake(words: Self.devices)).said(try Self.ask())
        #expect(said.origin == .device)
        #expect(said.words.sentences.map(\.text) == ["Fuel is enough."])
        #expect(said.origin.caption == "On this iPhone")
    }

    @Test func noWordsSayWhyInPlainLanguageWhenNeitherCan() async throws {
        let said = await WordsFor(planner: Fake(words: nil), device: Fake(words: nil, error: WordsUnavailable(why: "Words on this iPhone need iOS 26."))).said(try Self.ask())
        #expect(said.origin == .none)
        #expect(said.words.sentences.isEmpty)
        #expect(said.words.unavailable == "No words: the planner cannot be reached, and words on this iPhone need iOS 26.")
    }

    /// The planner's own "unavailable" (reached, its model not) is a
    /// reason to ask the device, not an answer with no words.
    @Test func thePlannersUnavailableFallsToThisIphone() async throws {
        let unavailable = Words.none("claude", "The briefer could not be reached.")
        let said = await WordsFor(planner: Fake(words: unavailable), device: Fake(words: Self.devices)).said(try Self.ask())
        #expect(said.origin == .device)
    }

    /// The guard: a sentence citing an id it was not given is dropped,
    /// as is one citing nothing; the rest keep their order, and only the
    /// figures cited come back.
    @Test func aSentenceCitingAnUnknownIdIsDropped() {
        let said = [
            WordsSentence(text: "KMSN is VFR.", sources: ["metar:KMSN"]),
            WordsSentence(text: "KDLH is IFR.", sources: ["metar:KDLH"]),
            WordsSentence(text: "Fuel is enough, and KMSN is VFR.", sources: ["finding:fuel", "metar:KMSN", "metar:KDLH"]),
            WordsSentence(text: "Something with no figure.", sources: []),
            WordsSentence(text: "  Fuel is enough.  ", sources: [" finding:fuel ", "finding:fuel"]),
        ]
        let words = Words.checked(said, sources: Self.figures, model: "test")
        #expect(words.sentences.map(\.text) == ["KMSN is VFR.", "Fuel is enough."])
        #expect(words.sentences[1].sources == ["finding:fuel"])
        #expect(words.sources.map(\.id) == ["metar:KMSN", "finding:fuel"])
        #expect(words.unavailable == nil)
    }

    @Test func atMostSoManySentencesAreKept() {
        let said = (0..<12).map { _ in WordsSentence(text: "KMSN is VFR.", sources: ["metar:KMSN"]) }
        #expect(Words.checked(said, sources: Self.figures, model: "test", most: 8).sentences.count == 8)
    }

    /// The planner's answer reads as the document gives it, and is checked
    /// again on the phone.
    @Test func thePlannersAnswerReads() throws {
        let json = #"{"sentences":[{"text":"KMSN is VFR.","sources":["metar:KMSN"]},{"text":"Made up.","sources":["metar:KXYZ"]}],"sources":[{"id":"metar:KMSN","label":"KMSN METAR, VFR","text":"KMSN 031853Z ..."}],"model":"claude-haiku-5-5","unavailable":null}"#
        let words = try Planner.snakeCase.decode(Words.self, from: Data(json.utf8))
        #expect(words.model == "claude-haiku-5-5" && words.unavailable == nil)
        let checked = Words.checked(words.sentences, sources: words.sources, model: words.model)
        #expect(checked.sentences.count == 1)
    }

    /// The figures the phone assembles carry the planner's ids, so a chip
    /// means the same whichever model wrote the sentence.
    @Test func theBriefingsFiguresCarryThePlannersIds() throws {
        var briefing = Briefing(airports: [:], forecast: Forecast(minCeilingFt: nil, minVisibilitySm: nil, stations: []), hazards: [], metars: [:], weatherUnavailable: [])
        briefing.metars = ["KMSN": Metar(flightCategory: "VFR", raw: "KMSN 031853Z 27008KT 10SM FEW045 12/03 A3012"), "KDLH": nil]
        briefing.hazards = [Hazard(hazard: "CONVECTIVE", raw: "WSUS31 ...", type: "SIGMET")]
        briefing.gairmets = [GAirmet(altitudeHighFt: -1, dueTo: "clouds", hazard: "IFR", severity: nil)]
        briefing.tfrs = [RouteTfr(activeNow: false, alongTrackNm: 12, crosses: true, notamId: "6/1234", title: "Stadium")]
        briefing.forecast = Forecast(minCeilingFt: 3000, minVisibilitySm: 6, stations: [ForecastStation(icaoId: "KMSN", raw: "TAF KMSN ...")])
        briefing.vfrNotRecommended = ["IFR along the route"]
        briefing.weatherUnavailable = ["pireps"]
        let ids = WordsFigures.weather(briefing, dep: "KMSN", dest: "KDLH", stops: [], eteMin: 95).map(\.id)
        #expect(ids == ["flight:route", "unchecked", "vfr-not-recommended", "metar:KDLH", "metar:KMSN", "taf:KMSN", "hazard:0", "gairmet:0", "tfr:6/1234"])
        let gairmet = try #require(WordsFigures.weather(briefing, dep: "KMSN", dest: "KDLH", stops: [], eteMin: nil).first { $0.id == "gairmet:0" })
        // No top for an IFR G-AIRMET given -1, as the web writes it.
        #expect(!gairmet.text.contains("From "))
    }

    @Test func theGoNoGosFiguresCarryThePlannersIds() throws {
        let answer = try Planner.snakeCase.decode(GoNoGoAnswer.self, from: Data(GoNoGoTests.answer.utf8))
        let ids = WordsFigures.risk(answer).map(\.id)
        #expect(ids.first == "verdict:line")
        #expect(ids.contains("finding:fuel") && ids.contains("risk:line") && ids.contains("risk:stress"))
        let unlawful = try #require(WordsFigures.risk(answer).first { $0.id == "risk:line" })
        #expect(unlawful.text.contains("8 points, level caution"))
    }

    /// POST /api/words/risk's body in the planner's snake case, with the
    /// self checks the planner's GoNoGo requires and no loading.
    @Test func theRiskAskEncodesForThePlanner() throws {
        let answer = try Planner.snakeCase.decode(GoNoGoAnswer.self, from: Data(GoNoGoTests.answer.utf8))
        let ask = try WordsAsk(kind: .risk, body: RiskWordsAsk(answer, pilot: ["personal minimums": "Ceiling: 2,000 ft"]), figures: WordsFigures.risk(answer))
        let body = try #require(JSONSerialization.jsonObject(with: ask.body) as? [String: Any])
        let verdict = try #require(body["verdict"] as? [String: Any])
        #expect(verdict["self_checks"] is [Any] && verdict["loading"] == nil)
        #expect((verdict["items"] as? [Any])?.count == 7)
        #expect((body["pilot"] as? [String: String])?["personal minimums"] == "Ceiling: 2,000 ft")
    }

    /// The on-device model's prompt is the figures as compact JSON and
    /// nothing else; its instructions forbid a figure of the model's own.
    @Test func theDevicePromptIsTheFiguresAsJson() {
        let prompt = OnDeviceWords.prompt(Self.figures)
        #expect(prompt.contains(#""id":"metar:KMSN""#) && prompt.contains(#""id":"finding:fuel""#))
        #expect(OnDeviceWords.instructions(.weather).contains("never compute"))
        #expect(OnDeviceWords.instructions(.risk).contains("Never say the flight is safe"))
    }
}
