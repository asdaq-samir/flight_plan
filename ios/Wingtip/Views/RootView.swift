import CoreLocation
import SwiftUI
import UIKit

/// The map under a sheet with three sizes -- the pill, half and full, as
/// Apple Maps has them and as the web app imitates them -- holding the
/// four tabs. The system's own sheet, so the drag, the detents and the
/// glass are iOS's, not a copy.
struct RootView: View {
    @Environment(Charts.self) private var charts
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(DryRun.self) private var dryRun
    @Environment(Traffic.self) private var traffic
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.undoManager) private var undoManager
    @State private var detent: PresentationDetent = .medium
    @State private var sheetUp = true
    // The tab opened first; a launch argument (-tab airport) picks
    // another, for CI's pictures of each. The tab a scene was on comes
    // back with the scene (SceneStorage), as Apple restores state: a
    // restored scene lands where the pilot left it, not on the plan.
    @SceneStorage("tab") private var sceneTab: String?
    /// The screen's layout, as the web app's Screen row has it: the four
    /// tabs, or the strip (StripSheetView: one field, the flight as one
    /// strip; the owner's pick of 2026-11-04). The same key as the web's
    /// preference; a `-layout strip` launch argument sets it for CI's
    /// pictures.
    @AppStorage("layout") private var layoutName = "tabs"
    @State private var tab: Tabs = Tabs(rawValue: UserDefaults.standard.string(forKey: "tab") ?? "") ?? .fpl
    @State private var airports: [String] = []
    @State private var following = false
    @State private var routeAway = false
    @State private var fitRequest = 0
    /// Ask (AskView) up: a sheet over the tabs' sheet on the iPhone, so the
    /// system presents it, since one view presents one sheet at a time;
    /// over the map on the iPad.
    @State private var asking = false
    /// The iPad's inspector card (SplitLayout).
    @State private var sideCard: SideCard?
    /// What Siri or a Shortcut asked for (the App Intents), done here once
    /// the app is on the screen: the owner's ask, 2026-11-03, Siri and
    /// Shortcuts through App Intents.
    @State private var pending = PendingCommand.shared
    // Setup's map switches (MapExtrasInput.Keys).
    @AppStorage(MapExtrasInput.Keys.waypoints) private var waypointsOn = false
    @AppStorage(MapExtrasInput.Keys.classB) private var classBOn = false
    @AppStorage(MapExtrasInput.Keys.plates) private var platesOn = true

    enum Tabs: String, Hashable { case fpl, airport, aircraft, setup }

    /// What the map draws of the airplane tracked and the flights flown,
    /// and its taps for them: an airplane's card, a point pressed.
    private var flightLayer: FlightLayer {
        let tracking = Tracking.shared
        return FlightLayer(
            trackedHex: tracking.hex, tracked: tracking.latest, follow: tracking.follow,
            path: tracking.path, past: tracking.past, flown: tracking.flown,
            onTraffic: { plane in
                Tracking.shared.track(plane.hex, plane: plane)
                FlightUI.shared.card = .airplane(plane.hex.lowercased())
            },
            onDragged: { Tracking.shared.follow = false }
        )
    }

    /// The sheet's lowest size, the pill: the figures' line and the tabs'
    /// names, as the web app's pill is.
    static let pill = PresentationDetent.height(132)

    private var layout: RootLayout { .of(sizeClass, verticalSizeClass) }

    var body: some View {
        Group {
            switch layout {
            case .sheet:
                map
                    .sheet(isPresented: $sheetUp) {
                        Group {
                            if layoutName == "strip" {
                                StripSheetView(detent: $detent, airports: $airports)
                            } else {
                                SheetView(tab: $tab, airports: $airports, pill: detent == RootView.pill, asking: $asking)
                            }
                        }
                        .presentationDetents([RootView.pill, .medium, .large], selection: $detent)
                        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                        .presentationBackground(.regularMaterial)
                        .presentationCornerRadius(24)
                        .interactiveDismissDisabled()
                    }
            case .split:
                SplitLayout(map: map, tab: $tab, airports: $airports, card: $sideCard)
                    .sheet(isPresented: $asking) { AskView() }
            }
        }
        // The scene's tab kept and brought back (SceneStorage); a launch
        // argument's tab (CI's pictures) wins over the kept one.
        .onAppear {
            if let raw = sceneTab, let kept = Tabs(rawValue: raw), !CommandLine.arguments.contains("-tab") { tab = kept }
            if let at = CommandLine.arguments.firstIndex(of: "-layout"), at + 1 < CommandLine.arguments.count {
                layoutName = CommandLine.arguments[at + 1]
            }
        }
        .onChange(of: tab) { _, now in sceneTab = now.rawValue }
    }

    /// A field or a point opened from the map: in the Airport tab, half
    /// way up, on the iPhone; in the inspector on the iPad.
    private func open(_ route: String) {
        if layout == .split {
            sideCard = .airport(route)
            return
        }
        tab = .airport
        airports = [route]
        if detent != .medium { detent = .medium }
    }

    /// The point held on the map, whichever holds its card.
    private var heldRoute: String? {
        if layout == .split {
            if case .airport(let text) = sideCard { return text }
            return nil
        }
        return airports.last
    }

    /// The map with its buttons and banners, under the sheet or beside
    /// the sidebar.
    private var map: some View {
        ChartMap(
            template: charts.template, minZoom: charts.base?.minZoom ?? 5, maxZoom: charts.base?.maxZoom ?? 12,
            course: plan.course, checkpoints: plan.checkpoints,
            procedurePaths: plan.legs.compactMap { $0.procedure?.path.compactMap { $0.count == 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil } },
            // A flown track's replay, else the dry run: the same airplane.
            simulated: Replay.shared.fix ?? dryRun.fix,
            traffic: traffic.on ? traffic.planes : [],
            ownFt: (dryRun.fix ?? ownShip.fix)?.altitudeFt,
            onRegion: { centre, radius in traffic.mapCentre = centre; traffic.mapRadiusNm = radius },
            // A field tapped on the chart opens its card, half way up, as
            // the web app does.
            onAirport: { ident in open(ident) },
            following: $following, routeAway: $routeAway, fitRequest: fitRequest,
            flight: flightLayer,
            extras: MapExtrasInput(
                held: heldRoute.flatMap { AirportRoute($0).heldPoint },
                waypoints: waypointsOn, classB: classBOn, plates: platesOn, approaches: plan.procedures,
                // A finger held on the chart: the airspace there, half way
                // up, as a field's card opens.
                onHold: { at in open(AirportRoute.airspace(lat: at.latitude, lon: at.longitude).text) },
                onWaypointStop: plan.routed ? { (ident: String) in plan.stops.append(ident); plan.plan() } : nil
            ),
            hazardLegs: plan.hazardLegs
        )
        .ignoresSafeArea()
        .overlay(alignment: .topTrailing) {
            // In the strip the field is the way to the assistant, so the
            // sparkle is not drawn.
            MapButtons(following: $following, routeAway: routeAway && plan.course != nil, fitRoute: { fitRequest += 1 },
                       ask: layoutName == "strip" ? nil : { asking = true })
        }
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                AlertsBanner(alerts: ownShip.ahead)
                // The radio, while the app listens or a call to us waits.
                RadioOverlay()
            }
            .padding(.trailing, 64)
        }
        .overlay(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 8) {
                if dryRun.fix != nil { DryRunControls() }
                WatchBanner()
                // The licence's credit, beside the traffic it covers.
                if traffic.on, !traffic.planes.isEmpty {
                    Text(Traffic.credit(traffic.source)).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.thinMaterial, in: Capsule())
                }
            }
            .padding(.leading, 12).padding(.top, 12)
        }
        // About own ship's real fix, never the dry run's: the traffic near
        // it is told in a notification (Traffic.tellNear).
        .task { await traffic.run { [ownShip] in ownShip.fix } }
        // The airplane tracked, its reports from the map's answers and its
        // own; the watches set; the alerts ahead said aloud where asked.
        .task { await Tracking.shared.run() }
        .onChange(of: traffic.planes) { _, planes in Tracking.shared.heard(planes) }
        .onChange(of: ownShip.ahead) { _, alerts in SpokenAlerts.shared.hear(alerts) }
        // The window's UndoManager for the route's history: shake to undo
        // and the Edit menu (PlanHistory).
        .onAppear { plan.undoManager = undoManager }
        .onChange(of: undoManager) { _, manager in plan.undoManager = manager }
        // Siri listens for the fields the shortcuts' airport entity
        // suggests (the kept route's: AirportEntityQuery.suggestedEntities), so
        // the phrases are told again when the route changes.
        .onAppear { WingtipShortcuts.updateAppShortcutParameters() }
        .onChange(of: plan.idents) { _, _ in WingtipShortcuts.updateAppShortcutParameters() }
        // Siri's or a Shortcut's ask, taken as it comes and as the app
        // opens with one waiting (the intents run before this has drawn).
        .task(id: pending.command) { await apply(pending.take()) }
    }

    /// Siri's or a Shortcut's command done in the app: a trip planned to
    /// the field, direct to a place, the nearest airports, a field's card.
    private func apply(_ command: PendingCommand.Command?) async {
        guard let command else { return }
        switch command {
        case .planTo(let ident):
            // From the route's departure, else from the field nearest the
            // airplane; with neither, the FPL tab with the destination in
            // for the pilot to give the departure.
            plan.dest = ident
            if plan.dep.isEmpty, let at = ownShip.fix?.coordinate,
               let nearest = try? await Planner.nearest(lat: at.latitude, lon: at.longitude, limit: 1).first {
                plan.dep = nearest.ident
            }
            tab = .fpl
            if detent != .medium { detent = .medium }
            plan.plan()
        case .directTo(let said):
            // The place found near the route as a clearance's is (the
            // radio's Direct To does the same); not on the route, a
            // diversion to it from where the airplane is.
            var points: [(Double, Double)] = []
            if let course = plan.course {
                points += [(course.departure.lat, course.departure.lon), (course.destination.lat, course.destination.lon)]
            }
            if let fix = ownShip.fix { points.append((fix.coordinate.latitude, fix.coordinate.longitude)) }
            let near = points.map { String(format: "%.3f,%.3f", $0.0, $0.1) }.joined(separator: ";")
            let found = try? await Planner.clearancePlaces(ClearanceAsk(near: near, route: [said]))
            guard let ident = found?.route?.first?.first(where: { $0.ident != nil })?.ident ?? (IntentLookups.looksLikeIdent(said) ? said.uppercased() : nil) else { return }
            if plan.routed, plan.idents.contains(ident) {
                plan.directTo(ident, from: ownShip.fix)
            } else if let fix = ownShip.fix {
                plan.divert(to: ident, from: fix)
            } else {
                plan.dest = ident
                tab = .fpl
                plan.plan()
            }
            if detent != .medium { detent = .medium }
        case .nearest:
            AirportShelf.shared.show(.nearest)
            tab = .airport
            if detent != .medium { detent = .medium }
        case .weather(let ident):
            open(ident)
        case .planRoute(let dep, let stops, let dest):
            // A route shared from the site, planned here as it was there.
            plan.dep = dep; plan.stops = stops; plan.dest = dest
            tab = .fpl
            if detent != .medium { detent = .medium }
            plan.plan()
        case .aircraft(let hex):
            // The airplane's card, tracked from its next report on.
            Tracking.shared.track(hex)
            FlightUI.shared.card = .airplane(hex)
        case .track(let url):
            // A GPX or KML file handed over from Files or Mail: its track
            // flown again on the map (Replay), at the replay's pace, as a
            // saved flight's is from its card. A file with no timed points
            // is left alone; the card's own import says why.
            let reading = url.startAccessingSecurityScopedResource()
            defer { if reading { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url), let points = GPXTrack.points(data), !points.isEmpty else { return }
            Replay.shared.load(Replay.points(points), key: url.lastPathComponent)
            Replay.shared.play()
            if detent != RootView.pill { detent = RootView.pill }
        }
    }
}

/// The four tabs of the planner, in the sheet: FPL, Airport, Aircraft
/// and Setup.
struct SheetView: View {
    @Environment(Plan.self) private var plan
    @Binding var tab: RootView.Tabs
    @Binding var airports: [String]
    /// At the pill: the figures over the tab bar, nothing else.
    var pill: Bool
    /// Ask (AskView) presented from here, a sheet over this one: the map's
    /// sparkle button sets it (RootView).
    @Binding var asking: Bool

    var body: some View {
        TabView(selection: $tab) {
            Tab("FPL", systemImage: "point.topleft.down.to.point.bottomright.curvepath", value: RootView.Tabs.fpl) {
                FPLView()
            }
            Tab("Airport", systemImage: "airplane.departure", value: RootView.Tabs.airport) {
                AirportSearchView(path: $airports)
            }
            Tab("Aircraft", systemImage: "airplane", value: RootView.Tabs.aircraft) {
                AircraftView()
            }
            Tab("Setup", systemImage: "gearshape", value: RootView.Tabs.setup) {
                SetupView()
            }
        }
        // The pill shows the flight's figures where the tab's own content
        // would be out of sight anyway, over the tab bar.
        .overlay(alignment: .top) {
            if pill {
                FiguresStrip()
                    .padding(.top, 14)
                    .frame(maxWidth: .infinity)
                    .background(.regularMaterial)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: pill)
        // The Undo bar over the tab bar, where the edit was made.
        .overlay(alignment: .bottom) {
            UndoBar()
                .padding(.bottom, 60)
                .animation(.easeOut(duration: 0.25), value: plan.undoNote)
        }
        // An airplane's card, a point pressed on the map, a hold, a flown
        // track, over the tabs.
        .modifier(FlightSheets())
        .sheet(isPresented: $asking) { AskView() }
    }
}

#Preview("RootView") {
    RootView()
        .environment(Session())
        .environment(Charts())
        .environment(Plan())
        .environment(OwnShip())
        .environment(DryRun())
        .environment(Traffic())
        .environment(Verdict())
}

#Preview("SheetView") {
    @Previewable @State var tab: RootView.Tabs = .fpl
    @Previewable @State var airports: [String] = []
    SheetView(tab: $tab, airports: $airports, pill: false, asking: .constant(false))
        .environment(Session())
        .environment(Charts())
        .environment(Plan())
        .environment(OwnShip())
        .environment(DryRun())
        .environment(Traffic())
        .environment(Verdict())
}
