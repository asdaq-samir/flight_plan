import Foundation
import Testing
@testable import Wingtip

/// The assistant's stream decoded line by line and folded into the
/// conversation, as AskView shows it (Assistant.swift).
struct AssistantTests {
    static let stream = [
        #"{"type":"tool","name":"weather_at","label":"Checking the weather at KMSN"}"#,
        #"{"type":"text","text":"KMSN is "}"#,
        #"{"type":"text","text":"VFR: wind 270 at 12, "}"#,
        #"{"type":"text","text":"visibility 10, clear below 12,000."}"#,
        #"{"type":"sources","sources":[{"id":"metar:KMSN","label":"KMSN METAR 1852Z","text":"KMSN 031852Z 27012KT 10SM CLR 18/07 A3012"}]}"#,
        #"{"type":"done"}"#,
    ]

    @Test func eachKindOfLineIsRead() throws {
        let lines = try Self.stream.map { try AssistantClient.decode(line: Data($0.utf8)) }
        #expect(lines[0] == .tool(name: "weather_at", label: "Checking the weather at KMSN"))
        #expect(lines[1] == .text("KMSN is "))
        #expect(lines[4] == .sources([AssistantSource(id: "metar:KMSN", label: "KMSN METAR 1852Z", text: "KMSN 031852Z 27012KT 10SM CLR 18/07 A3012")]))
        #expect(lines[5] == .done)
        #expect(try AssistantClient.decode(line: Data(#"{"type":"error","words":"The model is not reachable."}"#.utf8)) == .error("The model is not reachable."))
    }

    @Test func aLineOfAKindNotYetUsedIsSkipped() throws {
        #expect(try AssistantClient.decode(line: Data(#"{"type":"thinking","text":"…"}"#.utf8)) == nil)
    }

    @Test func theStreamBecomesOneAnswerWithItsSources() throws {
        var conversation = AssistantConversation()
        conversation.ask("What's the weather at KMSN?")
        #expect(conversation.answering && conversation.turns.count == 2)
        for line in Self.stream {
            if let decoded = try AssistantClient.decode(line: Data(line.utf8)) {
                conversation.take(decoded)
                // The tool's words stand only until the answer's text starts.
                if case .tool = decoded { #expect(conversation.status == "Checking the weather at KMSN") }
                if case .text = decoded { #expect(conversation.status == nil) }
            }
        }
        #expect(!conversation.answering)
        let answer = conversation.turns[1]
        #expect(answer.role == .assistant)
        #expect(answer.content == "KMSN is VFR: wind 270 at 12, visibility 10, clear below 12,000.")
        #expect(answer.sources.map(\.id) == ["metar:KMSN"])
        #expect(answer.problem == nil)
        // The whole conversation goes back with the next question.
        conversation.ask("And the crosswind?")
        #expect(conversation.messages.map(\.content) == ["What's the weather at KMSN?", answer.content, "And the crosswind?"])
        #expect(conversation.messages.map(\.role) == ["user", "assistant", "user"])
    }

    @Test func anErrorLineIsSaidUnderTheAnswer() throws {
        var conversation = AssistantConversation()
        conversation.ask("Brief me")
        conversation.take(try #require(try AssistantClient.decode(line: Data(#"{"type":"text","text":"Winds aloft "}"#.utf8))))
        conversation.take(try #require(try AssistantClient.decode(line: Data(#"{"type":"error","words":"The winds aloft could not be fetched."}"#.utf8))))
        #expect(!conversation.answering)
        #expect(conversation.turns.last?.content == "Winds aloft ")
        #expect(conversation.turns.last?.problem == "The winds aloft could not be fetched.")
        // An answer cut off before a word is not resent: the planner refuses an empty turn.
        var empty = AssistantConversation()
        empty.ask("Brief me")
        empty.broke(AssistantClient.notHere)
        #expect(empty.turns.last?.problem == "The assistant isn't on this planner yet.")
        #expect(empty.messages.map(\.content) == ["Brief me"])
    }

    @Test func aPlannerWithoutTheAssistantIsSaidSo() {
        #expect(AssistantClient.words(for: Planner.Failure(status: 404, detail: "Not Found")) == AssistantClient.notHere)
        #expect(AssistantClient.words(for: Planner.Failure(status: 503, detail: "The model is busy.")) == "The model is busy.")
    }

    @Test func theContextIsThePlannersSnakeCase() throws {
        var context = AssistantContext(dep: "C81", dest: "KMSN", stops: [], aircraft: "c172", altitudeFt: 4500)
        context.ownShip = AssistantContext.OwnShipFix(lat: 42.3, lon: -88.1, altitudeFt: 4480, trackDeg: 300, groundspeedKt: 105)
        var minimums = PersonalMinimums()
        minimums.crosswindKt = 12
        context.pilot = AssistantContext.PilotRecord(personalMinimums: minimums, currency: ["Day passenger currency (61.57(a)) until 2026-12-01"])
        let ask = AssistantAsk(messages: [AssistantMessage(role: "user", content: "Brief me")], context: context)
        let body = String(decoding: try Planner.snakeEncoder.encode(ask), as: UTF8.self)
        #expect(body.contains(#""altitude_ft":4500"#))
        #expect(body.contains(#""own_ship":{"altitude_ft":4480,"groundspeed_kt":105,"lat":42.3,"lon":-88.1,"track_deg":300}"#))
        #expect(body.contains(#""personal_minimums":{"crosswind_kt":12}"#))
        #expect(body.contains(#""messages":[{"content":"Brief me","role":"user"}]"#))
    }
}
