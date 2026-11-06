import Foundation

/// What a line typed or said into the one field means (StripFieldRow): a
/// route of idents, a place by name, one of the app's screens by its
/// word, a field's card, or a question for the assistant. The web app's
/// features/strip/fieldCommands.ts, rule for rule, with its cases as
/// tests (StripTests); pure, so the doing is the sheet's
/// (StripSheetView).
///
/// The order matters: a screen's word first ("brief", "my airplane"), so
/// "brief me" opens the Brief rather than asking about a field called
/// BRIEF; then a field's card asked for by its ident; then idents alone,
/// which are a route; then a short name with no question in it, which is
/// a place to fly to; everything else is asked.

/// The screens the field opens by their word.
enum FieldScreen: String, CaseIterable, Equatable, Sendable {
    case airplane, logbook, settings, instructor, brief, nearest, fuel, food, stops
    case routes, altitude, procedures, navlog, profile, share, file, clearance, dryrun
    case saved, favorites, recents, recentRoutes, radio, map
}

enum FieldCommand: Equatable, Sendable {
    /// Idents alone: one is the destination, from the route's departure or
    /// where the airplane is; two are the ends; more are the ends and the
    /// stops between.
    case route(dep: String?, stops: [String], dest: String)
    /// A place by name ("Duluth", "to Las Vegas"), for the places search
    /// and the biggest field by it.
    case place(String)
    case open(FieldScreen)
    /// A field's card, not a route to it: "about KDLH", "KDLH info".
    case field(String)
    case ask(String)
}

enum FieldCommands {
    /// Each screen's words, whole, after the filler is taken off.
    static let screenWords: [String: FieldScreen] = [
        "airplane": .airplane, "my airplane": .airplane, "plane": .airplane, "aircraft": .airplane, "my aircraft": .airplane,
        "airplanes": .airplane, "weight and balance": .airplane, "w&b": .airplane, "checklist": .airplane, "poh": .airplane,
        "logbook": .logbook, "log book": .logbook, "my logbook": .logbook, "currency": .logbook, "endorsements": .logbook,
        "settings": .settings, "setup": .settings, "account": .settings, "sign in": .settings, "sign out": .settings,
        "training": .settings, "pilot guide": .settings, "guide": .settings, "mock oral": .settings, "passenger briefing": .settings,
        "instructor": .instructor, "my instructor": .instructor,
        "brief": .brief, "brief me": .brief, "briefing": .brief, "the brief": .brief, "go no go": .brief, "go/no-go": .brief,
        "nearest": .nearest, "nearest airport": .nearest, "nearest airports": .nearest, "nrst": .nearest,
        "fuel": .fuel, "nearest fuel": .fuel, "gas": .fuel, "avgas": .fuel, "fuel stop": .fuel, "fuel stops": .fuel,
        "food": .food, "nearest food": .food, "eat": .food, "lunch": .food, "fly-in food": .food,
        "stops": .stops, "stop": .stops, "rest stops": .stops, "where to stop": .stops,
        "routes": .routes, "route options": .routes, "other routes": .routes, "ways": .routes,
        "altitude": .altitude, "altitudes": .altitude, "cruise altitude": .altitude,
        "procedures": .procedures, "procedure": .procedures, "approaches": .procedures, "approach": .procedures, "plates": .procedures,
        "pattern": .procedures, "traffic pattern": .procedures, "runways": .procedures, "runway": .procedures,
        "nav log": .navlog, "navlog": .navlog, "legs": .navlog, "checkpoints": .navlog, "the log": .navlog,
        "profile": .profile, "side view": .profile, "terrain": .profile,
        "share": .share, "export": .share, "print": .share, "save": .share, "send": .share,
        "file": .file, "file it": .file, "flight plan": .file, "file flight plan": .file, "file a flight plan": .file,
        "clearance": .clearance, "read back": .clearance, "readback": .clearance,
        "dry run": .dryrun, "dryrun": .dryrun, "fly it on paper": .dryrun, "replay": .dryrun,
        "saved": .saved, "saved flights": .saved, "my flights": .saved, "flights": .saved,
        "favorites": .favorites, "favourites": .favorites, "home": .favorites,
        "recents": .recents, "recent": .recents, "recent airports": .recents,
        "recent routes": .recentRoutes, "routes planned": .recentRoutes, "last routes": .recentRoutes, "history": .recentRoutes,
        "radio": .radio, "listen": .radio, "atc": .radio,
        "map": .map, "map settings": .map, "charts": .map, "layers": .map,
    ]

    /// Words that only ask for a screen, taken off its front, the longer
    /// first so "show me" is not left as "me".
    private static let filler = Rx(#"^(?:please\s+)?(?:let me see|show me|give me|take me to|go to|open|show|get|see|the|my)\s+"#)

    /// A word that makes a line a question for the assistant, not a place.
    private static let questionWords: Set<String> = [
        "what", "what's", "whats", "how", "how's", "is", "are", "am", "can", "could", "should", "will", "would", "do", "does", "did",
        "why", "when", "where", "which", "who", "if", "tell", "explain", "weather", "wind", "winds", "metar", "taf", "notam", "notams",
        "tfr", "tfrs", "ceiling", "visibility", "forecast", "minimums", "legal", "me", "i", "we", "my", "the", "about", "with",
    ]

    /// The words between idents in a route, as typed or said: "to", "via",
    /// "from", "then", "and", an arrow or a comma.
    private static let routeJoiners: Set<String> = ["to", "via", "from", "then", "and", "through", "stopping", "at", "->", "→", ">", "-"]

    private static let trailingPunctuation = Rx(#"[.!?]+$"#)
    private static let trailingStop = Rx(#"[.!]+$"#)
    private static let identShape = Rx(#"^[A-Z0-9]{3,4}$"#)
    private static let digit = Rx(#"\d"#)
    private static let placeTo = Rx(#"^(?:(?:please\s+)?(?:plan(?:\s+a)?(?:\s+trip|\s+route|\s+flight)?|fly|go|route|take me|direct|head|let's go|lets go)\s+)?to\s+(.+)$"#)
    private static let fieldAsked = Rx(#"^(?:(?:about|info(?: on)?|tell me about|what about)\s+(\S+)|(\S+)\s+(?:card|info|airport|field|details))$"#)

    /// An airport ident, normalized (trimmed, uppercased) and shape-checked:
    /// three or four letters and digits, as the web's lib/identSchema
    /// identOf and the gateway's SaveFlightRequest hold it; "" otherwise.
    static func identOf(_ value: String) -> String {
        let ident = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return identShape.matches(ident) ? ident : ""
    }

    private static func screenOf(_ text: String) -> FieldScreen? {
        var bare = trailingPunctuation.removing(from: text.lowercased()).trimmed
        var i = 0
        while i < 3 && filler.matches(bare) {
            bare = filler.removing(from: bare).trimmed
            i += 1
        }
        return screenWords[bare]
    }

    /// A word that is a field's ident as typed: three or four letters and
    /// digits with a digit in them (C81, 5Y8, 06C), four letters in any
    /// case (KDLH, kdlh), or three letters in capitals (ORD, DLH) -- typed
    /// small, three letters are a word ("fly", "see"), not a field.
    private static func identTyped(_ word: String) -> String {
        let ident = identOf(word)
        if ident.isEmpty { return "" }
        if digit.matches(ident) || ident.count == 4 { return ident }
        return word == ident ? ident : ""
    }

    /// Idents alone, in order, with the route's joiners between them; nil
    /// where any word is not an ident. "KDLH from C81" is C81 to KDLH; the
    /// idents after "via" are stops wherever they are said ("C81 to KDLH
    /// via KJVL"), up to the next "to".
    private static func routeOf(_ text: String) -> (dep: String?, stops: [String], dest: String)? {
        let spaced = text.map { ",→>".contains($0) ? " " : $0 }
        let words = String(spaced).split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if words.isEmpty { return nil }
        var idents: [String] = []
        var via: [String] = []
        var fromAt = -1
        var viaRun = false
        for word in words {
            let lower = word.lowercased()
            if routeJoiners.contains(lower) {
                if lower == "from" {
                    fromAt = idents.count
                    viaRun = false
                } else if lower == "via" || lower == "through" || lower == "stopping" {
                    viaRun = true
                } else if lower == "to" {
                    viaRun = false
                }
                continue
            }
            let ident = identTyped(word)
            if ident.isEmpty { return nil }
            if viaRun { via.append(ident) } else { idents.append(ident) }
        }
        if idents.isEmpty { return nil }
        // "KDLH from C81": the ident after "from" is the departure.
        if fromAt > 0 && fromAt < idents.count {
            let dep = idents[fromAt]
            var rest = idents
            rest.remove(at: fromAt)
            let dest = rest.removeLast()
            return (dep, rest + via, dest)
        }
        if idents.count == 1 { return (nil, via, idents[0]) }
        return (idents[0], Array(idents.dropFirst().dropLast()) + via, idents[idents.count - 1])
    }

    /// A place by name: "to Duluth", "fly to Las Vegas", "plan a trip to
    /// Madison", or a short name with no question in it.
    private static func placeOf(_ text: String) -> String? {
        let bare = trailingStop.removing(from: text.trimmed)
        if bare.contains("?") { return nil }
        if let to = placeTo.groups(in: bare)?[1] {
            let place = to.trimmed
            return place.isEmpty ? nil : place
        }
        let words = bare.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if words.isEmpty || words.count > 3 { return nil }
        if words.contains(where: { questionWords.contains($0.lowercased()) }) { return nil }
        return bare
    }

    /// A field's card asked for by its ident: "about KDLH", "info on C81",
    /// "KDLH card", "KDLH airport".
    private static func fieldOf(_ text: String) -> String? {
        guard let groups = fieldAsked.groups(in: text.trimmed) else { return nil }
        let ident = identTyped(groups[1] ?? groups[2] ?? "")
        return ident.isEmpty ? nil : ident
    }

    /// What the line means; nil for nothing typed.
    static func read(_ text: String) -> FieldCommand? {
        let line = text.trimmed
        if line.isEmpty { return nil }
        if let screen = screenOf(line) { return .open(screen) }
        if let field = fieldOf(line) { return .field(field) }
        if let route = routeOf(line) { return .route(dep: route.dep, stops: route.stops, dest: route.dest) }
        if let place = placeOf(line) {
            // "fly to kdlh": the place named is a field's ident, the route's end.
            if let named = routeOf(place) { return .route(dep: named.dep, stops: named.stops, dest: named.dest) }
            return .place(place)
        }
        return .ask(line)
    }
}

/// A regular expression as the web's parser writes them, case-insensitive,
/// with the three asks the parser makes of one: does it match, the text
/// with the match taken out, and the match's groups.
struct Rx {
    private let expression: NSRegularExpression

    init(_ pattern: String) {
        // The patterns are the parser's own constants, written here.
        expression = try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    private func whole(_ text: String) -> NSRange { NSRange(text.startIndex..., in: text) }

    func matches(_ text: String) -> Bool {
        expression.firstMatch(in: text, range: whole(text)) != nil
    }

    /// The text with the first match taken out (JavaScript's replace with "").
    func removing(from text: String) -> String {
        guard let match = expression.firstMatch(in: text, range: whole(text)), let range = Range(match.range, in: text) else { return text }
        var out = text
        out.removeSubrange(range)
        return out
    }

    /// The first match's groups, the whole match at 0; nil for a group
    /// that did not take part, and nil for no match.
    func groups(in text: String) -> [String?]? {
        guard let match = expression.firstMatch(in: text, range: whole(text)) else { return nil }
        return (0..<match.numberOfRanges).map { i in
            Range(match.range(at: i), in: text).map { String(text[$0]) }
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
