import SwiftUI

/// How the four planner-worked pages write a figure the planner sent: a
/// figure signed, a share. Formatting only; the figures and the rules are
/// the planner's (app.figures), and a direction, feet or a tolerance are
/// written as AirportWords writes them.
enum FigureWords {
    /// "+300 ft", "−2 min", "0 ft".
    static func signed(_ value: Double, _ unit: String) -> String {
        let whole = Int(value.rounded())
        return "\(whole > 0 ? "+" : whole < 0 ? "−" : "")\(abs(whole).formatted())\(unit)"
    }

    static func percent(_ share: Double) -> String { "\(Int((share * 100).rounded()))%" }
}

/// A mark beside a finding: within its tolerance or not.
struct WithinMark: View {
    let ok: Bool
    var body: some View {
        Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
            .foregroundStyle(ok ? .green : .red)
            .accessibilityLabel(ok ? "Within" : "Outside")
    }
}

// MARK: - The debrief

/// The debrief of a saved flight's track (the web app's FlightPage
/// Findings): the planner reads the track against the flight's nav log
/// (POST /api/debrief, ACS PA.VI.A) -- the flight in a line, leg by leg,
/// the checkpoints and the patterns, each with its mark. GPS altitude is
/// not the altimeter's, and a ground track is not a heading.
struct DebriefSections: View {
    let flight: Int64
    let points: [SavedTrackPoint]
    @State private var answer: DebriefAnswer?
    @State private var loaded = false
    @State private var problem: String?

    var body: some View {
        Section("Debrief") {
            if let d = answer?.debrief {
                LabeledContent("Took off", value: Date(timeIntervalSince1970: d.takeoff / 1000).formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                LabeledContent {
                    Text(hoursMinutes(d.flownMin)).monospacedDigit()
                } label: {
                    Text("In the air")
                    if let planned = d.plannedMin { Text("\(hoursMinutes(planned)) planned") }
                }
                ForEach(d.notes, id: \.self) { note in Text(note).font(.subheadline).foregroundStyle(.orange) }
            } else if loaded, answer != nil {
                Text("No flight in this track: it never went faster than taxiing.").foregroundStyle(.secondary)
            } else if let problem {
                Text(problem).font(.footnote).foregroundStyle(.red)
            } else {
                ProgressView("Reading the track…")
            }
        }
        .task(id: points.count) { await load() }
        if let answer, let d = answer.debrief {
            let t = answer.tolerances
            // PA.VI.A's tolerances in the title, as the web page has them.
            Section("Leg by leg · within \(AirportWords.tenths(t.offRouteNm)) nm, \(AirportWords.tenths(t.altitudeFt)) ft, \(AirportWords.tenths(t.courseDeg))°") {
                ForEach(Array(d.legs.enumerated()), id: \.offset) { _, leg in
                    HStack(alignment: .top, spacing: 12) {
                        WithinMark(ok: leg.ok)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(leg.from) → \(leg.to)")
                            Text(altitudeLine(leg, d, t)).font(.subheadline).foregroundStyle(.secondary)
                            if let course = courseLine(leg, t) { Text(course).font(.subheadline).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
            Section("Checkpoints · within \(AirportWords.tenths(t.etaMin)) min") {
                ForEach(Array(d.passes.enumerated()), id: \.offset) { _, pass in
                    HStack(alignment: .top, spacing: 12) {
                        if let ok = pass.ok { WithinMark(ok: ok) } else { Image(systemName: "circle").foregroundStyle(.secondary).accessibilityHidden(true) }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pass.name)
                            Text(passLine(pass)).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if !d.patterns.isEmpty {
                Section("Into the pattern · within \(AirportWords.tenths(t.patternFt)) ft") {
                    ForEach(d.patterns, id: \.ident) { entry in
                        HStack(spacing: 12) {
                            WithinMark(ok: entry.ok)
                            LabeledContent {
                                Text("\(AirportWords.feet(entry.altFt)) (\(FigureWords.signed(entry.offFt, "")))").monospacedDigit()
                            } label: {
                                Text(entry.ident)
                                Text("Pattern altitude \(AirportWords.feet(entry.patternFt))")
                            }
                        }
                    }
                }
            }
        }
    }

    private func load() async {
        guard points.count >= 2 else { return }
        do {
            let detail = try await Gateway.flightDetail(flight)
            answer = try await Planner.debrief(checkpoints: detail.checkpoints, points: points)
            problem = nil
        } catch {
            problem = "The debrief could not be worked out: \(error.localizedDescription)"
        }
        loaded = true
    }

    private func altitudeLine(_ leg: LegGrade, _ d: Debrief, _ t: DebriefTolerances) -> String {
        guard let within = leg.altitudeWithin else {
            return d.hasAltitude ? "Altitude: no cruise on this leg" : "Altitude: the file has none"
        }
        let worst = leg.worstAltFt.map { ", at most \(FigureWords.signed($0, " ft"))" } ?? ""
        return "Altitude: \(FigureWords.percent(within)) within \(AirportWords.tenths(t.altitudeFt)) ft of \(AirportWords.feet(leg.plannedAltFt))\(worst)"
    }

    private func courseLine(_ leg: LegGrade, _ t: DebriefTolerances) -> String? {
        guard let within = leg.courseWithin, let course = leg.courseDeg else { return nil }
        let off = leg.worstOffNm.map { String(format: ", at most %.1f nm %@ of the line", abs($0), $0 >= 0 ? "right" : "left") } ?? ""
        return "Course: \(FigureWords.percent(within)) within \(AirportWords.tenths(t.courseDeg))° of \(AirportWords.bearing(course))\(off)"
    }

    private func passLine(_ p: CheckpointPass) -> String {
        var parts: [String] = []
        if let due = p.dueMin { parts.append("Due \(hoursMinutes(due))") }
        if let passed = p.passedMin {
            parts.append("\(p.landed ? "landed" : "passed") \(hoursMinutes(passed))\(p.lateMin.map { " (\(FigureWords.signed($0, " min")))" } ?? "")")
        } else {
            parts.append("not reached")
        }
        if !p.landed, let closest = p.closestNm { parts.append(String(format: "%.1f nm from it at closest", closest)) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - The diversion drill

/// The diversion drill (the web app's DiversionDrill, ACS PA.VI.C): where
/// the airplane is, the examiner says divert. The clock starts, the
/// student picks one of the nearest fields (with their runways and
/// weather, and not how far or which way: that is off the chart),
/// estimates the heading, ground speed, time and fuel, and checks them
/// against the planner's exact solution in its forecast air on the way
/// (GET /api/diversion), each estimate marked reasonable or not.
struct DiversionDrillView: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(DryRun.self) private var dryRun
    @State private var started: Date?
    @State private var stopped: Date?
    @State private var from: OwnShip.Fix?
    @State private var fields: [NearestAirport] = []
    @State private var finding = false
    @State private var chosen: String?
    @State private var typed: [String: String] = [:]
    @State private var altitudeFt: Double = 0
    @State private var answer: DiversionAnswer?
    @State private var checking = false
    @State private var problem: String?

    /// The figures a student estimates, by the planner's keys; how far
    /// off is reasonable is the planner's (ALLOWANCES).
    private static let estimates: [(key: String, label: String, unit: String)] = [
        ("mh", "Magnetic heading", "°"), ("gs", "Ground speed", "kt"), ("ete", "Time", "min"), ("fuel", "Fuel", "gal"),
    ]
    /// The altitudes the drill can be flown at, VFR's: below 18,000 ft
    /// MSL, the floor of Class A (14 CFR 71.33).
    private static let altitudes = Array(stride(from: 1500.0, through: 17500.0, by: 500.0))

    private var fix: OwnShip.Fix? { dryRun.fix ?? ownShip.fix }
    private var checked: Bool { stopped != nil }

    var body: some View {
        List {
            if started == nil {
                Section {
                    Text("Where you are, at \(AirportWords.feet(altitudeFt)), the examiner says: divert. Pick a field, and work out the magnetic heading, ground speed, time and fuel to it from the chart and the forecast wind.")
                    Picker("Altitude", selection: $altitudeFt) {
                        ForEach(Self.altitudes, id: \.self) { ft in Text(AirportWords.feet(ft)).tag(ft) }
                    }
                    .pickerStyle(.menu)
                    Button { start() } label: { Label("Start the Clock", systemImage: "timer") }
                        .disabled(fix == nil)
                    if fix == nil { Text("Waiting for your position").foregroundStyle(.secondary) }
                }
            } else {
                Section {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        LabeledContent(checked ? "You took" : "On the clock",
                                       value: stopwatch((stopped ?? context.date).timeIntervalSince(started ?? context.date)))
                            .monospacedDigit()
                    }
                }
                Section("Divert to") {
                    if finding {
                        Text("Finding the nearest fields…").foregroundStyle(.secondary)
                    } else if fields.isEmpty {
                        Text("No fields near here").foregroundStyle(.secondary)
                    }
                    ForEach(fields) { field in
                        Button { chosen = field.ident } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(field.ident) · \(field.name)").foregroundStyle(.primary)
                                    Text([field.longestRunwayFt.map { "\($0.formatted()) ft runway" } ?? "no runway length",
                                          field.flightCategory ?? "no weather report"].joined(separator: " · "))
                                        .font(.subheadline).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if chosen == field.ident { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                        }
                        .disabled(checked)
                    }
                }
                Section("Your estimates") {
                    ForEach(Self.estimates, id: \.key) { e in
                        let check = answer?.checks.first { $0.key == e.key }
                        LabeledContent {
                            HStack(spacing: 6) {
                                if let ok = check?.reasonable { WithinMark(ok: ok) }
                                TextField("", text: Binding(get: { typed[e.key] ?? "" }, set: { typed[e.key] = $0 }))
                                    .keyboardType(.decimalPad).multilineTextAlignment(.trailing).monospacedDigit()
                                    .frame(width: 72).disabled(checked)
                                Text(e.unit).foregroundStyle(.secondary).frame(width: 30, alignment: .leading)
                            }
                        } label: {
                            Text(e.label)
                            if check?.reasonable == false, let written = check?.written { Text("Not quite: \(written)") }
                        }
                    }
                }
                if checked, let answer {
                    if let line = answer.problem {
                        Text(line).foregroundStyle(.red)
                    } else {
                        Section("To \(answer.to), worked out") {
                            ForEach(answer.steps, id: \.name) { step in LabeledContent(step.name, value: step.value).monospacedDigit() }
                        }
                    }
                    if let nearest = fields.first, nearest.ident != answer.to {
                        Text("The nearest was \(nearest.ident), \(Int(nearest.distanceNm.rounded())) nm: was \(answer.to) the better choice?")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
                Section {
                    if checked {
                        Button("Again") { start() }
                    } else {
                        Button(checking ? "Checking…" : "Check") { check() }.disabled(chosen == nil || checking)
                    }
                }
            }
        }
        .navigationTitle("Diversion Drill")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            // The plan's cruise to start with, else the airplane's own
            // altitude to the nearest 500 ft: a choice to change, no rule.
            guard altitudeFt == 0 else { return }
            let own = plan.altitudeFt ?? fix?.altitudeFt.map { ($0 / 500).rounded() * 500 }
            altitudeFt = Self.altitudes.min { abs($0 - (own ?? 3500)) < abs($1 - (own ?? 3500)) } ?? 3500
        }
    }

    private func start() {
        started = Date(); stopped = nil; chosen = nil; typed = [:]; answer = nil; problem = nil
        from = fix
        guard let at = from?.coordinate else { return }
        finding = true
        Task {
            // A field under the point is where the airplane is, not a diversion.
            if let near = try? await Planner.nearest(lat: at.latitude, lon: at.longitude, limit: 10) {
                fields = Array(near.filter { $0.distanceNm >= 2 }.prefix(6))
            }
            finding = false
        }
    }

    private func check() {
        guard let ident = chosen, let at = from?.coordinate else { return }
        let estimates = typed.compactMapValues { Double($0.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) }
        stopped = Date()
        checking = true
        let aircraft = plan.aircraft, figures = plan.figures, altitude = altitudeFt
        Task {
            do {
                answer = try await Planner.diversion(lat: at.latitude, lon: at.longitude, to: ident, altitudeFt: altitude,
                                                     aircraft: aircraft, figures: figures, estimates: estimates)
                problem = nil
            } catch {
                problem = "The diversion could not be worked out: \(error.localizedDescription)"
                stopped = nil
            }
            checking = false
        }
    }

    /// Minutes and seconds, as a stopwatch shows them: "2:07".
    private func stopwatch(_ seconds: TimeInterval) -> String {
        let s = max(0, Int(seconds))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

// MARK: - Holding

/// The holding page (the web app's HoldingPage, ACS IR.III.B): a hold's
/// inbound course and turns and the heading the airplane arrives on, its
/// entry by AIM 5-3-8 drawn and said, and -- given a true airspeed, a
/// wind and the altitude -- the headings and the outbound time that make
/// the inbound leg a minute, all the planner's (GET /api/holding).
struct HoldingView: View {
    @State private var inbound = "360"
    @State private var heading = "220"
    @State private var turns = "right"
    @State private var tas = "100"
    @State private var windFrom = "300"
    @State private var windKt = "15"
    @State private var altitude = "5000"
    @State private var answer: HoldingAnswer?
    @State private var problem: String?

    private var asked: [String] { [inbound, heading, turns, tas, windFrom, windKt, altitude] }

    var body: some View {
        List {
            Section("The hold") {
                number("Inbound course", $inbound, "°")
                Picker("Turns", selection: $turns) {
                    Text("Right").tag("right")
                    Text("Left").tag("left")
                }
                .pickerStyle(.segmented)
                number("Your heading to the fix", $heading, "°")
            }
            if let answer, let i = Double(inbound), let h = Double(heading) {
                Section {
                    HoldDiagram(inbound: i, heading: h, turns: turns, entry: answer.entry, from: answer.approachRelative)
                        .frame(maxWidth: 320).frame(maxWidth: .infinity)
                        .accessibilityElement()
                        .accessibilityLabel("\(answer.entryName) entry to a hold with \(turns) turns on an inbound course of \(AirportWords.bearing(i)), arriving on a heading of \(AirportWords.bearing(h)).")
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(answer.entryName) entry").font(.headline)
                        Text(answer.steps).font(.subheadline)
                    }
                    // Within 5° of a sector's line, either entry (AIM 5-3-8).
                    if let either = answer.eitherName {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Or \(either.lowercased())")
                            Text("Within 5° of the line between the two").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            // The course and the wind in the same reference: magnetic, as a
            // clearance gives the course (winds aloft are true, so the row
            // says which).
            Section("In the wind") {
                number("True airspeed", $tas, "kt")
                number("Wind from, magnetic", $windFrom, "°")
                number("Wind speed", $windKt, "kt")
                number("Altitude", $altitude, "ft")
            }
            if let wind = answer?.wind {
                Section {
                    row("Inbound heading", wind.inboundWords, AirportWords.bearing(wind.inbound.heading))
                    row("Outbound heading", wind.outboundWords, AirportWords.bearing(wind.outbound.heading))
                    row("Outbound time", wind.timeWords, "\(Int(wind.outboundSec.rounded())) s")
                }
            } else if let line = answer?.windProblem {
                Text(line).foregroundStyle(.secondary)
            }
            if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
        }
        .navigationTitle("Holding Entries")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: asked) {
            // A pause while the pilot types, then the planner's answer.
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled, let i = Double(inbound), let h = Double(heading), (0...360).contains(i), (0...360).contains(h) else { return }
            do {
                answer = try await Planner.holding(inbound: i, heading: h, turns: turns, tasKt: Double(tas), windFrom: Double(windFrom),
                                                   windKt: Double(windKt), altitudeFt: Double(altitude))
                problem = nil
            } catch is CancellationError {
            } catch {
                problem = error.localizedDescription
            }
        }
    }

    private func number(_ title: String, _ value: Binding<String>, _ unit: String) -> some View {
        LabeledContent(title) {
            HStack(spacing: 6) {
                TextField("", text: value).keyboardType(.numberPad).multilineTextAlignment(.trailing).monospacedDigit().frame(width: 72)
                Text(unit).foregroundStyle(.secondary).frame(width: 24, alignment: .leading)
            }
        }
    }

    private func row(_ title: String, _ words: String, _ value: String) -> some View {
        LabeledContent {
            Text(value).monospacedDigit()
        } label: {
            Text(title)
            Text(words)
        }
    }
}

/// The hold drawn as a pilot pictures it (the web's HoldDiagram): the
/// inbound course up the page to the fix, the racetrack on the holding
/// side, the 70° line and the holding course through the fix dividing the
/// three sectors, the way the airplane comes in -- the planner's bearing
/// from the fix -- and the entry it flies, in the tint. Drawn on the web's
/// 300 by 270 page, scaled.
struct HoldDiagram: View {
    let inbound: Double
    let heading: Double
    let turns: String
    let entry: String
    /// Where the airplane comes from round the fix, up being the inbound course.
    let from: Double

    private static let names = ["direct": "Direct", "teardrop": "Teardrop", "parallel": "Parallel"]

    var body: some View {
        Canvas { context, size in
            let scale = size.width / 300
            context.scaleBy(x: scale, y: scale)
            let side: CGFloat = turns == "right" ? 1 : -1
            let fx: CGFloat = 150, fy: CGFloat = 105, r: CGFloat = 32, len: CGFloat = 100
            let cx = fx + side * r, ox = fx + side * 2 * r
            let k = r * 0.5523
            let faint = GraphicsContext.Shading.color(.primary.opacity(0.25))
            let tint = GraphicsContext.Shading.color(.accentColor)

            var course = Path()
            course.move(to: CGPoint(x: fx, y: 4)); course.addLine(to: CGPoint(x: fx, y: 266))
            context.stroke(course, with: faint, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            let line70: [Double] = turns == "right" ? [110, 290] : [250, 70]
            var seventy = Path()
            seventy.move(to: at(fx, fy, 150, line70[0])); seventy.addLine(to: at(fx, fy, 150, line70[1]))
            context.stroke(seventy, with: faint, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))

            let labels: [(String, Double)] = turns == "right"
                ? [("parallel", 52), ("teardrop", 322), ("direct", 205)] : [("parallel", 308), ("teardrop", 38), ("direct", 155)]
            for (name, deg) in labels {
                context.draw(Text(Self.names[name] ?? name).font(.system(size: 12, weight: name == entry ? .bold : .regular)).foregroundStyle(.secondary),
                             at: at(fx, fy, 92, deg))
            }

            // The racetrack: over the top from the fix, down the outbound
            // side, round the bottom and up the inbound course.
            var track = Path()
            track.move(to: CGPoint(x: fx, y: fy))
            track.addCurve(to: CGPoint(x: cx, y: fy - r), control1: CGPoint(x: fx, y: fy - k), control2: CGPoint(x: cx - side * k, y: fy - r))
            track.addCurve(to: CGPoint(x: ox, y: fy), control1: CGPoint(x: cx + side * k, y: fy - r), control2: CGPoint(x: ox, y: fy - k))
            track.addLine(to: CGPoint(x: ox, y: fy + len))
            track.addCurve(to: CGPoint(x: cx, y: fy + len + r), control1: CGPoint(x: ox, y: fy + len + k), control2: CGPoint(x: cx + side * k, y: fy + len + r))
            track.addCurve(to: CGPoint(x: fx, y: fy + len), control1: CGPoint(x: cx - side * k, y: fy + len + r), control2: CGPoint(x: fx, y: fy + len + k))
            track.closeSubpath()
            context.stroke(track, with: entry == "direct" ? tint : .color(.primary.opacity(0.55)), lineWidth: entry == "direct" ? 2.5 : 1.5)

            // Each entry's turn, leaving the way the leg before it was flown
            // and meeting the inbound course heading up it.
            var path = Path()
            if entry == "teardrop" {
                let out = 180 - Double(side) * 30
                let t = at(fx, fy, len * 0.85, out)
                path.move(to: CGPoint(x: fx, y: fy)); path.addLine(to: t)
                path.addCurve(to: CGPoint(x: fx, y: fy + len * 0.5), control1: at(t.x, t.y, 40, out), control2: CGPoint(x: fx, y: fy + len + 30))
            } else if entry == "parallel" {
                let px = fx - side * 20
                path.move(to: CGPoint(x: fx, y: fy))
                path.addCurve(to: CGPoint(x: px, y: fy + 35), control1: CGPoint(x: fx, y: fy + 15), control2: CGPoint(x: px, y: fy + 10))
                path.addLine(to: CGPoint(x: px, y: fy + len))
                path.addCurve(to: CGPoint(x: fx, y: fy + len * 0.5), control1: CGPoint(x: px, y: fy + len + 45), control2: CGPoint(x: fx + side * 40, y: fy + len + 40))
            }
            context.stroke(path, with: tint, lineWidth: 2.5)

            var chevron = Path()
            chevron.move(to: CGPoint(x: fx - 6, y: fy + len - 30)); chevron.addLine(to: CGPoint(x: fx, y: fy + len - 42)); chevron.addLine(to: CGPoint(x: fx + 6, y: fy + len - 30))
            context.stroke(chevron, with: .color(.primary.opacity(0.55)), lineWidth: 1.5)
            context.fill(Path(ellipseIn: CGRect(x: fx - 5, y: fy - 5, width: 10, height: 10)), with: .color(.primary))
            context.draw(Text("Fix").font(.system(size: 12)), at: CGPoint(x: fx - side * 10, y: fy - 8), anchor: turns == "right" ? .trailing : .leading)

            // The way in, dashed, with its arrowhead at the fix's end.
            let a = at(fx, fy, 128, from), b = at(fx, fy, 30, from)
            var way = Path()
            way.move(to: a); way.addLine(to: b)
            context.stroke(way, with: tint, style: StrokeStyle(lineWidth: 2, dash: [5, 3]))
            var head = Path()
            head.move(to: CGPoint(x: -5, y: 4)); head.addLine(to: CGPoint(x: 0, y: -3)); head.addLine(to: CGPoint(x: 5, y: 4))
            let turned = head.applying(CGAffineTransform(rotationAngle: (from + 180) * .pi / 180).concatenating(CGAffineTransform(translationX: b.x, y: b.y)))
            context.stroke(turned, with: tint, lineWidth: 2)
        }
        .aspectRatio(300 / 270, contentMode: .fit)
    }

    /// A point `r` from (cx, cy) at a bearing `deg` measured on the page,
    /// up being the inbound course.
    private func at(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ deg: Double) -> CGPoint {
        let a = deg * .pi / 180
        return CGPoint(x: cx + r * CGFloat(sin(a)), y: cy - r * CGFloat(cos(a)))
    }
}

// MARK: - Lost communications

/// Lost comms' clearance and segments (the web app's LostCommsPage): the
/// altitude assigned and to expect, each segment's minimum for IFR
/// operations, and what the planner says to fly on each (POST
/// /api/lost-comms, 14 CFR 91.185(c)(2)); a tap on a segment's altitude
/// says the expected altitude applies from there. It opens on a made-up
/// route for the pilot's own.
struct LostCommsSegmentsSections: View {
    @Binding var leave: String?
    @State private var segments: [LostCommsSegmentAsk] = [
        LostCommsSegmentAsk(name: "Departure to SWEDE", minimumFt: 2600),
        LostCommsSegmentAsk(name: "SWEDE to RAYMO", minimumFt: 5000),
        LostCommsSegmentAsk(name: "RAYMO to the approach fix", minimumFt: 3400),
    ]
    @State private var minimums = ["2600", "5000", "3400"]
    @State private var assigned = "4000"
    @State private var expected = "6000"
    @State private var expectedFrom = 1
    let approachFix: Bool
    let efc: String
    let eta: String
    @State private var answer: LostCommsAnswer?
    @State private var problem: String?

    private var ask: LostCommsAsk {
        LostCommsAsk(
            segments: zip(segments, minimums).map { LostCommsSegmentAsk(name: $0.name, minimumFt: Self.feet($1)) },
            assignedFt: Self.feet(assigned), expectedFt: Self.feet(expected), expectedFrom: expectedFrom,
            approachFix: approachFix, efc: efc, eta: eta
        )
    }

    static func feet(_ text: String) -> Double? { Double(text.trimmingCharacters(in: .whitespaces)) }

    var body: some View {
        Section("The clearance") {
            LabeledContent("Assigned") {
                TextField("", text: $assigned).keyboardType(.numberPad).multilineTextAlignment(.trailing).monospacedDigit().frame(width: 90)
            }
            LabeledContent {
                TextField("", text: $expected).keyboardType(.numberPad).multilineTextAlignment(.trailing).monospacedDigit().frame(width: 90)
            } label: {
                Text("Expect")
                Text("From \(segments.indices.contains(expectedFrom) && !segments[expectedFrom].name.isEmpty ? segments[expectedFrom].name : "the segment chosen below") on")
            }
        }
        .task(id: ask) {
            // A pause while the pilot types, then the planner's answer.
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                let found = try await Planner.lostComms(ask)
                answer = found
                leave = found.leave
                problem = nil
            } catch is CancellationError {
            } catch {
                problem = error.localizedDescription
            }
        }
        Section("The route's segments") {
            ForEach(segments.indices, id: \.self) { i in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        TextField("Segment", text: $segments[i].name)
                        TextField("", text: $minimums[i]).keyboardType(.numberPad).multilineTextAlignment(.trailing).monospacedDigit().frame(width: 80)
                            .accessibilityLabel("\(segments[i].name.isEmpty ? "Segment" : segments[i].name)'s minimum altitude")
                    }
                    Button {
                        expectedFrom = i
                    } label: {
                        Text(answer?.segments.indices.contains(i) == true ? answer!.segments[i].words : "…")
                            .foregroundStyle(i >= expectedFrom ? Color.primary : Color.accentColor)
                    }
                    .buttonStyle(.borderless)
                }
            }
            .onDelete { at in
                guard segments.count - at.count >= 1 else { return }
                segments.remove(atOffsets: at)
                minimums.remove(atOffsets: at)
                expectedFrom = max(0, min(expectedFrom, segments.count - 1))
            }
            Button { segments.append(LostCommsSegmentAsk(name: "", minimumFt: nil)); minimums.append("") } label: {
                Label("Add a Segment", systemImage: "plus")
            }
            if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
        }
    }
}
