import Foundation

/// A transmission heard, and whether it was said to us -- the web app's
/// lib/heardCall, checked against the same fixture (heardCalls.json,
/// SharedFixturesTests): our call sign at its start, as a controller
/// addresses an airplane, in the forms AIM 4-2-4 lets it take (the
/// registration whole, with its N or a type's name in its place, or the
/// prefix and its last three), never a longer call sign that ends the
/// same (AIM 4-2-4 a.1); and where a "direct" sends us.
enum HeardCall {
    /// Words said in place of the N (AIM 4-2-4 b), the common ones.
    static let typeWords: Set<String> = [
        "cessna", "skyhawk", "skylane", "skylark", "centurion", "cardinal", "caravan", "citation", "piper", "cherokee", "warrior",
        "archer", "arrow", "dakota", "lance", "saratoga", "seneca", "seminole", "aztec", "navajo", "malibu", "cub", "cirrus",
        "mooney", "bonanza", "baron", "beech", "beechcraft", "king", "diamond", "katana", "grumman", "tiger", "cheetah", "yankee",
        "experimental", "lancair", "glasair", "vans", "rv", "sport", "helicopter", "robinson", "tango", "november",
    ]
    /// How far in our call sign may begin: a controller says it first.
    static let callWithin = 3

    private static func words(_ text: String) -> [String] {
        let lower = text.lowercased().replacingOccurrences(of: "x[- ]ray", with: "xray", options: .regularExpression)
        let pattern = try! NSRegularExpression(pattern: "[a-z0-9]+")
        let ns = lower as NSString
        return pattern.matches(in: lower, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
    }

    private static func mark(_ w: String) -> String? {
        if let letter = Clearance.letters[w] { return letter }
        if let digit = Clearance.digits[w] { return digit }
        let isNumber = w.range(of: "^[0-9]+$", options: .regularExpression) != nil
        let isCode = w.range(of: "[0-9]", options: .regularExpression) != nil && w.range(of: "^[a-z0-9]+$", options: .regularExpression) != nil
        return isNumber || isCode ? w.uppercased() : nil
    }

    /// Whether the transmission is said to the airplane `tail` ("N123AB").
    static func ourCall(_ text: String, tail: String) -> Bool {
        let full = tail.trimmingCharacters(in: .whitespaces).uppercased()
        guard full.range(of: "^[A-Z0-9]{2,7}$", options: .regularExpression) != nil else { return false }
        let body = full.hasPrefix("N") ? String(full.dropFirst()) : full
        let last = String(body.suffix(3))
        let ws = words(text)
        var i = 0
        while i < ws.count {
            guard mark(ws[i]) != nil else { i += 1; continue }
            var run = "", j = i
            while j < ws.count, let m = mark(ws[j]) { run += m; j += 1 }
            let before = i > 0 ? ws[i - 1] : nil
            if i <= callWithin && (run == full || run == "N" + body || run == body || run == "N" + last
                                   || (run == last && before.map(typeWords.contains) == true)) {
                return true
            }
            i = j
        }
        return false
    }

    static let afterDirect: Set<String> = [
        "then", "climb", "maintain", "descend", "contact", "squawk", "expect", "cross", "at", "and", "when", "resume", "report",
        "cleared", "fly", "heading", "intercept", "join", "hold", "for", "via", "own", "navigation", "after",
    ]

    /// The place a "direct" sends us to, as words for the planner to find,
    /// or nil where none was said.
    static func directOf(_ text: String) -> String? {
        let toks = Clearance.tokens(text)
        guard let at = toks.firstIndex(where: { $0.word == "direct" }) else { return nil }
        var place: [Clearance.Token] = []
        var i = at + 1
        while i < toks.count && place.count < 6 {
            let t = toks[i]
            if t.word == "to" || t.word == "the" {
                if place.isEmpty { i += 1; continue }
                break
            }
            if afterDirect.contains(t.word) || (t.num != nil && !place.contains { Clearance.letters[$0.word] != nil }) { break }
            place.append(t)
            i += 1
        }
        let said = Clearance.placeWords(place)
        return said.isEmpty ? nil : said
    }
}
