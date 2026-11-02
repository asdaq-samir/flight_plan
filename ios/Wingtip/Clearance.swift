import Foundation

/// An ATC clearance as the phone heard it, read into its items -- the
/// web app's lib/clearance, checked against the same fixture
/// (clearances.json, SharedFixturesTests): its limit, its departure
/// procedure, the route, the altitudes, the frequency and the beacon code,
/// as AIM 4-4-3 lists what a clearance holds. The places it names are
/// found by the planner (/api/clearance/places, vfr.spoken), and the route
/// goes in only from the sheet, the pilot having read it (ClearanceSheet).
struct Clearance: Codable, Equatable, Sendable {
    /// The clearance limit as said ("duluth airport").
    var limit: String?
    var route: [ClearedItem] = []
    /// "...then as filed" (AIM 5-2-6): the filed route after what was
    /// said, which leaves out the filed altitude.
    var asFiled = false
    var maintainFt: Int?
    /// "at or below" or "at or above".
    var maintainLimit: String?
    var vfr = false
    var expectFt: Int?
    /// Minutes after departure the expected altitude comes.
    var expectMin: Int?
    var frequency: String?
    /// Whose frequency: "departure", "center", "approach".
    var facility: String?
    var squawk: String?
    /// "Cleared into the Class Bravo airspace" (14 CFR 91.131(a)(1)).
    var classB = false

    /// Whether anything of a clearance was heard at all.
    var heardAny: Bool {
        limit != nil || !route.isEmpty || asFiled || maintainFt != nil || expectFt != nil || frequency != nil || squawk != nil || classB
    }
}

/// A part of the route, in the order it was said: "vectors", "heading",
/// "airway", "departure", "arrival", or "places" (words naming one place
/// or more, for the planner to find).
struct ClearedItem: Codable, Equatable, Sendable {
    var kind: String
    var degrees: Int?
    var ident: String?
    var name: String?
    var number: String?
    var transition: String?
    var said: String?
}

extension Clearance {
    struct Token: Equatable {
        let word: String
        var num: String?
    }

    /// The ICAO alphabet (AIM 4-2-7, TBL 4-2-7), as a recognizer writes it.
    static let letters: [String: String] = [
        "alpha": "A", "alfa": "A", "bravo": "B", "charlie": "C", "delta": "D", "echo": "E", "foxtrot": "F", "golf": "G", "hotel": "H",
        "india": "I", "juliet": "J", "juliett": "J", "kilo": "K", "lima": "L", "mike": "M", "november": "N", "oscar": "O", "papa": "P",
        "quebec": "Q", "romeo": "R", "sierra": "S", "tango": "T", "uniform": "U", "victor": "V", "whiskey": "W", "whisky": "W",
        "xray": "X", "yankee": "Y", "zulu": "Z",
    ]
    /// Figures said one by one (AIM 4-2-7: "tree", "fife", "niner").
    static let digits: [String: String] = [
        "zero": "0", "one": "1", "two": "2", "three": "3", "tree": "3", "four": "4", "fower": "4", "five": "5", "fife": "5",
        "six": "6", "seven": "7", "eight": "8", "ait": "8", "nine": "9", "niner": "9",
    ]
    /// An airway's number said whole (AIM 4-2-8: "Victor Twelve").
    static let teens: [String: String] = [
        "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14", "fifteen": "15", "sixteen": "16",
        "seventeen": "17", "eighteen": "18", "nineteen": "19",
    ]
    static let tens: [String: String] = [
        "twenty": "2", "thirty": "3", "forty": "4", "fifty": "5", "sixty": "6", "seventy": "7", "eighty": "8", "ninety": "9",
    ]
    /// The letter each kind of airway is filed by, as said.
    static let airwayWords: [String: String] = [
        "victor": "V", "v": "V", "tango": "T", "t": "T", "j": "J", "jay": "J", "juliet": "J", "juliett": "J", "q": "Q", "quebec": "Q",
    ]

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }
    private static func isDigit(_ w: String) -> Bool { digits[w] != nil || matches(w, "^[0-9]$") }
    private static func digitOf(_ w: String) -> String { digits[w] ?? w }
    private static func isNumberWord(_ w: String?) -> Bool {
        guard let w else { return false }
        return isDigit(w) || teens[w] != nil || tens[w] != nil || matches(w, "^[0-9]+(\\.[0-9]+)?$")
    }

    /// The words, with each run of figures one number: "one two five
    /// point three five" is 125.35, "three thousand five hundred" 3500,
    /// "one zero thousand" 10000 (AIM 4-2-8, 4-2-9). After "thousand"
    /// only a "five hundred" goes on.
    static func tokens(_ text: String) -> [Token] {
        var lower = text.lowercased()
        lower = lower.replacingOccurrences(of: "x[- ]ray", with: "xray", options: .regularExpression)
        lower = lower.replacingOccurrences(of: "([0-9]),(?=[0-9]{3})", with: "$1", options: .regularExpression)
        let pattern = try! NSRegularExpression(pattern: "[0-9]+(?:\\.[0-9]+)?|[a-z]+(?:'[a-z]+)?")
        let ns = lower as NSString
        let words = pattern.matches(in: lower, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
        var out: [Token] = []
        var i = 0
        func word(_ k: Int) -> String? { k < words.count ? words[k] : nil }
        while i < words.count {
            let w = words[i]
            guard isNumberWord(w) else {
                out.append(Token(word: w))
                i += 1
                continue
            }
            var s = "", thousands = 0
            let start = i
            if matches(w, "^[0-9]+(\\.[0-9]+)?$"), !matches(w, "^[0-9]$") {
                s = w
                i += 1
            } else {
                while let x = word(i) {
                    if isDigit(x) || (x == "oh" && !s.isEmpty) {
                        s += x == "oh" ? "0" : digitOf(x)
                    } else if let teen = teens[x] {
                        s += teen
                    } else if let ten = tens[x] {
                        if let next = word(i + 1), isDigit(next), digitOf(next) != "0" {
                            s += ten + digitOf(next)
                            i += 1
                        } else {
                            s += ten + "0"
                        }
                    } else {
                        break
                    }
                    i += 1
                }
            }
            if word(i) == "thousand" {
                thousands = (Int(s) ?? 1) * 1000
                s = ""
                i += 1
                if let next = word(i), isDigit(next), word(i + 1) == "hundred" {
                    thousands += (Int(digitOf(next)) ?? 0) * 100
                    i += 2
                } else if let next = word(i), matches(next, "^[0-9]00$") {
                    thousands += Int(next) ?? 0
                    i += 1
                }
            } else if word(i) == "hundred", !s.isEmpty {
                thousands = (Int(s) ?? 0) * 100
                s = ""
                i += 1
            }
            if word(i) == "point" || word(i) == "decimal", let next = word(i + 1), isDigit(next), thousands == 0 {
                i += 1
                var fraction = ""
                while let x = word(i), isDigit(x) {
                    fraction += digitOf(x)
                    i += 1
                }
                s = "\(s).\(fraction)"
            }
            out.append(Token(word: words[start..<i].joined(separator: " "), num: thousands != 0 ? String(thousands + (Int(s) ?? 0)) : s))
        }
        return out
    }

    /// Aviation's VHF voice band, 118.000 to 136.975 MHz (47 CFR
    /// 87.173(b)'s table): a frequency out of it was misheard.
    static func frequencyOf(_ num: String) -> String? {
        let value: Double
        let places: Int
        if num.contains(".") {
            value = Double(num) ?? .nan
            places = max(1, num.split(separator: ".").last.map(\.count) ?? 1)
        } else if matches(num, "^1[123][0-9]{2,4}$") {
            value = Double("\(num.prefix(3)).\(num.dropFirst(3))") ?? .nan
            places = max(1, num.count - 3)
        } else {
            return nil
        }
        guard value >= 118, value <= 136.975 else { return nil }
        return String(format: "%.\(places)f", value)
    }

    /// A beacon code: one of AIM 4-1-20's 4096 discrete codes, four
    /// figures 0 to 7.
    static func isSquawk(_ code: String) -> Bool { matches(code, "^[0-7]{4}$") }

    static let altitudeWords: Set<String> = ["climb", "maintain", "descend", "cruise", "expect"]
    static let afterRoute: Set<String> = altitudeWords.union(["squawk", "contact", "transponder"])
    static let limitEnds: Set<String> = afterRoute.union(["via", "as", "then", "radar", "vectors", "direct", "fly", "heading"])
    static let between: Set<String> = ["then", "direct", "to", "and", "thence", "via", "the"]

    /// "departure" as the frequency's, not a SID's.
    private static func isFacility(_ toks: [Token], _ i: Int) -> Bool {
        guard i + 1 < toks.count else { return false }
        let next = toks[i + 1]
        return next.num != nil || ["control", "frequency", "freq", "will", "is", "on"].contains(next.word)
    }

    /// An altitude at `i` (AIM 4-2-9), with how many tokens it took.
    private static func altitudeAt(_ toks: [Token], _ i: Int) -> (ft: Int, used: Int)? {
        func tok(_ k: Int) -> Token? { k >= 0 && k < toks.count ? toks[k] : nil }
        if tok(i)?.word == "flight", tok(i + 1)?.word == "level", let n = tok(i + 2)?.num, let level = Int(n) { return (level * 100, 3) }
        if tok(i)?.word == "fl", let n = tok(i + 1)?.num, let level = Int(n) { return (level * 100, 2) }
        if let n = tok(i)?.num, !n.contains("."), let ft = Int(n), ft >= 500, ft < 60000 { return (ft, 1) }
        return nil
    }

    /// Words for a place as the planner looks them up: a run of the ICAO
    /// alphabet's words (with figures after them) is the letters it spells.
    private static func placeWords(_ toks: [Token]) -> String {
        var out: [String] = []
        var i = 0
        while i < toks.count {
            var j = i, spelled = ""
            while j < toks.count, letters[toks[j].word] != nil || (!spelled.isEmpty && toks[j].num.map { !$0.contains(".") } == true) {
                spelled += toks[j].num ?? letters[toks[j].word]!
                j += 1
            }
            if j - i >= 2 {
                out.append(spelled)
                i = j
            } else {
                out.append(toks[i].num ?? toks[i].word)
                i += 1
            }
        }
        return out.joined(separator: " ")
    }

    private static func routeOf(_ toks: [Token]) -> (route: [ClearedItem], asFiled: Bool) {
        var route: [ClearedItem] = []
        var asFiled = false
        var words: [Token] = []
        func flush() {
            let said = placeWords(words).trimmingCharacters(in: .whitespaces)
            if !said.isEmpty { route.append(ClearedItem(kind: "places", said: said)) }
            words = []
        }
        func tok(_ k: Int) -> Token? { k < toks.count ? toks[k] : nil }
        var i = 0
        while i < toks.count {
            let t = toks[i]
            if t.word == "as", tok(i + 1)?.word == "filed" {
                flush()
                asFiled = true
                i += 1
            } else if t.word == "radar", tok(i + 1)?.word == "vectors" {
                flush()
                route.append(ClearedItem(kind: "vectors"))
                i += 1
            } else if t.word == "vectors" {
                flush()
                route.append(ClearedItem(kind: "vectors"))
            } else if let letter = airwayWords[t.word], let n = tok(i + 1)?.num, matches(n, "^[0-9]{1,4}$"),
                      !words.contains(where: { letters[$0.word] != nil }) {
                flush()
                route.append(ClearedItem(kind: "airway", ident: letter + n))
                i += 1
            } else if t.word == "heading", let n = tok(i + 1)?.num {
                flush()
                route.append(ClearedItem(kind: "heading", degrees: Int(Double(n) ?? 0)))
                i += 1
            } else if t.word == "departure" || t.word == "arrival", words.count >= 2, let number = words.last?.num {
                let name = placeWords(Array(words.dropLast()))
                words = []
                var transition: String?
                if let end = toks.indices.first(where: { $0 > i && toks[$0].word == "transition" }), end - i <= 4 {
                    let said = placeWords(toks[(i + 1)..<end].filter { !between.contains($0.word) })
                    transition = said.isEmpty ? nil : said
                    i = end
                }
                route.append(ClearedItem(kind: t.word, name: name, number: number, transition: transition))
            } else if between.contains(t.word) || t.word == "fly" || t.word == "after" {
                flush()
            } else {
                words.append(t)
            }
            i += 1
        }
        flush()
        return (route, asFiled)
    }

    /// The clearance in what was heard: everything after "cleared" (the
    /// call sign before it left out), its altitudes, frequency and code
    /// wherever they were said.
    static func read(_ text: String) -> Clearance {
        let toks = tokens(text)
        func tok(_ k: Int) -> Token? { k >= 0 && k < toks.count ? toks[k] : nil }
        var out = Clearance()
        var rest = 0
        if let cleared = toks.firstIndex(where: { $0.word == "cleared" || $0.word == "clear" }) {
            var i = cleared + 1
            if ["into", "through"].contains(tok(i)?.word ?? "") {
                out.classB = toks[i..<min(i + 5, toks.count)].contains { $0.word == "bravo" || $0.word == "b" }
                if let airspace = toks.indices.first(where: { $0 > i && toks[$0].word == "airspace" }) { i = airspace + 1 } else { i += 4 }
            } else if ["for", "on"].contains(tok(i)?.word ?? "") || (tok(i)?.word == "to" && tok(i + 1)?.word == "land") {
                i = toks.count
            } else {
                if tok(i)?.word == "to" || tok(i)?.num == "2" { i += 1 }
                let start = i
                while i < toks.count, !limitEnds.contains(toks[i].word), !(toks[i].word == "departure" && isFacility(toks, i)) {
                    i += 1
                    if toks[i - 1].word == "airport" { break }
                }
                let limit = placeWords(toks[start..<i].filter { $0.word != "the" })
                out.limit = limit.isEmpty ? nil : limit
                let end = toks.indices.first { $0 >= i && (afterRoute.contains(toks[$0].word) || (toks[$0].word == "departure" && isFacility(toks, $0))) }
                let (route, asFiled) = routeOf(Array(toks[i..<(end ?? toks.count)]))
                out.route = route
                out.asFiled = asFiled
                i = end ?? toks.count
            }
            rest = i
        }
        var i = rest
        while i < toks.count {
            let t = toks[i]
            if (t.word == "maintain" || t.word == "cruise") && out.maintainFt == nil {
                var k = i + 1
                if tok(k)?.word == "vfr" { out.vfr = true; k += 1 }
                if tok(k)?.word == "at", tok(k + 1)?.word == "or", let side = tok(k + 2)?.word, side == "below" || side == "above" {
                    out.maintainLimit = "at or \(side)"
                    k += 3
                }
                if let alt = altitudeAt(toks, k) {
                    out.maintainFt = alt.ft
                    i = k + alt.used - 1
                }
            } else if t.word == "expect" && out.expectFt == nil {
                if let alt = altitudeAt(toks, i + 1) {
                    out.expectFt = alt.ft
                    i += alt.used
                    let after = (i + 1)..<min(i + 4, toks.count)
                    if let minutes = after.first(where: { ["minutes", "minute", "min"].contains(toks[$0].word) }), minutes - i > 1,
                       let n = toks[minutes - 1].num {
                        out.expectMin = Int(n)
                    }
                }
            } else if t.word == "squawk" || t.word == "transponder" || t.word == "code" {
                if let code = toks[(i + 1)..<min(i + 3, toks.count)].first(where: { $0.num != nil })?.num, isSquawk(code), out.squawk == nil {
                    out.squawk = code
                }
            } else if let num = t.num, out.frequency == nil {
                let said = toks[max(0, i - 4)..<i].map(\.word)
                let facility = said.reversed().first { ["departure", "center", "approach", "tower", "ground", "clearance"].contains($0) }
                if let frequency = frequencyOf(num), facility != nil || said.contains("contact") || said.contains("frequency") {
                    out.frequency = frequency
                    out.facility = facility
                }
            }
            i += 1
        }
        return out
    }
}

/// What the planner found of a clearance's places (ClearancePlaces).
struct ClearancePlaces: Codable, Equatable, Sendable {
    struct Place: Codable, Equatable, Sendable {
        var said: String
        var ident: String?
        var name: String?
        var kind: String?
        var sure: Bool?
    }
    struct Procedure: Codable, Equatable, Sendable {
        var id: String
        var transition: String?
    }
    var limit: Place?
    var route: [[Place]]?
    var departure: Procedure?
    var arrival: Procedure?
}

/// What the planner is asked to find (ClearanceAsk).
struct ClearanceAsk: Encodable, Sendable {
    struct Procedure: Encodable, Sendable { let name: String; let number: String; let transition: String? }
    var near = ""
    var dep: String?
    var dest: String?
    var limit: String?
    var route: [String] = []
    var departure: Procedure?
    var arrival: Procedure?
}

extension Clearance {
    /// The planner's question for the clearance's places.
    func asked(near: String, dep: String, dest: String) -> ClearanceAsk {
        func named(_ kind: String) -> ClearanceAsk.Procedure? {
            route.first { $0.kind == kind }.map { ClearanceAsk.Procedure(name: $0.name ?? "", number: $0.number ?? "", transition: $0.transition) }
        }
        return ClearanceAsk(near: near, dep: dep.isEmpty ? nil : dep, dest: dest.isEmpty ? nil : dest, limit: limit,
                            route: route.compactMap { $0.kind == "places" ? $0.said : nil },
                            departure: named("departure"), arrival: named("arrival"))
    }

    /// Two idents one field: "KDLH" and "DLH" (the web's sameField).
    static func sameField(_ a: String, _ b: String) -> Bool {
        func bare(_ ident: String) -> String {
            ident.trimmingCharacters(in: .whitespaces).uppercased().replacingOccurrences(of: "^K(?=[A-Z0-9]{3}$)", with: "", options: .regularExpression)
        }
        return bare(a) == bare(b)
    }

    /// A procedure to pick, as the web's typed one: its name and the
    /// points either side of it.
    struct Typed: Codable, Equatable, Sendable {
        let name: String
        let before: String?
        let after: String?
    }

    /// The route this clearance gives, from the one planned: its
    /// destination the limit where that is an airport; its stops the
    /// places and airways said in order, the SID's transition after the
    /// departure and the STAR's before the destination; with "then as
    /// filed" the filed stops after the last one said that is among them,
    /// or all of them where none is (AIM 5-2-6). The web's clearedRoute.
    func clearedRoute(_ found: ClearancePlaces, dep: String, stops planned: [String], dest plannedDest: String) -> (dep: String, stops: [String], dest: String, typed: [Typed]) {
        let dest = found.limit?.kind == "airport" ? (found.limit?.ident ?? plannedDest) : plannedDest
        var said: [String] = []
        var typed: [Typed] = []
        var run = 0
        for item in route {
            switch item.kind {
            case "places":
                said += (found.route.flatMap { run < $0.count ? $0[run] : nil } ?? []).compactMap(\.ident)
                run += 1
            case "airway":
                if let ident = item.ident { said.append(ident) }
            case "departure":
                if let departure = found.departure {
                    typed.append(Typed(name: departure.id, before: dep.isEmpty ? nil : dep, after: departure.transition))
                    if let transition = departure.transition { said.append(transition) }
                }
            case "arrival":
                if let arrival = found.arrival {
                    if let transition = arrival.transition { said.append(transition) }
                    typed.append(Typed(name: arrival.id, before: arrival.transition, after: dest.isEmpty ? nil : dest))
                }
            default:
                break
            }
        }
        var stops = said
        if asFiled {
            let last = said.reversed().first { s in !FilingForm.airwayToken(s) && planned.contains { Self.sameField($0, s) } }
            let from = last.flatMap { l in planned.firstIndex { Self.sameField($0, l) } }.map { $0 + 1 } ?? 0
            stops = said + planned[from...]
        }
        let ends = stops
        stops = ends.enumerated().filter { i, s in !(i == 0 && Self.sameField(s, dep)) && !(i == ends.count - 1 && Self.sameField(s, dest)) }.map(\.element)
        stops = stops.enumerated().filter { i, s in i == 0 || !Self.sameField(s, stops[i - 1]) }.map(\.element)
        return (dep, Array(stops.prefix(16)), dest, typed)
    }
}
