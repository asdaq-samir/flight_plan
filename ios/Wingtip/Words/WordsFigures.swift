import Foundation

/// The figures the words rest on, as the phone assembles them from the
/// briefing and the Go / No-Go it has already (nothing is fetched here),
/// with the planner's own ids (app.routers.words: "metar:KMSN",
/// "taf:KMSN", "hazard:0", "gairmet:0", "pirep:0", "tfr:<notam id>",
/// "below-vfr:KMSN", "vfr-not-recommended", "unchecked", "verdict:line",
/// "finding:fuel", "risk:line", "risk:<factor>"), so a chip means the
/// same thing whichever model wrote the sentence. Each figure's text is
/// the report as sent, or the planner's own line about it; none is
/// computed here.
enum WordsFigures {
    /// The flight itself, for a sentence to name the route.
    static func flight(dep: String, dest: String, stops: [String], eteMin: Double?) -> WordsSource {
        var line = "\(dep) to \(dest)" + (stops.isEmpty ? "" : " by \(stops.joined(separator: ", "))") + "."
        if let eteMin { line += " \(Int(eteMin.rounded())) minutes in the air." }
        return WordsSource(id: "flight:route", label: "The flight", text: line)
    }

    /// "From 3,000 to 12,000 ft", where both are given.
    private static func altitudes(_ low: Double?, _ high: Double?) -> String? {
        guard let low, let high else { return nil }
        return "From \(Formats.grouped(low)) to \(Formats.grouped(high)) ft."
    }

    /// Where and when the flight meets something, as the Brief's row says it.
    private static func meets(_ on: OnRoute?) -> String? {
        on.map { "On the route: \(BriefLegs.line($0))." }
    }

    /// Every figure of a briefing a sentence can rest on, in the Brief's
    /// order: what could not be checked, the reasons not to go VFR, the
    /// fields below VFR, each METAR, each TAF station, the hazards, the
    /// G-AIRMETs, the pilot reports and the TFRs.
    static func weather(_ b: Briefing, dep: String, dest: String, stops: [String], eteMin: Double?) -> [WordsSource] {
        var out = [flight(dep: dep, dest: dest, stops: stops, eteMin: eteMin)]
        if !b.weatherUnavailable.isEmpty {
            out.append(WordsSource(id: "unchecked", label: "Not checked",
                                   text: "Could not be checked, the source did not answer: \(b.weatherUnavailable.joined(separator: ", "))."))
        }
        if let reasons = b.vfrNotRecommended, !reasons.isEmpty {
            out.append(WordsSource(id: "vfr-not-recommended", label: "VFR flight not recommended",
                                   text: "VFR flight not recommended (AIM 7-1-5): \(reasons.joined(separator: "; "))."))
        }
        for f in b.fieldsBelowVfr ?? [] {
            let ceiling = f.ceilingFt.map { "ceiling \(Formats.grouped($0)) ft" } ?? "no ceiling"
            let visibility = f.visibilitySm.map { "visibility \(Formats.number($0, decimals: 1)) sm" } ?? "visibility not reported"
            out.append(WordsSource(id: "below-vfr:\(f.ident)", label: "\(f.ident) below VFR",
                                   text: "\(f.ident) is below VFR where the flight meets it, by its \(f.source)\(f.flightCategory.map { " (\($0))" } ?? ""): \(ceiling), \(visibility). \(meets(f.onRoute) ?? "")"))
        }
        for ident in b.metars.keys.sorted() {
            if let metar = b.metars[ident] ?? nil, let raw = metar.raw {
                let category = metar.flightCategory ?? "no category"
                out.append(WordsSource(id: "metar:\(ident)", label: "\(ident) METAR, \(category)", text: raw))
            } else {
                out.append(WordsSource(id: "metar:\(ident)", label: "\(ident) METAR", text: "No METAR reported for \(ident)."))
            }
        }
        // Each TAF station by the planner's names (ForecastStation: icaoId,
        // and ceiling_ft and visibility_sm, the worst over the flight).
        for s in b.forecast.stations {
            let ident = s.icaoId
            var lines: [String] = []
            let ceiling = s.ceilingFt.map { "ceiling \(Formats.grouped($0)) ft" } ?? "no ceiling"
            let visibility = s.visibilitySm.map { "visibility \(Formats.number($0, decimals: 1)) sm" } ?? "visibility not reported"
            lines.append("Worst over the flight: \(ceiling), \(visibility).")
            if let raw = s.raw { lines.append(raw) }
            out.append(WordsSource(id: "taf:\(ident)", label: "\(ident) TAF", text: lines.joined(separator: "\n")))
        }
        for (i, h) in b.hazards.enumerated() {
            let kind = h.type ?? "SIGMET"
            let what = h.hazard ?? ""
            let text = [h.raw ?? "\(kind): \(what).", altitudes(h.altitudeLowFt, h.altitudeHighFt), meets(h.onRoute)].compactMap { $0 }.joined(separator: " ")
            out.append(WordsSource(id: "hazard:\(i)", label: "\(kind), \(what)", text: text))
        }
        for (i, g) in (b.gairmets ?? []).enumerated() {
            let title = [g.hazard, g.severity].compactMap { $0 }.joined(separator: " · ")
            var lines = ["G-AIRMET: \(title)."]
            if let due = g.dueTo { lines.append("Due to \(due).") }
            // AWC gives an IFR G-AIRMET a top of -1, which is no top (the
            // web's gairmetAltitudes): such a one has no altitude line.
            if let high = g.altitudeHighFt, high > 0 {
                lines.append("From \(g.altitudeLowFt.map { "\(Formats.grouped($0)) ft" } ?? "the surface") to \(Formats.grouped(high)) ft.")
            }
            if let at = g.validAt { lines.append("Valid at \(at).") }
            if let on = meets(g.onRoute) { lines.append(on) }
            out.append(WordsSource(id: "gairmet:\(i)", label: "G-AIRMET, \(title)", text: lines.joined(separator: " ")))
        }
        for (i, p) in (b.pireps ?? []).enumerated() {
            var lines = [p.raw ?? "Pilot report."]
            if p.urgent == true { lines.append("Urgent.") }
            if let on = meets(p.onRoute) { lines.append(on) }
            let label = "Pilot report" + (p.altitudeFt.map { " at \(Formats.grouped($0)) ft" } ?? "")
            out.append(WordsSource(id: "pirep:\(i)", label: label, text: lines.joined(separator: " ")))
        }
        for t in b.tfrs ?? [] {
            var lines = ["TFR \(t.notamId)" + (t.title.map { ": \($0)" } ?? "") + "."]
            lines.append("\(Formats.nm(t.alongTrackNm, decimals: 0)) along the route" + (t.crosses ? ", which crosses it" : "") + (t.activeNow ? ", active now" : "") + ".")
            if let a = altitudes(t.floorFt, t.ceilingFt) { lines.append(a) }
            if let from = t.effective { lines.append("From \(from)" + (t.expires.map { " to \($0)" } ?? "") + ".") }
            if let on = meets(t.onRoute) { lines.append(on) }
            out.append(WordsSource(id: "tfr:\(t.notamId)", label: "TFR \(t.notamId)", text: lines.joined(separator: " ")))
        }
        return out
    }

    /// Every figure of the Go / No-Go a sentence can rest on: its line,
    /// each finding, the risk assessment and every factor it counted.
    static func risk(_ v: GoNoGoAnswer) -> [WordsSource] {
        var out = [WordsSource(id: "verdict:line", label: "Go / No-Go", text: "\(v.line.finding): \(v.line.words)")]
        out += v.items.map { WordsSource(id: "finding:\($0.key)", label: "\($0.label): \($0.finding)", text: $0.detail) }
        if let risk = v.risk {
            out.append(WordsSource(id: "risk:line", label: "Risk assessment", text: "\(risk.line). \(risk.words) \(risk.score) points, level \(risk.level)."))
            for f in risk.factors ?? [] {
                let unlawful = f.stop == true ? " Makes the flight unlawful as planned." : ""
                out.append(WordsSource(id: "risk:\(f.key)", label: f.label, text: "\(f.why ?? f.label). \(f.points) points.\(unlawful)"))
            }
        }
        return out
    }
}

/// POST /api/words/weather's body (app.routers.words.WeatherAsk): the
/// briefing's own parameters, so the planner reads the same briefing.
struct WeatherWordsAsk: Encodable, Equatable, Sendable {
    var dep: String
    var dest: String
    var stops: [String] = []
    var eteMin: Double?
    var fixes = ""
    var legMin = ""
}

/// POST /api/words/risk's body (app.routers.words.RiskAsk): the Go /
/// No-Go as the planner answered it, the parts its words read (the
/// loading and the balance are left out: the phone keeps only the parts
/// of them its pages show, and the planner reads neither for the words),
/// and the pilot's own record where the phone has one.
struct RiskWordsAsk: Encodable, Equatable, Sendable {
    struct Verdict: Encodable, Equatable, Sendable {
        var line: VerdictLine
        var items: [VerdictItem]
        var risk: RiskAssessment?
        var selfChecks: [RiskCheck]
    }

    var verdict: Verdict
    var pilot: [String: String]?

    init(_ answer: GoNoGoAnswer, pilot: [String: String]? = nil) {
        verdict = Verdict(line: answer.line, items: answer.items, risk: answer.risk, selfChecks: answer.selfChecks ?? [])
        self.pilot = pilot
    }
}
