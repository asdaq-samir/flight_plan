import SwiftUI

/// The sheet's content in the strip layout, the twin of the web app's
/// features/strip (the owner's pick of 2026-11-04, "let's try it"): in
/// the system sheet RootView presents with its three sizes. The pill is
/// the field's row alone -- the search field with the mic in it and the
/// profile avatar beside it, like Apple Maps -- and half way and up the
/// ribbon, then the flight as one strip in time: the head (the verdict,
/// the route's line, at most three findings), the timeline (StripList)
/// and, with no route, the welcome. The existing screens -- a field's
/// card, the Brief, the nav log, the airplane, the logbook, Setup --
/// open as pages of the stack, each with its title and a close that goes
/// back one level, their name in the pill where the field's row was. In
/// the air the strip is StripAir and the field the radio.
///
/// The field's line is read by FieldCommands.read and done here with the
/// planner's existing ways: the plan's setters, the places search, the
/// stack's pages, the assistant (AssistantClient); why not is said under
/// the field (lib/problems' rule: where it happens, never a toast).
struct StripSheetView: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(DryRun.self) private var dryRun
    @Environment(Session.self) private var session
    @Environment(Verdict.self) private var verdict
    /// The sheet's size, RootView's: the field focused brings it up clear
    /// of the keyboard; a route planned brings the pill to half.
    @Binding var detent: PresentationDetent
    /// A field or a point opened from the map (RootView's `airports`,
    /// the Airport tab's stack): its card is pushed here.
    @Binding var airports: [String]
    @State private var path: [StripPage] = []
    @State private var text = ""
    @State private var problem: String?
    @State private var busy = false
    @State private var hearing = false
    @State private var client = AssistantClient()
    @State private var nearest: [NearestAirport] = []
    @FocusState private var focused: Bool
    private var listener: ClearanceListener { ClearanceListener.shared }

    /// The pages the stack opens over the strip.
    enum StripPage: Hashable {
        case airport(String)
        case brief, navlog, profile, airplane, logbook, instructor, settings, clearance, file, flights, procedures
        case leg(Leg)
        case list(AirportShelf.Shows)

        var title: String {
            switch self {
            case .airport(let text): return AirportRoute(text).heldPoint != nil ? "Airspace" : text
            case .brief: return "Brief"
            case .navlog: return "Nav log"
            case .profile: return "Profile"
            case .airplane: return "My airplane"
            case .logbook: return "Logbook"
            case .instructor: return "Instructor"
            case .settings: return "Settings"
            case .clearance: return "Clearance"
            case .file: return "File"
            case .flights: return "Flights"
            case .procedures: return "Procedures"
            case .leg(let leg): return "To \(leg.to)"
            case .list(let shows): return shows.rawValue.prefix(1).uppercased() + shows.rawValue.dropFirst()
            }
        }
    }

    /// In the air on the route -- moving, within 3 nm of the line -- as
    /// FiguresStrip counts it: a dry run's airplane counts as flying.
    private var flyingFix: OwnShip.Fix? {
        guard let fix = dryRun.fix ?? ownShip.fix, let gs = fix.groundspeedKt, Flight.underway(gs), let course = plan.course,
              Flight.off(fix.coordinate, line: course.coordinates) <= 3 else { return nil }
        return fix
    }

    private var points: [StripPoint] {
        StripData.points(dep: plan.dep, dest: plan.dest, stops: plan.stops, legs: plan.legs, checkpoints: plan.checkpoints, course: plan.course)
    }

    var body: some View {
        NavigationStack(path: $path) {
            home
                .navigationDestination(for: StripPage.self) { page in
                    pageView(page)
                        .navigationTitle(page.title)
                        .navigationBarTitleDisplayMode(.inline)
                        .navigationBarBackButtonHidden(true)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                // Back one level, where the way back always is.
                                Button { if !path.isEmpty { path.removeLast() } } label: {
                                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                                }
                                .accessibilityLabel("Close")
                            }
                        }
                }
        }
        .chartInkTheme()
        .environment(\.openStripScreen, { screen in _ = open(screen) })
        // A field tapped on the chart, or a point held: its card, half
        // way up, as the tabs' Airport opens it.
        .onChange(of: airports) { _, now in
            if let last = now.last {
                path.append(.airport(last))
                if detent == RootView.pill { detent = .medium }
            }
        }
        .onChange(of: focused) { _, now in
            if now, detent != .large { detent = .large }
        }
        // The Go / No-Go for the head, asked as the Brief asks it.
        .task(id: verdict.key(for: plan)) { await verdict.refresh(plan: plan, signedIn: session.signedIn) }
        .onChange(of: plan.tail, initial: true) { _, tail in listener.tail = tail }
        // An airplane's card, a point pressed on the map, a hold, a flown
        // track, over the strip as over the tabs.
        .modifier(FlightSheets())
    }

    private var home: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let fix = flyingFix {
                    StripAir(points: points, position: StripData.positionAlong(points, fix: fix.coordinate), fix: fix)
                    radio
                } else {
                    if !client.turns.isEmpty {
                        StripAnswerCard(client: client, onClose: { client.clear() })
                    }
                    StripRibbonRow(dep: plan.dep, dest: plan.dest, verdict: plan.routed ? verdict.answer?.line : nil,
                                   eteMin: plan.totals?.eteMin, fuelGal: plan.totals?.fuelGal, points: points)
                    if plan.routed, plan.course != nil {
                        if let stage = plan.stage {
                            Label(stage, systemImage: "ellipsis").font(ChartInk.note).foregroundStyle(.secondary)
                        }
                        if let planProblem = plan.problem {
                            Text(planProblem.brief ?? planProblem.detail).font(ChartInk.detail.weight(.semibold)).foregroundStyle(.orange)
                        }
                        StripHead(onBrief: { path.append(.brief) }, onFile: { path.append(.file) })
                        StripList(points: points,
                                  onField: { path.append(.airport($0)) },
                                  onPlates: { path.append(.airport($0)) },
                                  onClearance: { path.append(.clearance) },
                                  onLeg: { path.append(.leg($0)) },
                                  onDebrief: { path.append(.flights) })
                    } else {
                        welcome
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) { fieldRow }
        .animation(.easeOut(duration: 0.3), value: focused)
        .accessibilityIdentifier("strip-sheet")
    }

    /// The pill's one row, and what hangs under it while typing: the
    /// chips while nothing is typed, why not under the field.
    private var fieldRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            StripFieldRow(text: $text, flying: flyingFix != nil, listening: hearing || listener.hearingOnce, busy: busy,
                          onSubmit: { Task { await run(text) } }, onMic: { Task { await hear() } }, focused: $focused)
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .padding(.bottom, 8)
            if let problem {
                Text(problem).font(ChartInk.note).foregroundStyle(.red)
                    .padding(.horizontal, 20).padding(.bottom, 6)
                    .accessibilityAddTraits(.isStaticText)
            }
            if focused, text.isEmpty, flyingFix == nil {
                StripSuggestions(suggestions: StripData.suggestions(routed: plan.routed, dest: plan.dest)) { words in
                    Task { await run(words) }
                }
            }
        }
        .background(.regularMaterial)
    }

    /// The first flight's welcome, the field at the foot being the way in.
    private var welcome: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "airplane").foregroundStyle(.tint).accessibilityHidden(true)
                Text("Where to?").font(ChartInk.heading)
            }
            Text("Type or say a field, a town or a route above. Wingtip plans from where you are: the route, the checkpoints you'll see from the air, the nav log and a weather brief, all on one strip.")
                .font(ChartInk.text)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .inkCard()
        .accessibilityIdentifier("strip-welcome")
    }

    /// The radio in the air: a call to us with its chips (RadioCallBanner),
    /// and the captions of what the radio says.
    @ViewBuilder
    private var radio: some View {
        if let call = listener.call {
            RadioCallBanner(call: call)
        }
        if listener.listening || listener.problem != nil {
            VStack(alignment: .leading, spacing: 2) {
                if let problem = listener.problem { Text(problem).foregroundStyle(.orange) }
                ForEach(listener.heard.suffix(2)) { t in
                    Text(t.text).lineLimit(2).foregroundStyle(t.forUs ? Color.accentColor : Color.primary)
                }
            }
            .font(ChartInk.detail)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .inkCard()
        }
    }

    @ViewBuilder
    private func pageView(_ page: StripPage) -> some View {
        switch page {
        case .airport(let text): AirportDestination(route: AirportRoute(text), nearest: nearest)
        case .brief: BriefView()
        case .navlog: navLog
        case .profile: ProfileCard()
        case .airplane: AircraftView()
        case .logbook: LogbookView()
        case .instructor: InstructorView()
        case .settings: SetupView()
        case .clearance: ClearanceSheet()
        case .file: FlightServiceView()
        case .flights: FlightsView()
        case .procedures:
            List {
                Section("Procedures") {
                    ProceduresRow(ident: plan.dep, kinds: ["departure"])
                    ForEach(plan.stops + [plan.dest], id: \.self) { field in
                        ProceduresRow(ident: field, kinds: ["arrival", "approach"])
                    }
                }
            }
        case .leg(let leg): LegDetailView(leg: leg)
        case .list(let shows):
            AirportListView(shows: shows, nearest: nearest)
                .task { await findNearest() }
        }
    }

    /// The nav log as a page: each leg's row (FPL's LegRow) into its detail.
    private var navLog: some View {
        List {
            Section(plan.altitudeFt.map { "Nav log · \(Int($0).formatted()) ft" } ?? "Nav log") {
                ForEach(plan.legs) { leg in
                    NavigationLink(value: StripPage.leg(leg)) { LegRow(leg: leg) }
                }
            }
        }
    }

    // MARK: The field's line, done

    /// The pill up to half, where the answer is.
    private func up() {
        if detent == RootView.pill { detent = .medium }
    }

    private func run(_ line: String) async {
        guard let command = FieldCommands.read(line), !busy else { return }
        problem = nil
        busy = true
        text = ""
        focused = false
        let why = await perform(command, text: line)
        busy = false
        if let why { problem = why }
    }

    /// One line said: the route's idents are given the recognizer as
    /// words to listen for, so "KMSN" is not "Kay Em Ess En"; the words
    /// are handled as typed.
    private func hear() async {
        problem = nil
        focused = false
        hearing = true
        defer { hearing = false }
        if let said = await listener.hearOnce(words: plan.idents.filter { !$0.isEmpty }) {
            await run(said)
        } else {
            problem = listener.problem ?? "Nothing was heard."
        }
    }

    private func perform(_ command: FieldCommand, text: String) async -> String? {
        switch command {
        case .open(let screen):
            return open(screen)
        case .field(let ident):
            path.append(.airport(ident))
            up()
            return nil
        case .route(let typedDep, let stops, let dest):
            var dep = typedDep ?? plan.dep
            if dep.isEmpty {
                // One ident: from the field nearest the airplane, as the
                // first flight's card plans.
                if let at = ownShip.fix?.coordinate, let near = try? await Planner.nearest(lat: at.latitude, lon: at.longitude, limit: 1).first {
                    dep = near.ident
                }
                if dep.isEmpty, let home = session.pilot?.homeBase, !home.isEmpty { dep = home.uppercased() }
                if dep.isEmpty { return "Say where from too: \"C81 KDLH\", or allow your position." }
            }
            if dep == dest, stops.isEmpty { return "\(dest) is where you are. Say somewhere to fly to." }
            plan.dep = dep
            plan.stops = stops
            plan.dest = dest
            plan.plan()
            up()
            return nil
        case .place(let words):
            // The pilot's own commands in the words first, as the radio's
            // pill offers them: "direct Janesville", "altitude 5500".
            if let done = await spoken(text) { return done.isEmpty ? nil : done }
            if let why = await planTo(words) {
                // Not a place the search knows: a question after all.
                if !why.lowercased().contains("not found") { return why }
            } else {
                up()
                return nil
            }
            ask(text)
            return nil
        case .ask(let question):
            if let done = await spoken(question) { return done.isEmpty ? nil : done }
            ask(question)
            return nil
        }
    }

    private func ask(_ question: String) {
        client.ask(question, context: AssistantContext.make(plan: plan, ownShip: ownShip, session: session, minimums: verdict.minimums))
        up()
    }

    /// A command in the words, done at once: "direct <place>" through the
    /// engine's direct_of, found near the route as a clearance's place is
    /// (Planner.clearancePlaces); an altitude said as a clearance says it
    /// ("maintain four thousand five hundred", the engine's read_clearance)
    /// flown as the pilot's own. Nil where the words hold no command; ""
    /// where one was done; else why not.
    private func spoken(_ text: String) async -> String? {
        if let said = HeardCall.directOf(text) {
            guard plan.routed else { return "Direct To needs a route." }
            var near: [(Double, Double)] = []
            if let course = plan.course {
                near += [(course.departure.lat, course.departure.lon), (course.destination.lat, course.destination.lon)]
            }
            if let fix = ownShip.fix { near.append((fix.coordinate.latitude, fix.coordinate.longitude)) }
            let nearText = near.map { String(format: "%.3f,%.3f", $0.0, $0.1) }.joined(separator: ";")
            guard let found = try? await Planner.clearancePlaces(ClearanceAsk(near: nearText, route: [said])),
                  let ident = found.route?.first?.first(where: { $0.ident != nil })?.ident else {
                return "“\(said)” was not found near the route."
            }
            if plan.idents.contains(ident) {
                plan.directTo(ident, from: ownShip.fix)
            } else if let fix = ownShip.fix {
                plan.divert(to: ident, from: fix)
            } else {
                plan.stops.append(ident)
                plan.plan()
            }
            up()
            return ""
        }
        let lower = text.lowercased()
        if lower.contains("altitude") || lower.contains("climb") || lower.contains("descend") || lower.contains("maintain"),
           let ft = Clearance.read(text).maintainFt {
            guard plan.routed else { return "Plan a route first; then say an altitude, \"altitude 5500\"." }
            plan.ownAltitudeFt = Double(ft)
            plan.ownAltitudeLegal = false
            plan.plan()
            up()
            return ""
        }
        return nil
    }

    /// A place by name through the planner's places search, and the
    /// biggest field by it (the longest runway of the nearest five) the
    /// route's end; nil once planned, else why not.
    private func planTo(_ words: String) async -> String? {
        let found: [PlaceFound]
        do {
            found = try await Planner.places(words)
        } catch {
            return "The place could not be looked up: \(error.localizedDescription)"
        }
        guard let place = found.first else { return "“\(words)” was not found." }
        guard let fields = try? await Planner.nearest(lat: place.lat, lon: place.lon, limit: 5), !fields.isEmpty else {
            return "No field was found near \(place.label)."
        }
        let biggest = fields.max { ($0.longestRunwayFt ?? 0) < ($1.longestRunwayFt ?? 0) } ?? fields[0]
        return await perform(.route(dep: nil, stops: [], dest: biggest.ident), text: words)
    }

    private func findNearest() async {
        guard let at = ownShip.fix?.coordinate else { return }
        nearest = (try? await Planner.nearest(lat: at.latitude, lon: at.longitude, limit: 12)) ?? []
    }

    /// A screen by its word, each the existing one as a page of the
    /// stack; why not where the plan is not far enough along for it, in
    /// the web app's words.
    @discardableResult
    private func open(_ screen: FieldScreen) -> String? {
        let routed = plan.routed
        switch screen {
        case .airplane: path.append(.airplane); detent = .large
        case .logbook: path.append(.logbook); detent = .large
        case .instructor: path.append(.instructor); detent = .large
        case .settings: path.append(.settings); detent = .large
        case .brief:
            guard routed else { return "Plan a route first: a field, a town or two idents." }
            path.append(.brief); up()
        case .nearest:
            AirportShelf.shared.show(.nearest)
            path.append(.list(.nearest)); up()
        case .fuel, .food, .stops:
            // The fuel, food and rest stops are the web app's for now; the
            // nearest fields, which have the fuel, are here.
            AirportShelf.shared.show(.nearest)
            path.append(.list(.nearest)); up()
            return "Stops with fuel and food are on the website for now; these are the nearest fields."
        case .routes:
            guard routed else { return "Plan a route first, then its other ways are chips at the head of the strip." }
            up()
        case .altitude, .profile:
            guard routed, plan.profile != nil else { return "Plan a route first; then say an altitude, \"altitude 5500\"." }
            path.append(.profile); up()
        case .procedures:
            guard !plan.dest.isEmpty else { return "Plan a route first: the procedures are the destination's." }
            path.append(.procedures); up()
        case .navlog:
            guard routed, plan.course != nil else { return "Plan a route first." }
            path.append(.navlog); up()
        case .share:
            guard routed else { return "Plan a route first." }
            up()
            return "Share, File and Clear are under ••• at the head of the strip."
        case .file:
            guard routed, plan.totals != nil else { return "A flight plan needs a route from an airport, its nav log in." }
            path.append(.file); up()
        case .clearance, .radio:
            path.append(.clearance); up()
        case .dryrun:
            guard routed, plan.profile != nil else { return "Plan a route first." }
            path.append(.profile); up()
            return "Dry run is the Profile's button, at the side view's foot."
        case .saved, .recentRoutes:
            path.append(.flights); up()
        case .favorites:
            AirportShelf.shared.show(.favorites)
            path.append(.list(.favorites)); up()
        case .recents:
            AirportShelf.shared.show(.recents)
            path.append(.list(.recents)); up()
        case .map:
            return "The map's settings are in Settings."
        }
        return nil
    }
}
