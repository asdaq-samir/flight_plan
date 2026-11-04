import Foundation

/// The Go / No-Go at a glance, the owner's rule for every brief
/// (2026-11-03): the verdict, then at most three one-sentence lines a
/// pilot acts on, the rest in one row. Each line is a finding of the
/// planner's answer (GoNoGoAnswer) in its words; nothing is judged here,
/// only picked and cut to a glance.
enum Glance {
    /// As many lines as a glance holds, and the longest one sentence.
    static let most = 3
    static let longest = 140

    /// One line of the glance: the finding it is, and the sentence.
    struct Line: Equatable, Identifiable, Sendable {
        let key: String
        let finding: String
        let words: String
        var id: String { key }
    }

    /// A finding's rank for the glance: what stops the flight first, then
    /// what wants a look, then what is not yet or not worked out; nothing
    /// is said for a clear finding.
    private static func rank(_ finding: String) -> Int? {
        switch finding {
        case "stop": 0
        case "caution": 1
        case "pending": 2
        case "unknown": 3
        default: nil
        }
    }

    /// The findings a pilot acts on, worst first and in the planner's
    /// order within a rank.
    static func acted(_ answer: GoNoGoAnswer) -> [VerdictItem] {
        answer.items.enumerated()
            .compactMap { i, item in rank(item.finding).map { (rank: $0, at: i, item: item) } }
            .sorted { ($0.rank, $0.at) < ($1.rank, $1.at) }
            .map(\.item)
    }

    /// The glance's lines: the first `most` of the findings acted on.
    static func lines(_ answer: GoNoGoAnswer) -> [Line] {
        acted(answer).prefix(most).map { Line(key: $0.key, finding: $0.finding, words: sentence($0)) }
    }

    /// The findings the glance leaves to its one folded row: the ones past
    /// its lines, then the clear ones.
    static func rest(_ answer: GoNoGoAnswer) -> [VerdictItem] {
        let shown = Set(lines(answer).map(\.key))
        let over = acted(answer).filter { !shown.contains($0.key) }
        return over + answer.items.filter { rank($0.finding) == nil }
    }

    /// The folded row's words: "Weather, fuel and airspace: nothing to
    /// fix", with "2 more to look at" before it where lines ran over; nil
    /// where the lines said everything.
    static func restWords(_ answer: GoNoGoAnswer) -> String? {
        let rest = rest(answer)
        guard !rest.isEmpty else { return nil }
        let over = rest.filter { rank($0.finding) != nil }
        let clear = rest.filter { rank($0.finding) == nil }
        var parts: [String] = []
        if !over.isEmpty { parts.append("\(over.count) more to look at") }
        if !clear.isEmpty { parts.append("\(listed(clear.map { lowered($0.label) })): nothing to fix") }
        let words = parts.joined(separator: "; ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    /// A finding as one sentence: its name, what was found, a full stop;
    /// cut at a word to the longest a line holds.
    static func sentence(_ item: VerdictItem) -> String {
        var words = item.detail.trimmingCharacters(in: .whitespacesAndNewlines)
        words = words.isEmpty ? item.label : "\(item.label): \(words)"
        if let last = words.last, !".!?…".contains(last) { words += "." }
        guard words.count > longest else { return words }
        let cut = String(words.prefix(longest - 1))
        let atWord = cut.lastIndex(of: " ").map { String(cut[..<$0]) } ?? cut
        return atWord.trimmingCharacters(in: CharacterSet(charactersIn: " ,;:")) + "…"
    }

    /// A label lowered for a list, its codes kept ("TFRs & special use").
    private static func lowered(_ label: String) -> String {
        guard let first = label.first, let second = label.dropFirst().first, second.isLowercase else { return label }
        return first.lowercased() + label.dropFirst()
    }

    /// "Weather", "weather and fuel", "weather, fuel and airspace".
    private static func listed(_ names: [String]) -> String {
        switch names.count {
        case 0: ""
        case 1: names[0]
        default: names.dropLast().joined(separator: ", ") + " and " + names[names.count - 1]
        }
    }
}
