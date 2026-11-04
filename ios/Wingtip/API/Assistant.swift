import Foundation
import Observation

/// One line of the assistant's stream (POST /api/assistant, newline-
/// delimited JSON, app.assistant): a "tool" line while it looks something
/// up, "text" lines that add to the answer, one "sources" line with the
/// raw reports the answer rests on, then "done" -- or "error" in the
/// planner's words. Decoded by hand, as NavLog.swift does: a stream is
/// not an OpenAPI response.
enum AssistantLine: Equatable, Sendable {
    case tool(name: String, label: String)
    case text(String)
    case sources([AssistantSource])
    case done
    case error(String)
}

/// A raw thing an answer rests on (a METAR, a NOTAM), shown to the pilot
/// as sent when its chip is tapped.
struct AssistantSource: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let text: String
}

/// One turn of the conversation, the pilot's question or the assistant's
/// answer with the sources it cited and, where the stream broke, why.
struct AssistantTurn: Identifiable, Equatable, Sendable {
    enum Role: String, Codable, Sendable {
        case user, assistant
    }

    let id: UUID
    let role: Role
    var content: String
    var sources: [AssistantSource] = []
    var problem: String?

    init(id: UUID = UUID(), role: Role, content: String, sources: [AssistantSource] = [], problem: String? = nil) {
        self.id = id
        self.role = role
        self.content = content
        self.sources = sources
        self.problem = problem
    }
}

/// The pilot's plan, position and record as the planner's Context takes
/// them, encoded in its snake case by Planner.snakeEncoder.
struct AssistantContext: Encodable, Equatable, Sendable {
    struct OwnShipFix: Encodable, Equatable, Sendable {
        let lat: Double
        let lon: Double
        var altitudeFt: Double?
        var trackDeg: Double?
        var groundspeedKt: Double?
    }

    /// The pilot's own: the personal minimums kept on the phone (Verdict)
    /// and their currency as lines of words, for the model to read, never
    /// to compute from.
    struct PilotRecord: Encodable, Equatable, Sendable {
        var personalMinimums: PersonalMinimums?
        var currency: [String] = []
        var homeBase: String?
    }

    var dep = ""
    var dest = ""
    var stops: [String] = []
    var aircraft = ""
    var altitudeFt: Double?
    /// ISO 8601 UTC; nil for the planner's own now.
    var depart: String?
    var ownShip: OwnShipFix?
    var pilot: PilotRecord?

    /// The context as the app has it: the plan on the page, the airplane's
    /// last fix, and the pilot where one is signed in. The departure time
    /// is the planner's own now: the plan has none of its own.
    @MainActor
    static func make(plan: Plan, ownShip: OwnShip, session: Session, minimums: PersonalMinimums? = nil, currency: Currency? = nil) -> AssistantContext {
        var context = AssistantContext(dep: plan.dep, dest: plan.dest, stops: plan.stops, aircraft: plan.aircraft)
        context.altitudeFt = plan.ownAltitudeFt ?? plan.altitudeFt
        if let fix = ownShip.fix {
            context.ownShip = OwnShipFix(lat: fix.coordinate.latitude, lon: fix.coordinate.longitude, altitudeFt: fix.altitudeFt,
                                         trackDeg: fix.trackDeg, groundspeedKt: fix.groundspeedKt)
        }
        if session.signedIn {
            var record = PilotRecord(personalMinimums: minimums, homeBase: session.pilot?.homeBase)
            if let currency { record.currency = Self.words(of: currency) }
            context.pilot = record
        } else if let minimums {
            context.pilot = PilotRecord(personalMinimums: minimums)
        }
        return context
    }

    /// The gateway's currency figures as words: the dates it worked out
    /// (61.57's passenger windows, the flight review, the medical) quoted
    /// as it gave them, nothing worked out here.
    static func words(of currency: Currency) -> [String] {
        var lines: [String] = []
        if let until = currency.dayPassengersUntil { lines.append("Day passenger currency (61.57(a)) until \(until)") }
        if let until = currency.nightPassengersUntil { lines.append("Night passenger currency (61.57(b)) until \(until)") }
        if let until = currency.instrumentCurrentUntil { lines.append("Instrument current (61.57(c)) until \(until)") }
        if let on = currency.flightReviewOn { lines.append("Flight review (61.56) on \(on)" + (currency.flightReviewUntil.map { ", good until \($0)" } ?? "")) }
        if let on = currency.medicalExpiresOn { lines.append("Medical expires \(on)") }
        lines.append("\(currency.totalHours.formatted()) hours total, \(currency.nightHours.formatted()) at night, \(currency.crossCountryHours.formatted()) cross-country")
        return lines
    }
}

/// The conversation as the pilot sees it, append-only: each streamed
/// answer becomes the next assistant turn, and the whole list is resent
/// with the next question. Pure, so a stream can be folded into it in a
/// test (AssistantTests).
struct AssistantConversation: Equatable, Sendable {
    var turns: [AssistantTurn] = []
    /// What the assistant is doing right now (a tool's label), while it
    /// is answering; nil between answers and once the text starts.
    var status: String?
    var answering = false

    /// The pilot's question, and the assistant's answer begun, empty.
    mutating func ask(_ question: String) {
        turns.append(AssistantTurn(role: .user, content: question))
        turns.append(AssistantTurn(role: .assistant, content: ""))
        status = nil
        answering = true
    }

    /// One line of the stream folded into the answer being written.
    mutating func take(_ line: AssistantLine) {
        guard let last = turns.indices.last, turns[last].role == .assistant else { return }
        switch line {
        case .tool(_, let label):
            status = label
        case .text(let text):
            turns[last].content += text
            status = nil
        case .sources(let sources):
            turns[last].sources += sources
        case .done:
            status = nil
            answering = false
        case .error(let words):
            turns[last].problem = words
            status = nil
            answering = false
        }
    }

    /// The stream ended without its "done": the call failed, or was given
    /// up. What came stays; why is said under it.
    mutating func broke(_ problem: String?) {
        status = nil
        answering = false
        guard let last = turns.indices.last, turns[last].role == .assistant else { return }
        if let problem { turns[last].problem = problem }
    }

    /// The turns the planner is sent: every one with words (its Turn
    /// refuses an empty content, which an answer cut off before its first
    /// word would be).
    var messages: [AssistantMessage] {
        turns.filter { !$0.content.isEmpty }.map { AssistantMessage(role: $0.role.rawValue, content: $0.content) }
    }
}

/// One turn as the planner's Turn takes it.
struct AssistantMessage: Encodable, Equatable, Sendable {
    let role: String
    let content: String
}

/// The question as the planner's AssistantAsk takes it: every turn so
/// far, and the context.
struct AssistantAsk: Encodable, Sendable {
    let messages: [AssistantMessage]
    let context: AssistantContext?
}

/// The assistant, through the gateway's proxy (/api/planner/assistant,
/// on its allow-list), with the pilot's session cookie as every planner
/// call carries it. One question at a time: a new one cancels the stream
/// of the last, whose words so far stay on the page.
@MainActor
@Observable
final class AssistantClient {
    private(set) var conversation = AssistantConversation()
    private var running: Task<Void, Never>?

    var turns: [AssistantTurn] { conversation.turns }
    var status: String? { conversation.status }
    var answering: Bool { conversation.answering }

    /// What a planner without the assistant answers (404 through the
    /// gateway's proxy): said where the question was asked.
    nonisolated static let notHere = "The assistant isn't on this planner yet."

    func ask(_ question: String, context: AssistantContext?) {
        let question = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        cancel()
        conversation.ask(question)
        let ask = AssistantAsk(messages: conversation.messages, context: context)
        running = Task { [weak self] in
            do {
                for try await line in Self.stream(ask) {
                    guard !Task.isCancelled else { return }
                    self?.conversation.take(line)
                }
                guard !Task.isCancelled else { return }
                // A stream that ends with no "done" is cut off; the words
                // so far stay, and the pilot is told the answer is short.
                if self?.conversation.answering == true { self?.conversation.broke("The answer was cut off.") }
            } catch {
                guard !Task.isCancelled else { return }
                self?.conversation.broke(Self.words(for: error))
            }
        }
    }

    /// The stream of the last question given up: what came stays.
    func cancel() {
        running?.cancel()
        running = nil
        if conversation.answering { conversation.broke(nil) }
    }

    func clear() {
        cancel()
        conversation = AssistantConversation()
    }

    nonisolated static func words(for error: any Error) -> String {
        if let failure = error as? Planner.Failure {
            return failure.status == 404 ? notHere : failure.localizedDescription
        }
        return (error as? URLError)?.code == .cancelled ? "The answer was given up." : "The assistant could not be reached: \(error.localizedDescription)"
    }

    /// The answer's lines, read as the planner sends them through the
    /// app's session (Gateway.session, so the cookie and the cache policy
    /// are the app's). A POST that changes nothing goes without the
    /// CSRF token, as Planner.postRead does.
    nonisolated static func stream(_ ask: AssistantAsk) -> AsyncThrowingStream<AssistantLine, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let request = try await Planner.request("POST", "/api/assistant", json: ask, csrf: false)
                    let (bytes, response) = try await Gateway.session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard status == 200 else {
                        var body = Data()
                        for try await byte in bytes { body.append(byte) }
                        Log.planner.error("the assistant answered \(status)")
                        throw Planner.Failure(status: status, detail: Planner.detail(of: body))
                    }
                    for try await line in bytes.lines where !line.isEmpty {
                        if let value = try decode(line: Data(line.utf8)) { continuation.yield(value) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// One line of the stream, or nil for a kind the app has no use for.
    nonisolated static func decode(line: Data) throws -> AssistantLine? {
        struct Kind: Decodable { let type: String }
        struct Tool: Decodable { var name: String?; var label: String? }
        struct Text: Decodable { var text: String? }
        struct Sources: Decodable { var sources: [AssistantSource]? }
        struct Problem: Decodable { var words: String?; var detail: String? }
        let decoder = Planner.snakeCase
        switch try decoder.decode(Kind.self, from: line).type {
        case "tool":
            let tool = try decoder.decode(Tool.self, from: line)
            return .tool(name: tool.name ?? "", label: tool.label ?? "Working…")
        case "text":
            return .text(try decoder.decode(Text.self, from: line).text ?? "")
        case "sources":
            return .sources(try decoder.decode(Sources.self, from: line).sources ?? [])
        case "done":
            return .done
        case "error":
            let problem = try decoder.decode(Problem.self, from: line)
            return .error(problem.words ?? problem.detail ?? "The assistant could not answer.")
        default:
            return nil
        }
    }
}
