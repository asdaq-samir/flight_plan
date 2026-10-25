import Foundation
import UIKit
import Vision

/// The planning figures on a handbook's specifications page, read off a
/// photo of it on the phone: Apple's Vision reads the words (no key, no
/// server, works offline), and the parser the web app has
/// (lib/handbookText.ts, kept the same) finds the figures by their
/// labels, in knots where the page prints mph. Each comes with the line
/// it was read from, for the pilot to check against the page before
/// saving; one the page does not label plainly is not guessed.
enum Handbook {
    struct Figure: Equatable, Sendable {
        let value: Double
        let words: String
    }

    struct Figures: Equatable, Sendable {
        var cruiseTasKt: Figure?
        var cruisePowerPct: Figure?
        var fuelBurnGph: Figure?
        var usableFuelGal: Figure?
        var climbTasKt: Figure?
        var serviceCeilingFt: Figure?

        var isEmpty: Bool { cruiseTasKt == nil && cruisePowerPct == nil && fuelBurnGph == nil && usableFuelGal == nil && climbTasKt == nil && serviceCeilingFt == nil }
        var words: [String] { [cruiseTasKt, cruisePowerPct, fuelBurnGph, usableFuelGal, climbTasKt, serviceCeilingFt].compactMap { $0?.words } }
    }

    /// A statute mile an hour in knots: 1,609.344 m / 1,852 m.
    static let mphToKt = 1609.344 / 1852

    /// The words on the page, top to bottom, one line each.
    static func read(_ image: UIImage) async throws -> String {
        guard let cg = image.cgImage else { return "" }
        var request = RecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let observations = try await request.perform(on: cg, orientation: .up)
        // Top to bottom: Vision's boxes have their origin at the bottom.
        return observations.sorted { $0.boundingBox.origin.y > $1.boundingBox.origin.y }
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    // MARK: - The parser, as lib/handbookText.ts has it

    private static func matches(_ pattern: String, _ s: String) -> Bool {
        s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func group(_ pattern: String, _ s: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)), m.numberOfRanges > 1,
              let r = Range(m.range(at: 1), in: s) else { return nil }
        return String(s[r])
    }

    /// The page's lines, a label wrapped onto the next line put back on
    /// one: a line with a bracket left open, or with no figure at its end,
    /// goes on with the next.
    static func entries(_ text: String) -> [String] {
        var out: [String] = []
        var open = ""
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let joined = open.isEmpty ? line : "\(open) \(line)"
            let opens = joined.filter { $0 == "(" }.count, closes = joined.filter { $0 == ")" }.count
            let unclosed = opens > closes
            let endsWithFigure = matches("\\d[\\d,.]*\\D{0,12}$", joined)
            if (unclosed || !endsWithFigure) && joined.count < 160 {
                open = joined
                continue
            }
            out.append(joined)
            open = ""
        }
        if !open.isEmpty { out.append(open) }
        return out
    }

    /// A figure as printed: "14,300", "8.4", and "14.300" where the reading
    /// took a thousands comma for a point.
    static func number(_ s: String) -> Double? {
        let t = s.replacingOccurrences(of: ",", with: "")
        if matches("^\\d{1,2}\\.\\d{3}$", t) { return Double(t.replacingOccurrences(of: ".", with: "")) }
        return Double(t)
    }

    /// The line's figure: its last number outside brackets.
    static func figure(_ line: String) -> Double? {
        let bare = line.replacingOccurrences(of: "\\([^)]*\\)", with: " ", options: .regularExpression)
        guard let re = try? NSRegularExpression(pattern: "\\d[\\d,]*(?:\\.\\d+)?") else { return nil }
        let all = re.matches(in: bare, range: NSRange(bare.startIndex..., in: bare)).compactMap { Range($0.range, in: bare).map { String(bare[$0]) } }
        return all.last.flatMap(number)
    }

    /// Knots, from a line that says miles an hour where it does: its own
    /// units, outside brackets, first -- "122 KTS (140 MPH)" is knots --
    /// and a unit in brackets only where none is outside them.
    static func knots(_ line: String, _ value: Double) -> Double {
        let bare = line.replacingOccurrences(of: "\\([^)]*\\)", with: " ", options: .regularExpression)
        let kt = "\\bkts?\\b|\\bknots?\\b|\\bktas\\b", mph = "\\bmph\\b|miles per hour|\\bm\\.?p\\.?h\\b"
        if matches(kt, bare) { return value }
        return matches(mph, bare) || matches(mph, line) ? (value * mphToKt).rounded() : value
    }

    static func power(_ line: String) -> Double? { group("(\\d{2,3})\\s*%", line).flatMap(Double.init) }

    static func figures(of text: String) -> Figures {
        let lines = entries(text)
        var found = Figures()
        func within(_ n: Double?, _ lo: Double, _ hi: Double) -> Bool { n.map { $0 >= lo && $0 <= hi } ?? false }

        for line in lines {
            let n = figure(line)
            if found.serviceCeilingFt == nil, matches("service\\s+ceiling", line), within(n, 1000, 30000) {
                found.serviceCeilingFt = Figure(value: n!, words: line)
            }
            if found.climbTasKt == nil, matches("climb", line), matches("speed", line), within(n, 30, 300) {
                found.climbTasKt = Figure(value: knots(line, n!), words: line)
            }
            if found.usableFuelGal == nil, matches("usable", line), !matches("unusable", line) {
                let v = group("usable[^\\d]{0,40}(\\d[\\d,.]*)", line).flatMap(number) ?? n
                if within(v, 5, 500) { found.usableFuelGal = Figure(value: v!, words: line) }
            }
        }

        // Cruise: of the page's cruising speeds, the one at a stated
        // altitude, at 75% power where it says, over one at sea level or at
        // a lower, training power; never the structural cruising speed.
        let cruises = lines.filter { l in
            matches("cruis", l) && !matches("structural|\\bv\\s*no\\b", l) && matches("speed|knots|\\bkts?\\b|mph", l) && within(figure(l), 30, 400)
        }.map { l -> (line: String, score: Int) in
            let altitude = matches("\\d{3,5}\\s*(ft|feet)", l) && !matches("sea\\s*level", l)
            return (l, (altitude ? 2 : 0) + (power(l) == 75 ? 1 : 0))
        }
        if let cruise = cruises.max(by: { $0.score < $1.score }) {
            found.cruiseTasKt = Figure(value: knots(cruise.line, figure(cruise.line)!), words: cruise.line)
            if let pct = power(cruise.line), within(pct, 40, 100) { found.cruisePowerPct = Figure(value: pct, words: cruise.line) }
        }

        // Fuel burn: the one at the cruise's power where the page gives
        // several, the figure after that power where two share a line.
        let burns = lines.filter { l in matches("fuel\\s+(consumption|flow|burn)|gal(lons)?\\.?\\s*(per|/)\\s*h(ou)?r|\\bgph\\b", l) && within(figure(l), 1, 100) }
        let burn = burns.first { found.cruisePowerPct != nil && power($0) == found.cruisePowerPct!.value } ?? burns.first
        if let burn {
            let pct = found.cruisePowerPct?.value
            let bare = burn.replacingOccurrences(of: "\\([^)]*\\)", with: " ", options: .regularExpression)
            let after = pct.flatMap { group("\\b\(Int($0))\\s*%[^\\d]{0,20}(\\d+(?:\\.\\d+)?)", bare) }.flatMap(number)
            let v = after ?? figure(burn)
            if within(v, 1, 100) { found.fuelBurnGph = Figure(value: v!, words: burn) }
        }
        return found
    }
}
