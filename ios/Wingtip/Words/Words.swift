import Foundation
import os
#if canImport(FoundationModels)
import FoundationModels
#endif

/// The briefing and the Go / No-Go in a few plain sentences, each
/// resting on figures the pilot can read raw. The figures are always the
/// engine's or the planner's; the words are a model's: the planner's
/// (POST /api/words/{kind}, app.words, Claude) while the planner can be
/// reached, else Apple's on-device model (FoundationModels, iOS 26), with
/// no signal in the air. A sentence cites the figures it rests on by
/// their ids, and a sentence citing an id it was not given is dropped,
/// here as on the planner (app.words.checked): the model can cite
/// wrongly, and a sentence resting on nothing is not shown. Neither
/// model is asked for a figure, and the screen's own figures are never
/// touched: the words are an addition above them.

/// One figure a sentence can rest on (app.words.Source): its id, as the
/// planner names them ("metar:KMSN", "taf:KMSN", "hazard:0",
/// "finding:fuel"), the chip's label and the raw text the chip opens.
struct WordsSource: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let label: String
    let text: String
}

/// One sentence and the ids of the figures it rests on (app.words.Sentence).
struct WordsSentence: Codable, Equatable, Sendable {
    let text: String
    let sources: [String]
}

/// The words endpoints' answer (app.words.WordsAnswer), and the shape the
/// on-device words take too: the sentences, the most important first;
/// the sources they cite, in the order given; which model wrote them;
/// and, with no sentences, why not, in words.
struct Words: Codable, Equatable, Sendable {
    var sentences: [WordsSentence]
    var sources: [WordsSource]
    var model: String
    var unavailable: String?

    /// No words, and why.
    static func none(_ model: String, _ why: String) -> Words {
        Words(sentences: [], sources: [], model: model, unavailable: why)
    }

    /// The sentences every one of whose cited ids is a figure given, the
    /// first `most` of them, and the figures they cite in the order
    /// given; the rest dropped (app.words.checked). A sentence citing
    /// nothing rests on nothing and goes too, as does one citing an id
    /// not given, however plausible it reads: the model can cite wrongly,
    /// and a sentence whose chip would open nothing is not shown.
    static func checked(_ sentences: [WordsSentence], sources: [WordsSource], model: String, most: Int = 10) -> Words {
        let given = Set(sources.map(\.id))
        var kept: [WordsSentence] = []
        for sentence in sentences {
            let text = sentence.text.trimmingCharacters(in: .whitespacesAndNewlines)
            var ids: [String] = []
            for id in sentence.sources.map({ $0.trimmingCharacters(in: .whitespaces) }) where !id.isEmpty && !ids.contains(id) { ids.append(id) }
            if !text.isEmpty, !ids.isEmpty, ids.allSatisfy(given.contains) {
                kept.append(WordsSentence(text: text, sources: ids))
            } else {
                Log.words.info("dropped a sentence citing \(ids.joined(separator: ","), privacy: .public)")
            }
        }
        kept = Array(kept.prefix(most))
        let cited = Set(kept.flatMap(\.sources))
        return Words(sentences: kept, sources: sources.filter { cited.contains($0.id) }, model: model, unavailable: nil)
    }

    /// A cited figure by its id, for a chip.
    func source(_ id: String) -> WordsSource? { sources.first { $0.id == id } }
}

/// Which words endpoint, and which instructions on the device.
enum WordsKind: String, Sendable {
    case notams, weather, risk, debrief, changes
}

/// What the words are asked for: the planner's body for its endpoint,
/// encoded already (Planner.snakeEncoder), and the same figures as the
/// phone assembles them (WordsFigures) for the on-device model, which
/// can reach no planner.
struct WordsAsk: Sendable {
    let kind: WordsKind
    let body: Data
    let figures: [WordsSource]

    init(kind: WordsKind, body: some Encodable, figures: [WordsSource]) throws {
        self.kind = kind
        self.body = try Planner.snakeEncoder.encode(body)
        self.figures = figures
    }
}

/// Where the words came from, for the caption over them: the pilot
/// should know which model wrote what they read.
enum WordsOrigin: Equatable, Sendable {
    case planner, device, none

    var caption: String {
        switch self {
        case .planner: "From the planner"
        case .device: "On this iPhone"
        case .none: "No words"
        }
    }
}

/// Words with where they came from.
struct SaidWords: Equatable, Sendable {
    let words: Words
    let origin: WordsOrigin
}

/// A source of words: the planner, the device, or a fake in a test.
protocol WordsProvider: Sendable {
    func words(_ ask: WordsAsk) async throws -> Words
}

/// Why a provider gave no words, in words a pilot reads.
struct WordsUnavailable: Error, LocalizedError, Equatable {
    let why: String
    var errorDescription: String? { why }
}

// MARK: - The planner's words

extension Planner {
    /// A planner POST that changes nothing, its body encoded already.
    static func postRead<T: Decodable>(_ type: T.Type, _ path: String, body: Data) async throws -> T {
        var request = URLRequest(url: Config.gateway.appending(path: Config.plannerPath(path)))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try snakeCase.decode(T.self, from: try await data(for: request))
    }
}

/// The planner's words (POST /api/words/{kind}, through the gateway's
/// /api/planner proxy): the planner assembles the figures itself from
/// the same ask the briefing and the Go / No-Go took, and answers with
/// Claude's sentences checked against them. Its "unavailable" (the
/// planner reached, its model not) is thrown here, so the facade asks
/// the device instead.
struct PlannerWords: WordsProvider {
    func words(_ ask: WordsAsk) async throws -> Words {
        let words = try await Planner.postRead(Words.self, "/api/words/\(ask.kind.rawValue)", body: ask.body)
        if words.sentences.isEmpty, let why = words.unavailable { throw WordsUnavailable(why: why) }
        // Checked again on the phone: the planner checks its own, but the
        // chips open only what the answer carries.
        return Words.checked(words.sentences, sources: words.sources, model: words.model)
    }
}

// MARK: - The words on this iPhone

#if canImport(FoundationModels)
/// What the on-device model fills in: the sentences, each with the ids of
/// the figures it rests on. The ids are guided to be the ones given and
/// checked after (Words.checked), since a guide is advice to the model,
/// not a proof.
@available(iOS 26, *)
@Generable
struct WordsAnswer {
    @Generable
    struct Sentence {
        @Guide(description: "One short declarative sentence a pilot reads in the cockpit, quoting figures only as the figures give them.")
        var text: String
        @Guide(description: "The ids, exactly as given in the figures, of the figures this sentence rests on; at least one, and never an id not given.")
        var sources: [String]
    }

    @Guide(description: "The sentences, the most important first; no more than eight.")
    var sentences: [Sentence]
}
#endif

/// Apple's on-device model (FoundationModels, iOS 26 and Apple
/// Intelligence on): the words with no signal, from the figures the
/// phone assembled, which are the engine's and the planner's own. Not
/// built where the SDK has no FoundationModels, and refused in words on
/// an older iOS, a phone without Apple Intelligence, or while the model
/// is still downloading.
struct OnDeviceWords: WordsProvider {
    static let model = "apple-on-device"

    /// Why the model cannot answer here, else nil.
    static var unavailableWhy: String? {
        #if canImport(FoundationModels)
        if #available(iOS 26, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return nil
            case .unavailable(let reason):
                switch reason {
                case .deviceNotEligible: return "This iPhone cannot run Apple's on-device model."
                case .appleIntelligenceNotEnabled: return "Apple Intelligence is off in Settings."
                case .modelNotReady: return "Apple's on-device model is still downloading."
                @unknown default: return "Apple's on-device model is not available."
                }
            }
        }
        #endif
        return "Words on this iPhone need iOS 26."
    }

    /// What each kind of words is asked to say, as the planner asks its
    /// model (app.routers.words WEATHER_ASK, RISK_ASK), and the rule over
    /// all of them: no figure of the model's own.
    static func instructions(_ kind: WordsKind) -> String {
        let ask: String
        switch kind {
        case .weather:
            ask = "Say the weather for this flight as a pilot would brief it: the departure now, each leg at its time, the destination at arrival, then what could change it: the hazards, the pilot reports, the TFRs. Where the figures give a reason not to go VFR, say so plainly."
        case .risk:
            ask = "Say where the risk in this flight is, in the pilot's terms: the weather, the airplane, the pilot's own recency and minimums, the plan; and what would lower it, where the findings say. The most important first. Never say the flight is safe: the decision is the pilot in command's."
        case .notams:
            ask = "Say which NOTAMs and TFRs matter for this flight, the most important first."
        case .debrief:
            ask = "Say how the flight went against its plan, as an instructor would debrief it, the most important first."
        case .changes:
            ask = "Say what changed in this flight's weather since the last look, and what it means for the flight."
        }
        return """
        You write a few plain sentences for a pilot from the figures given, which are a flight planner's own. \(ask)
        Rules: every figure, altitude, time, distance, wind, ceiling or visibility you mention must be quoted from the figures given, as given; never compute, round, convert or add one of your own. Every sentence must cite, by id, at least one of the figures it rests on, using the ids exactly as given and no other. Say nothing the figures do not say. Short sentences; no greeting, no advice beyond what a figure says.
        """
    }

    /// The figures as the model reads them: compact JSON, one object per
    /// figure, {id, label, text}.
    static func prompt(_ figures: [WordsSource]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let json = (try? encoder.encode(figures)).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
        return "The figures, as JSON:\n\(json)\nWrite the sentences."
    }

    func words(_ ask: WordsAsk) async throws -> Words {
        if let why = Self.unavailableWhy { throw WordsUnavailable(why: why) }
        if ask.figures.isEmpty { return Words.checked([], sources: [], model: Self.model) }
        #if canImport(FoundationModels)
        if #available(iOS 26, *) {
            let session = LanguageModelSession(instructions: Self.instructions(ask.kind))
            let response = try await session.respond(to: Self.prompt(ask.figures), generating: WordsAnswer.self)
            let sentences = response.content.sentences.map { WordsSentence(text: $0.text, sources: $0.sources) }
            return Words.checked(sentences, sources: ask.figures, model: Self.model, most: 8)
        }
        #endif
        throw WordsUnavailable(why: "Words on this iPhone need iOS 26.")
    }
}

// MARK: - The facade

/// Where the words come from, in order: the planner first; this iPhone
/// when the planner fails or cannot be reached; and no words, with why
/// in plain language, when neither can (an older iOS, the model not
/// ready, no signal and no planner). Never a figure of its own: the
/// figures are on the screen already, and the words rest on them.
struct WordsFor: Sendable {
    var planner: any WordsProvider = PlannerWords()
    var device: any WordsProvider = OnDeviceWords()

    init(planner: any WordsProvider = PlannerWords(), device: any WordsProvider = OnDeviceWords()) {
        self.planner = planner
        self.device = device
    }

    func said(_ ask: WordsAsk) async -> SaidWords {
        do {
            return SaidWords(words: try await planner.words(ask), origin: .planner)
        } catch {
            Log.words.notice("the planner's \(ask.kind.rawValue, privacy: .public) words failed: \(error.localizedDescription, privacy: .public)")
        }
        do {
            return SaidWords(words: try await device.words(ask), origin: .device)
        } catch {
            Log.words.notice("the iPhone's \(ask.kind.rawValue, privacy: .public) words failed: \(error.localizedDescription, privacy: .public)")
            let why = (error as? WordsUnavailable)?.why ?? "Apple's on-device model could not write them."
            return SaidWords(words: .none("none", "No words: the planner cannot be reached, and \(why.prefix(1).lowercased() + why.dropFirst())"), origin: .none)
        }
    }
}

extension Log {
    /// The words: a provider that failed, a sentence dropped.
    static let words = Logger(subsystem: subsystem, category: "words")
}
