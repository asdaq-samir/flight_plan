import SwiftUI

/// The third screen layout, "field-tabs", the owner's pick of 2026-11-04
/// after Target's app: the strip's one field with an Ask pill inside it,
/// above the four tabs' bar, as the sheet's pill; half way and up, the
/// current tab's content as the tabs layout shows it (FPLView,
/// AirportSearchView, AircraftView, SetupView), the field and the bar
/// staying at the foot. Tried beside Tabs and Strip, so the owner can
/// compare the three on the phone; it changes nothing in the other two.
///
/// The field is read as the strip's is (FieldCommands.read: idents a
/// route, "about KDLH" a card, a town a place, a screen's word that
/// screen, else a question) and done with the tabs' own homes: a field's
/// card in the Airport tab, the airplane in Aircraft, Settings in Setup;
/// the pages the tabs reach only from inside (the Brief, the nav log, the
/// logbook) open as a sheet of their own with a title and a close. The
/// Ask pill puts the field in ask mode, where every line goes to the
/// assistant (AssistantClient) and never to the parser, and the answer is
/// the strip's card (StripAnswerCard) over the content. In the air the
/// field is the radio, as the strip's is.
///
/// SheetView's bar is the system TabView's, which cannot take a row above
/// it, so the bar here is a row of the same four words and glyphs with
/// the current one in a tinted capsule, 44-point targets; and
/// StripFieldRow always draws the profile avatar beside the field and
/// has no slot for the pill, so the field is composed here from the same
/// parts (the profile lives in Setup, as in the tabs layout).
struct FieldTabsSheetView: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(DryRun.self) private var dryRun
    @Environment(Session.self) private var session
    @Environment(Verdict.self) private var verdict
    @Environment(\.chartInk) private var ink
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The current tab, RootView's: Siri's commands and the map's taps
    /// change it as they do in the tabs layout.
    @Binding var tab: RootView.Tabs
    /// The sheet's size, RootView's: the field focused brings it up clear
    /// of the keyboard; a route planned brings the pill to half.
    @Binding var detent: PresentationDetent
    /// A field or a point opened from the map (the Airport tab's stack).
    @Binding var airports: [String]
    /// At the pill: the field and the bar, nothing else.
    var pill: Bool
    @State private var text = ""
    @State private var asking = false
    @State private var problem: String?
    @State private var busy = false
    @State private var hearing = false
    @State private var client = AssistantClient()
    @State private var page: StripSheetView.StripPage?
    @State private var nearest: [NearestAirport] = []
    @FocusState private var focused: Bool
    private var listener: ClearanceListener { ClearanceListener.shared }

    /// The sheet's lowest size for this layout: the grabber, the field's
    /// row (44) with its margins, and the bar (50) -- taller than the tabs'
    /// pill, which holds one row of figures over the bar.
    static let pill = PresentationDetent.height(136)

    /// Where a screen's word lands in this layout: a tab, one of the
    /// Airport tab's lists, a page of its own, or words saying where it is.
    enum Home: Equatable {
        case tab(RootView.Tabs)
        case list(AirportShelf.Shows)
        case page(StripSheetView.StripPage)
        case words(String)

        /// The tabs' own homes first (the airplane, Settings, the Airport
        /// tab's lists); what the tabs reach only from inside, a page.
        static func of(_ screen: FieldScreen) -> Home {
            switch screen {
            case .airplane: return .tab(.aircraft)
            case .settings: return .tab(.setup)
            case .logbook: return .page(.logbook)
            case .instructor: return .page(.instructor)
            case .nearest: return .list(.nearest)
            case .favorites: return .list(.favorites)
            case .recents: return .list(.recents)
            case .fuel, .food, .stops: return .list(.nearest)
            case .brief: return .page(.brief)
            case .navlog: return .page(.navlog)
            case .altitude, .profile, .dryrun: return .page(.profile)
            case .procedures: return .page(.procedures)
            case .file: return .page(.file)
            case .clearance, .radio: return .page(.clearance)
            case .saved, .recentRoutes: return .page(.flights)
            case .routes: return .tab(.fpl)
            case .share: return .words("Share, File and Clear are under ••• in the flight plan.")
            case .map: return .words("The map's settings are in Setup.")
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

    private var flying: Bool { flyingFix != nil }
    private var listening: Bool { hearing || listener.hearingOnce }

    var body: some View {
        VStack(spacing: 0) {
            // The tab's content keeps its state through the pill (its
            // stacks, its search), hidden rather than taken down.
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .opacity(pill ? 0 : 1)
                .allowsHitTesting(!pill)
                .accessibilityHidden(pill)
            foot
        }
        .animation(.easeOut(duration: 0.2), value: pill)
        .chartInkTheme()
        // A field tapped on the chart, or a point held: its card in the
        // Airport tab, half way up, as the tabs layout opens it.
        .onChange(of: airports) { _, now in
            if !now.isEmpty {
                tab = .airport
                if detent == FieldTabsSheetView.pill { detent = .medium }
            }
        }
        .onChange(of: focused) { _, now in
            if now, detent != .large { detent = .large }
        }
        // The Go / No-Go, asked as the Brief asks it, for the assistant's
        // context (the pilot's minimums).
        .task(id: verdict.key(for: plan)) { await verdict.refresh(plan: plan, signedIn: session.signedIn) }
        .onChange(of: plan.tail, initial: true) { _, tail in listener.tail = tail }
        // The Undo bar over the bar, where the edit was made.
        .overlay(alignment: .bottom) {
            UndoBar()
                .padding(.bottom, 104)
                .animation(.easeOut(duration: 0.25), value: plan.undoNote)
        }
        // An airplane's card, a point pressed on the map, a hold, a flown
        // track, over the tabs as in the other layouts.
        .modifier(FlightSheets())
        .sheet(item: $page) { page in pageSheet(page) }
        .accessibilityIdentifier("field-tabs-sheet")
    }

    /// The current tab's content, the same views the tabs layout holds.
    @ViewBuilder
    private var content: some View {
        switch tab {
        case .fpl: FPLView()
        case .airport: AirportSearchView(path: $airports)
        case .aircraft: AircraftView()
        case .setup: SetupView()
        }
    }

    // MARK: The foot: the answer, the field's row and the bar

    private var foot: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !client.turns.isEmpty, !flying {
                // The assistant's last answer, over the content and above
                // the field it was asked in; a long one scrolls.
                ScrollView {
                    StripAnswerCard(client: client, onClose: { client.clear(); asking = false })
                        .padding(.horizontal, 16).padding(.vertical, 8)
                }
                .frame(maxHeight: 280)
            }
            if flying { radio }
            fieldRow
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .padding(.bottom, 8)
            if let problem {
                Text(problem).font(ChartInk.note).foregroundStyle(.red)
                    .padding(.horizontal, 20).padding(.bottom, 6)
                    .accessibilityAddTraits(.isStaticText)
            }
            if focused, text.isEmpty, !flying, !asking {
                StripSuggestions(suggestions: StripData.suggestions(routed: plan.routed, dest: plan.dest)) { words in
                    Task { await run(words) }
                }
            }
            bar
        }
        .background(.regularMaterial)
        .animation(.easeOut(duration: 0.3), value: focused)
        .animation(.easeOut(duration: 0.3), value: asking)
    }

    private var placeholder: String {
        if flying { return listening ? "Listening…" : "Tap the mic and say it" }
        return asking ? "Ask anything" : "Where to, or ask"
    }

    /// The strip's field (StripFieldRow's glass capsule: the magnifier,
    /// the words, a clear, the mic) with the Ask pill at its right end;
    /// no avatar. In the air it is the radio's, 60 points tall, read-only.
    private var fieldRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(ink.muted)
                .accessibilityHidden(true)
            TextField(placeholder, text: $text)
                .font(ChartInk.text)
                .focused($focused)
                .submitLabel(asking ? .send : .go)
                .textInputAutocapitalization(asking ? .sentences : .characters)
                .autocorrectionDisabled(!asking)
                .disabled(flying || busy)
                .onSubmit { Task { await run(text) } }
                .accessibilityLabel(flying ? "The radio" : asking ? "Ask the assistant" : "Where to, or ask anything")
            if !text.isEmpty && !flying {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(ink.muted)
                        .contentShape(Rectangle().inset(by: -8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
            Button { Task { await hear() } } label: {
                Image(systemName: listening ? "mic.fill" : "mic")
                    .font(flying ? .title3.weight(.medium) : .body.weight(.medium))
                    .foregroundStyle(listening ? ink.tint : ink.muted)
                    .symbolEffect(.pulse, isActive: listening && !reduceMotion)
                    // The 44-point hit area round the glyph (60 in the air),
                    // which does not grow.
                    .frame(width: flying ? 44 : 28, height: flying ? 44 : 28)
                    .contentShape(Rectangle().inset(by: -8))
            }
            .buttonStyle(.plain)
            .disabled(listening || busy)
            .accessibilityLabel(listening ? "Listening" : "Say it")
            if !flying {
                AskPill(on: asking) { toggleAsk() }
            }
        }
        .padding(.horizontal, 12)
        .frame(height: flying ? 60 : 44)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(ink.ink.opacity(0.08), lineWidth: 1))
        .accessibilityIdentifier("field-tabs-field")
    }

    /// The tabs layout's four tabs, the same words and glyphs, the current
    /// one in a tinted capsule (Target's bar); each a 44-point target.
    private var bar: some View {
        HStack(spacing: 8) {
            tabButton(.fpl, "FPL", "point.topleft.down.to.point.bottomright.curvepath")
            tabButton(.airport, "Airport", "airplane.departure")
            tabButton(.aircraft, "Aircraft", "airplane")
            tabButton(.setup, "Setup", "gearshape")
        }
        .padding(.horizontal, 12)
        .frame(height: 50)
        .accessibilityIdentifier("field-tabs-bar")
    }

    private func tabButton(_ which: RootView.Tabs, _ title: String, _ glyph: String) -> some View {
        let current = tab == which
        return Button {
            if tab == which {
                // The current tab tapped again at the pill: half way up,
                // as the tabs' bar brings its content into sight.
                if detent == FieldTabsSheetView.pill { detent = .medium }
            } else {
                tab = which
                if detent == FieldTabsSheetView.pill { detent = .medium }
            }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: glyph).font(.body.weight(.medium))
                Text(title).font(.caption2.weight(current ? .semibold : .regular))
            }
            .foregroundStyle(current ? ink.tint : ink.muted)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(current ? ink.tint.opacity(ink.night ? 0.22 : 0.12) : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(current ? [.isSelected, .isButton] : .isButton)
        .accessibilityIdentifier("tab-\(which.rawValue)")
    }

    /// The radio in the air: a call to us with its chips (RadioCallBanner),
    /// and the captions of what the radio says.
    @ViewBuilder
    private var radio: some View {
        VStack(alignment: .leading, spacing: 8) {
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
        .padding(.horizontal, 16).padding(.top, 8)
    }

    /// A page the tabs reach only from inside, as a sheet of its own with
    /// its title and a close, over this sheet as Ask is over the tabs.
    private func pageSheet(_ page: StripSheetView.StripPage) -> some View {
        NavigationStack {
            Group {
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
            .navigationTitle(page.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { self.page = nil } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// The nav log as a page: each leg's row (FPL's LegRow) into its detail.
    private var navLog: some View {
        List {
            Section(plan.altitudeFt.map { "Nav log · \(Int($0).formatted()) ft" } ?? "Nav log") {
                ForEach(plan.legs) { leg in
                    NavigationLink { LegDetailView(leg: leg) } label: { LegRow(leg: leg) }
                }
            }
        }
    }

    // MARK: The field's line, done

    /// The pill up to half, where the answer is.
    private func up() {
        if detent == FieldTabsSheetView.pill { detent = .medium }
    }

    /// The Ask pill: ask mode on and the field focused; on again, off.
    private func toggleAsk() {
        asking.toggle()
        problem = nil
        if asking { focused = true }
    }

    private func run(_ line: String) async {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !busy else { return }
        problem = nil
        text = ""
        focused = false
        if asking {
            // Ask mode: the line is the assistant's, whatever it says.
            ask(trimmed)
            return
        }
        guard let command = FieldCommands.read(trimmed) else { return }
        busy = true
        let why = await perform(command, text: trimmed)
        busy = false
        if let why { problem = why }
    }

    /// One line said: the route's idents are given the recognizer as
    /// words to listen for, so "KMSN" is not "Kay Em Ess En"; the words
    /// are handled as typed, or in ask mode asked.
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
            tab = .airport
            airports.append(ident)
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
            tab = .fpl
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
            tab = .fpl
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
            tab = .fpl
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

    /// A screen by its word, in its home here (Home.of); why not where
    /// the plan is not far enough along for it, in the web app's words.
    @discardableResult
    private func open(_ screen: FieldScreen) -> String? {
        let routed = plan.routed
        switch screen {
        case .brief, .routes:
            guard routed else { return "Plan a route first: a field, a town or two idents." }
        case .altitude, .profile, .dryrun:
            guard routed, plan.profile != nil else { return "Plan a route first; then say an altitude, \"altitude 5500\"." }
        case .procedures:
            guard !plan.dest.isEmpty else { return "Plan a route first: the procedures are the destination's." }
        case .navlog:
            guard routed, plan.course != nil else { return "Plan a route first." }
        case .share:
            guard routed else { return "Plan a route first." }
        case .file:
            guard routed, plan.totals != nil else { return "A flight plan needs a route from an airport, its nav log in." }
        default:
            break
        }
        switch Home.of(screen) {
        case .tab(let which):
            tab = which
            // The flight half way up, as a route planned is; a screen of
            // settings or the airplane all the way, as the strip opens them.
            if which == .fpl { up() } else { detent = .large }
        case .list(let shows):
            AirportShelf.shared.show(shows)
            tab = .airport
            up()
            if screen == .fuel || screen == .food || screen == .stops {
                // The fuel, food and rest stops are the web app's for now;
                // the nearest fields, which have the fuel, are here.
                return "Stops with fuel and food are on the website for now; these are the nearest fields."
            }
        case .page(let page):
            self.page = page
            up()
            if screen == .dryrun { return "Dry run is the Profile's button, at the side view's foot." }
        case .words(let words):
            up()
            return words
        }
        return nil
    }
}

/// A page as a sheet's item: the page is its own identity.
extension StripSheetView.StripPage: Identifiable {
    var id: StripSheetView.StripPage { self }
}

#Preview("FieldTabsSheetView") {
    @Previewable @State var tab: RootView.Tabs = .fpl
    @Previewable @State var detent: PresentationDetent = .medium
    @Previewable @State var airports: [String] = []
    FieldTabsSheetView(tab: $tab, detent: $detent, airports: $airports, pill: false)
        .environment(Session())
        .environment(Charts())
        .environment(Plan())
        .environment(OwnShip())
        .environment(DryRun())
        .environment(Traffic())
        .environment(Verdict())
}
