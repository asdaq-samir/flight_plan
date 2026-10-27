import CoreLocation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The nearest fields for a diversion, from where the airplane is (the dry
/// run's airplane while it flies): the planner's distance and bearing to
/// each, and Divert, which plans the route from here to it -- its heading,
/// time and fuel the planner's, as any route's are -- with the route as it
/// was kept for Cancel.
struct DiversionView: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(DryRun.self) private var dryRun
    @Environment(\.dismiss) private var dismiss
    @State private var fields: [NearestAirport] = []
    @State private var problem: String?

    private var fix: OwnShip.Fix? { dryRun.fix ?? ownShip.fix }

    var body: some View {
        List {
            if fix == nil {
                ContentUnavailableView("Finding your position…", systemImage: "location", description: Text("Nearest is from where the airplane is."))
            }
            Section(fields.isEmpty ? "" : "Nearest to you") {
                ForEach(fields) { field in
                    HStack {
                        NavigationLink { AirportCard(ident: field.ident) } label: { NearestRow(field: field) }
                    }
                    .swipeActions(edge: .leading) {
                        Button("Divert") { divert(field.ident) }.tint(.orange)
                    }
                    .contextMenu {
                        Button { divert(field.ident) } label: { Label("Divert to \(field.ident)", systemImage: "arrow.uturn.right") }
                    }
                }
            }
            ProblemLine(problem)
            // The checkride's diversion from here, worked by the planner.
            Section {
                NavigationLink { DiversionDrillView() } label: { Label("Diversion Drill", systemImage: "timer") }
            }
        }
        .navigationTitle("Nearest")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: fix.map { "\(($0.coordinate.latitude * 60).rounded()),\(($0.coordinate.longitude * 60).rounded())" }) {
            guard let at = fix?.coordinate else { return }
            do { fields = try await Planner.nearest(lat: at.latitude, lon: at.longitude); problem = nil } catch { problem = "The nearest fields could not be found." }
        }
    }

    private func divert(_ ident: String) {
        guard let fix else { return }
        plan.divert(to: ident, from: fix)
        dismiss()
    }
}

/// How to spot each checkpoint from the air, one line each, written on
/// the pilot's tap (each is a billed call, so never on its own) and
/// streamed as they come; a pilot's own edit is theirs from then on (the
/// web app's useCheckpointNotes).
struct CheckpointNotesView: View {
    @Environment(Plan.self) private var plan
    @State private var notes: [String: (text: String, source: String)] = [:]
    @State private var writing = false
    @State private var count: Int?
    @State private var problem: String?
    @State private var editing: Checkpoint?
    @State private var typed = ""

    /// A checkpoint's key, by where it is, as the planner matches a note.
    static func key(_ lat: Double, _ lon: Double) -> String { AirportWords.point(lat, lon) }

    var body: some View {
        List {
            Section {
                Button(writing ? (count.map { "Writing \(notes.count) of \($0)…" } ?? "Writing…") : "Describe the Checkpoints") { describe() }
                    .disabled(writing || plan.checkpoints.isEmpty)
                ProblemLine(problem)
            }
            Section("Checkpoints") {
                if plan.checkpoints.isEmpty { Text("The route's checkpoints come with its plan.").foregroundStyle(.secondary) }
                ForEach(plan.checkpoints) { point in
                    Button {
                        editing = point
                        typed = notes[Self.key(point.lat, point.lon)]?.text ?? ""
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(point.name ?? point.waypoint ?? point.category).font(.headline).foregroundStyle(.primary)
                            if let note = notes[Self.key(point.lat, point.lon)], !note.text.isEmpty {
                                Text(note.text).font(.subheadline).foregroundStyle(note.source == "saved" ? Color.primary : Color.secondary)
                            } else {
                                Text("Add a note").font(.subheadline).foregroundStyle(.tint)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Checkpoint notes")
        .navigationBarTitleDisplayMode(.inline)
        .alert(editing.map { $0.name ?? $0.waypoint ?? $0.category } ?? "Note", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            TextField("What you see there", text: $typed)
            Button("Save") { save() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("What you see at this place, kept for you from now on.")
        }
    }

    private func describe() {
        writing = true
        problem = nil
        let dep = plan.dep, dest = plan.dest, stops = plan.stops
        Task {
            do {
                for try await line in Planner.describeCheckpoints(dep: dep, dest: dest, stops: stops) {
                    switch line.type {
                    case "start": count = line.count
                    case "checkpoint":
                        if let lat = line.lat, let lon = line.lon {
                            notes[Self.key(lat, lon)] = (line.description ?? "", line.source ?? "generated")
                        }
                    case "error": problem = line.detail
                    default: break
                    }
                }
            } catch {
                problem = "The descriptions could not be written: \(error.localizedDescription)"
            }
            writing = false
        }
    }

    private func save() {
        guard let point = editing else { return }
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        let key = Self.key(point.lat, point.lon)
        let before = notes[key]
        notes[key] = (text, "saved")
        let dep = plan.dep, dest = plan.dest, stops = plan.stops
        Task {
            do { try await Planner.saveNote(dep: dep, dest: dest, stops: stops, lat: point.lat, lon: point.lon, text: text) } catch {
                // A failed save takes its own text back out, where the note
                // still holds it.
                if notes[key]?.text == text { notes[key] = before }
                problem = "The note could not be saved: \(error.localizedDescription)"
            }
        }
    }
}

/// A flight plan's items as FAA Form 7233-4 writes them (AIM Appendix 4),
/// from the planner's figures, as the web app's flightPlanForm does.
enum FilingForm {
    /// Item 15's cruising speed: the true airspeed in knots, N and four
    /// figures (AIM Appendix 4: "N0450").
    static func cruisingSpeed(_ tasKt: Double) -> String { String(format: "N%04d", Int(tasKt.rounded())) }

    /// Item 15's level: at and above 18,000 ft a flight level, F and three
    /// figures, the altimeter set to 29.92 (14 CFR 91.121(a)(2)); below it
    /// the altitude in hundreds of feet, A and three figures (AIM Appendix
    /// 4: "F350", "A080").
    static func cruisingLevel(_ altitudeFt: Double) -> String {
        String(format: "%@%03d", altitudeFt >= 18_000 ? "F" : "A", Int((altitudeFt / 100).rounded()))
    }

    /// Item 15's route between the ends: DCT between two points flown
    /// direct, and DCT alone for a flight direct from one to the other
    /// (AIM Appendix 4: "FLACK DCT IRW").
    static func route(_ stops: [String]) -> String {
        stops.isEmpty ? "DCT" : stops.joined(separator: " DCT ")
    }

    /// Hours and minutes in four figures, HHMM (items 16 and 19).
    static func hhmm(_ minutes: Int) -> String { String(format: "%02d%02d", minutes / 60, minutes % 60) }
}

/// Filing with Flight Service, where the gateway has it connected, as the
/// web app's Brief files (FlightServiceController): signed in, in the
/// pilot's name, the form's items from the plan and the rest typed. With
/// none connected, 1800wxbrief.com and Flight Service's number, which are
/// the FAA's, at no charge.
struct FlightServiceView: View {
    @Environment(Plan.self) private var plan
    @Environment(Session.self) private var session
    @State private var status: FlightServiceStatus?
    @State private var aircraftId = ""
    @State private var aircraftType = ""
    @State private var departs = Date().addingTimeInterval(3600)
    @State private var endurance = ""
    @State private var persons = ""
    @State private var reference: String?
    @State private var briefing: String?
    @State private var problem: String?
    @State private var sending = false

    var body: some View {
        Form {
            if let status, status.connected, session.signedIn {
                Section("Flight plan") {
                    LabeledContent("Rules", value: "VFR")
                    TextField("Aircraft identification", text: $aircraftId).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    TextField("Type of aircraft, as C172", text: $aircraftType).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    LabeledContent("Departure", value: plan.dep)
                    DatePicker("Departs", selection: $departs, in: Date()...)
                    if let request = request() {
                        LabeledContent("Cruising speed", value: request.cruisingSpeed)
                        LabeledContent("Cruising level", value: request.cruisingLevel)
                        LabeledContent("Route", value: request.route)
                        LabeledContent("Total EET", value: FilingForm.hhmm(request.eetMinutes))
                    }
                    LabeledContent("Destination", value: plan.dest)
                    TextField("Endurance, HHMM", text: $endurance).keyboardType(.numberPad)
                    TextField("Persons on board", text: $persons).keyboardType(.numberPad)
                }
                Section {
                    Button(reference.map { "Filed: \($0)" } ?? (sending ? "Filing…" : "File with \(status.provider)")) { Task { await file() } }
                        .disabled(request() == nil || reference != nil || sending)
                    Button("Standard Briefing") { Task { await brief() } }
                        .disabled(request() == nil || sending)
                    ProblemLine(problem)
                }
                if let briefing {
                    Section("Standard briefing") { Text(briefing).font(.footnote.monospaced()).textSelection(.enabled) }
                }
            }
            Section(status?.connected == true ? "Or" : "File it with Flight Service") {
                Link(destination: URL(string: "https://www.1800wxbrief.com")!) {
                    LabeledContent("1800wxbrief.com", value: "Open it as you leave, close it when you land")
                }
                Link(destination: URL(string: "tel:18009927433")!) { LabeledContent("Flight Service", value: "1-800-WX-BRIEF") }
            }
        }
        .navigationTitle("File flight plan")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            status = try? await Gateway.flightService()
            if aircraftId.isEmpty { aircraftId = plan.tail ?? "" }
            if aircraftType.isEmpty { aircraftType = plan.aircraft.uppercased() }
        }
    }

    /// The request, where every item it needs is there: the first leg's
    /// speed and level, the planner's time en route rounded up, and the
    /// endurance typed (the pilot's fuel aboard).
    private func request() -> FlightPlanFilingRequest? {
        guard plan.routed, let first = plan.legs.first, let ete = plan.totals?.eteMin, !aircraftId.isEmpty, !aircraftType.isEmpty else { return nil }
        let digits = endurance.filter(\.isNumber)
        guard digits.count == 4, let hours = Int(digits.prefix(2)), let minutes = Int(digits.suffix(2)), minutes < 60 else { return nil }
        let pob = Int(persons.filter(\.isNumber)).flatMap { (1...999).contains($0) ? $0 : nil }
        return FlightPlanFilingRequest(
            rules: "VFR", aircraftId: aircraftId.uppercased(), aircraftType: aircraftType.uppercased(), departure: plan.dep,
            departureTime: ISO8601DateFormatter().string(from: departs), cruisingSpeed: FilingForm.cruisingSpeed(first.tasKt),
            cruisingLevel: FilingForm.cruisingLevel(first.altitudeFt), route: FilingForm.route(plan.stops), destination: plan.dest,
            eetMinutes: Int(ete.rounded(.up)), enduranceMinutes: hours * 60 + minutes, personsOnBoard: pob)
    }

    private func file() async {
        guard let request = request() else { return }
        sending = true
        do { reference = try await Gateway.file(request); problem = nil } catch { problem = "Not filed: \(error.localizedDescription)" }
        sending = false
    }

    private func brief() async {
        guard let request = request() else { return }
        sending = true
        do { briefing = try await Gateway.standardBriefing(request); problem = nil } catch { problem = "No briefing: \(error.localizedDescription)" }
        sending = false
    }
}

/// A saved flight's flown track: its profile, shown on the map over its
/// route, put in from a GPX file (ForeFlight's, Garmin Pilot's, a GPS's),
/// or taken off. GPS altitude, not what the altimeter read.
struct FlownTrackView: View {
    let flight: Int64
    let title: String
    @State private var track: SavedTrack?
    @State private var loaded = false
    @State private var importing = false
    @State private var problem: String?

    private var points: [PathPoint] {
        (track?.points ?? []).map { PathPoint(t: Double($0.t) / 1000, lat: $0.lat, lon: $0.lon, altFt: $0.altFt) }
    }

    private var replayKey: String { "flown:\(flight)" }

    var body: some View {
        NavigationStack {
            List {
                if let track, !track.points.isEmpty {
                    // Its replay, the airplane flown along it again on the
                    // map, the track put there with it.
                    ReplaySection(points: Replay.points(track.points), key: replayKey, onPlay: {
                        if Tracking.shared.flown.isEmpty { Tracking.shared.flown = points }
                    })
                    Section {
                        if let first = points.first, let last = points.last {
                            LabeledContent("Flown", value: FlightWords.lasted(last.t - first.t))
                        }
                        if let top = points.compactMap(\.altFt).max() { LabeledContent("Highest", value: "\(Int(top).formatted()) ft") }
                    }
                    // Its debrief against the flight's nav log, the planner's (POST /api/debrief).
                    DebriefSections(flight: flight, points: track.points)
                    Section {
                        Button(Tracking.shared.flown.isEmpty ? "Show on the Map" : "Hide from the Map") {
                            Tracking.shared.flown = Tracking.shared.flown.isEmpty ? points : []
                        }
                        Button("Delete the Track", role: .destructive) {
                            Task {
                                do { try await Gateway.deleteTrack(flight); self.track = nil; Tracking.shared.flown = []; Replay.shared.clear(replayKey) } catch { problem = error.localizedDescription }
                            }
                        }
                    }
                } else if loaded {
                    ContentUnavailableView("No track kept", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                           description: Text("Put in the flight's track from a GPX file."))
                }
                Section {
                    Button("Put In a GPX File…") { importing = true }
                    ProblemLine(problem)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // The card's own close, whether a sheet (iPhone) or the
                // inspector (iPad) holds it.
                ToolbarItem(placement: .topBarTrailing) { Button { FlightUI.shared.card = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Close") }
            }
            .task {
                do { track = try await Gateway.track(flight) } catch { problem = error.localizedDescription }
                loaded = true
            }
            .onDisappear { Replay.shared.clear(replayKey) }
            .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "gpx") ?? .xml, .xml]) { result in
                guard case .success(let url) = result else { return }
                let reading = url.startAccessingSecurityScopedResource()
                defer { if reading { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url), let read = GPXTrack.points(data), !read.isEmpty else {
                    problem = "No track points with their times in that file."
                    return
                }
                let saved = SavedTrack(points: read, source: "gpx")
                Task {
                    do { try await Gateway.saveTrack(flight, saved); track = saved; problem = nil } catch { problem = error.localizedDescription }
                }
            }
        }
    }
}

/// A GPX file's track points with their times (GPX 1.1's trkpt, its ele
/// in metres, as feet), as the web app's lib/track reads one.
final class GPXTrack: NSObject, XMLParserDelegate {
    private var points: [SavedTrackPoint] = []
    private var lat: Double?
    private var lon: Double?
    private var ele: Double?
    private var time: Date?
    private var text = ""

    static func points(_ data: Data) -> [SavedTrackPoint]? {
        let reader = GPXTrack()
        let parser = XMLParser(data: data)
        parser.delegate = reader
        guard parser.parse() else { return nil }
        return reader.points
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        text = ""
        if name == "trkpt" {
            lat = attributes["lat"].flatMap(Double.init)
            lon = attributes["lon"].flatMap(Double.init)
            ele = nil
            time = nil
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name {
        case "ele": ele = Double(value)
        case "time": time = AirportWords.date(value)
        case "trkpt":
            if let lat, let lon, let time, abs(lat) <= 90, abs(lon) <= 180, !(lat == 0 && lon == 0) {
                points.append(SavedTrackPoint(t: Int64(time.timeIntervalSince1970 * 1000), lat: lat, lon: lon, altFt: ele.map { $0 * 3.28084 }))
            }
        default: break
        }
        text = ""
    }
}

/// The route shared, as the web app's ShareMenu: its link, the nav log as
/// text and as the kneeboard's page (PDF), a GPX route for another app,
/// ForeFlight's own link (the checkpoints' pack first, then the route),
/// and filing.
struct ShareMenu: View {
    @Environment(Plan.self) private var plan
    @Environment(\.openURL) private var openURL
    @State private var sharing: ShareItems?

    struct ShareItems: Identifiable {
        let id = UUID()
        let items: [Any]
    }

    var body: some View {
        Menu {
            ShareLink(item: RouteShare.link(plan)) { Label("Share Link", systemImage: "link") }
            ShareLink(item: RouteShare.navLogText(plan)) { Label("Nav Log as Text", systemImage: "list.number") }
            Button { pdf() } label: { Label("Nav Log as PDF", systemImage: "doc.richtext") }
            Button { gpx() } label: { Label("GPX Route (.gpx)", systemImage: "square.and.arrow.down") }
            Button { foreflight() } label: { Label("Open in ForeFlight", systemImage: "paperplane") }
        } label: {
            Image(systemName: "square.and.arrow.up")
        }
        .accessibilityLabel("Share")
        .disabled(plan.legs.isEmpty)
        .sheet(item: $sharing) { share in ActivityView(items: share.items).presentationDetents([.medium, .large]) }
    }

    private func pdf() {
        guard let url = Kneeboard.pdf(plan) else { return }
        sharing = ShareItems(items: [url])
    }

    private func gpx() {
        let url = FileManager.default.temporaryDirectory.appending(path: "\(RouteShare.fileName(plan)).gpx")
        guard (try? RouteShare.gpx(plan).write(to: url, atomically: true, encoding: .utf8)) != nil else { return }
        sharing = ShareItems(items: [url])
    }

    /// ForeFlight takes no route and pack in one: the pack the first time a
    /// route goes there from this device, then the route itself, its
    /// checkpoints by their names in the pack.
    private func foreflight() {
        let route = plan.idents.joined(separator: "-")
        let names = plan.checkpoints.map { $0.waypoint ?? "" }
        let sent = RouteShare.packSent(route, names: names)
        if !sent, !plan.checkpoints.isEmpty {
            RouteShare.markPackSent(route, names: names)
            openURL(RouteShare.openPack(RouteShare.packURL(plan)))
        } else {
            openURL(RouteShare.foreflightRoute(plan, named: sent))
        }
    }
}

/// The route as it goes to other places.
@MainActor
enum RouteShare {
    /// The plan's own address on the website.
    static func link(_ plan: Plan) -> URL {
        var items = [URLQueryItem(name: "dep", value: plan.dep), URLQueryItem(name: "dest", value: plan.dest)]
        if !plan.stops.isEmpty { items.append(URLQueryItem(name: "stops", value: plan.stops.joined(separator: ","))) }
        if let feet = plan.ownAltitudeFt { items.append(URLQueryItem(name: "altitude_ft", value: String(Int(feet)))) }
        if !plan.extras.holds.isEmpty { items.append(URLQueryItem(name: "holds", value: plan.extras.holds.map(\.text).joined(separator: ","))) }
        return Config.gateway.appending(path: "/app/plan").appending(queryItems: items)
    }

    static func fileName(_ plan: Plan) -> String {
        plan.idents.joined(separator: "-").replacingOccurrences(of: "[^A-Za-z0-9]+", with: "-", options: .regularExpression)
    }

    /// The nav log as lines of text: the route, then each leg's figures.
    static func navLogText(_ plan: Plan) -> String {
        var lines = [plan.idents.joined(separator: " → ")]
        if let totals = plan.totals {
            lines.append([totals.distanceNm.map(AirportWords.nm), totals.eteMin.map(hoursMinutes),
                          totals.fuelGal.map(AirportWords.gal)].compactMap { $0 }.joined(separator: " · "))
        }
        for leg in plan.legs {
            lines.append(String(format: "%@ → %@  %05.0f ft  MH %03.0f°  %.1f nm  %@  %@", leg.from, leg.to, leg.altitudeFt, leg.magneticHeadingDeg, leg.distanceNm,
                                leg.groundspeedKt.map { String(format: "GS %.0f kt", $0) } ?? "", leg.eteMin.map(hoursMinutes) ?? ""))
        }
        return lines.joined(separator: "\n")
    }

    /// The route's points in order: the ends and stops, and each hop's
    /// checkpoints between them.
    static func points(_ plan: Plan) -> [(name: String, lat: Double, lon: Double, checkpoint: Checkpoint?)] {
        guard let course = plan.course else { return [] }
        let ends = [course.departure] + (course.stops ?? []) + [course.destination]
        var out: [(name: String, lat: Double, lon: Double, checkpoint: Checkpoint?)] = []
        for (i, end) in ends.enumerated() {
            out.append((end.ident, end.lat, end.lon, nil))
            guard i < ends.count - 1 else { break }
            for point in plan.checkpoints.filter({ ($0.hop ?? 0) == i }).sorted(by: { $0.alongTrackNm < $1.alongTrackNm }) {
                out.append((point.name ?? point.waypoint ?? point.category, point.lat, point.lon, point))
            }
        }
        return out
    }

    private static func xml(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// A GPX 1.1 route through the points.
    static func gpx(_ plan: Plan) -> String {
        let name = plan.idents.joined(separator: " → ")
        var lines = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
                     "<gpx version=\"1.1\" creator=\"Wingtip Maps\" xmlns=\"http://www.topografix.com/GPX/1/1\">",
                     "  <rte>", "    <name>\(xml(name))</name>"]
        for point in points(plan) {
            lines.append(String(format: "    <rtept lat=\"%.6f\" lon=\"%.6f\"><name>%@</name></rtept>", point.lat, point.lon, xml(point.name)))
        }
        lines += ["  </rte>", "</gpx>", ""]
        return lines.joined(separator: "\n")
    }

    /// The checkpoints' pack on the planner (app.foreflight), at a short
    /// address ending in its file's name, which ForeFlight names it by.
    static func packURL(_ plan: Plan) -> URL {
        let route = plan.idents.joined(separator: "-")
        return Config.gateway.appending(path: "/api/planner/foreflight-pack/\(route)/\(route)-checkpoints.zip")
    }

    /// ForeFlight's own link for a pack (foreflight.com/support/content-packs).
    static func openPack(_ pack: URL) -> URL {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.!~*'()"))
        return URL(string: "https://foreflight.com/content?downloadURL=\(pack.absoluteString.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")")!
    }

    /// ForeFlight's maps link for the route: the fields by ident, the
    /// checkpoints by their names in the pack once it is sent, else where
    /// they are, and the altitude (the web app's foreflightRoute).
    static func foreflightRoute(_ plan: Plan, named: Bool) -> URL {
        var tokens = points(plan).map { point -> String in
            guard let checkpoint = point.checkpoint else { return point.name.uppercased() }
            if named, let waypoint = checkpoint.waypoint { return "CONTPACK@\(waypoint)" }
            return String(format: "%.4f/%.4f", point.lat, point.lon)
        }
        if let feet = plan.altitudeFt { tokens.append("\(Int(feet.rounded()))ft") }
        return URL(string: "foreflightmobile://maps/search?q=\(tokens.joined(separator: "+"))")!
    }

    static func packSent(_ route: String, names: [String]) -> Bool {
        !names.isEmpty && (UserDefaults.standard.dictionary(forKey: "foreflightPacks")?[route] as? String) == names.joined(separator: " ")
    }

    static func markPackSent(_ route: String, names: [String]) {
        var sent = UserDefaults.standard.dictionary(forKey: "foreflightPacks") ?? [:]
        sent[route] = names.joined(separator: " ")
        UserDefaults.standard.set(sent, forKey: "foreflightPacks")
    }
}

/// The kneeboard card: the flight on one half-letter page to fly with --
/// the route, the airplane and the totals; the legs' altitude, heading,
/// distance, ground speed, time and fuel, with ETA, ATA and fuel left to
/// fill in; and the lines for the squawk and the clearance. Black on
/// white whatever the theme (the web app's Kneeboard).
struct Kneeboard: View {
    let route: String
    let aircraft: String
    let totals: Totals?
    let legs: [Leg]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(route).font(.system(size: 15, weight: .bold))
                Spacer()
                Text("Date ________").font(.system(size: 9))
            }
            Rectangle().frame(height: 1.5)
            Text([aircraft, totals?.distanceNm.map(AirportWords.nm), totals?.eteMin.map(hoursMinutes),
                  totals?.fuelGal.map(AirportWords.gal),
                  totals?.fuelRequiredGal.map { String(format: "(%.1f with reserve)", $0) }].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 9))
            Grid(alignment: .leading, horizontalSpacing: 6, verticalSpacing: 3) {
                GridRow {
                    ForEach(["Checkpoint", "Alt", "MH", "Dist", "GS", "ETE", "ETA", "ATA", "Fuel", "Rem"], id: \.self) { Text($0).bold() }
                }
                Divider().gridCellUnsizedAxes(.horizontal)
                ForEach(Array(legs.enumerated()), id: \.offset) { _, leg in
                    GridRow {
                        Text(leg.to).lineLimit(1)
                        Text(Int(leg.altitudeFt).formatted())
                        Text(String(format: "%03.0f", leg.magneticHeadingDeg))
                        Text(String(format: "%.1f", leg.distanceNm))
                        Text(leg.groundspeedKt.map { String(format: "%.0f", $0) } ?? "")
                        Text(leg.eteMin.map { String(format: "%.1f", $0) } ?? "")
                        Text("")
                        Text("")
                        Text(leg.fuelGal.map { String(format: "%.1f", $0) } ?? "")
                        Text("")
                    }
                    Divider().gridCellUnsizedAxes(.horizontal)
                }
            }
            .font(.system(size: 8.5).monospacedDigit())
            Text("Squawk ______   Clearance ____________________   Hobbs out ______ in ______").font(.system(size: 9)).padding(.top, 6)
            Spacer(minLength: 0)
            Text("Wingtip Maps · a planning aid: check the charts, NOTAMs and an official briefing before flight.").font(.system(size: 6.5))
        }
        .padding(24)
        .frame(width: 396, height: 612, alignment: .topLeading)
        .foregroundStyle(.black)
        .background(.white)
        .environment(\.colorScheme, .light)
    }

    /// The page as a PDF in the temporary folder, for the share sheet.
    @MainActor
    static func pdf(_ plan: Plan) -> URL? {
        let page = Kneeboard(route: plan.idents.joined(separator: " → "), aircraft: plan.tail ?? plan.aircraft.uppercased(), totals: plan.totals, legs: plan.legs)
        let url = FileManager.default.temporaryDirectory.appending(path: "\(RouteShare.fileName(plan))-nav-log.pdf")
        let renderer = ImageRenderer(content: page)
        var made = false
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let context = CGContext(url as CFURL, mediaBox: &box, nil) else { return }
            context.beginPDFPage(nil)
            draw(context)
            context.endPDFPage()
            context.closePDF()
            made = true
        }
        return made ? url : nil
    }
}

/// iOS's share sheet, for a file made here.
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// The alerts ahead said aloud, Setup's switch for it.
struct SpokenAlertsToggle: View {
    var body: some View {
        Toggle("Speak Alerts Ahead", isOn: Binding(get: { SpokenAlerts.shared.on }, set: { SpokenAlerts.shared.on = $0 }))
    }
}

/// The pilot's own checkpoint notes forgotten, everywhere, asked first.
struct ForgetNotesButton: View {
    @State private var asking = false
    @State private var said: String?

    var body: some View {
        Button(said ?? "Forget My Checkpoint Notes", role: .destructive) { asking = true }
            .confirmationDialog("Forget your checkpoint notes?", isPresented: $asking, titleVisibility: .visible) {
                Button("Forget Them", role: .destructive) {
                    Task {
                        if let removed = try? await Planner.forgetNotes() { said = removed == 1 ? "1 note forgotten" : "\(removed) notes forgotten" }
                    }
                }
            } message: {
                Text("Every note you wrote on a checkpoint goes; the shared ones stay.")
            }
    }
}

/// The last watch that went off, over the map until it is put away.
struct WatchBanner: View {
    var body: some View {
        if let words = Tracking.shared.fired {
            HStack(spacing: 8) {
                Image(systemName: "bell.fill")
                Text(words).font(.subheadline.weight(.semibold)).lineLimit(2)
                Button { Tracking.shared.fired = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Dismiss")
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(.regularMaterial, in: Capsule())
        }
    }
}
