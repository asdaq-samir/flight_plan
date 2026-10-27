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
    @Environment(\.undoManager) private var undoManager
    @State private var detent: PresentationDetent = .medium
    @State private var sheetUp = true
    // The tab opened first; a launch argument (-tab airport) picks
    // another, for CI's pictures of each.
    @State private var tab: Tabs = Tabs(rawValue: UserDefaults.standard.string(forKey: "tab") ?? "") ?? .fpl
    @State private var airports: [String] = []
    @State private var following = false
    @State private var routeAway = false
    @State private var fitRequest = 0
    /// The iPad's inspector card (SplitLayout).
    @State private var sideCard: SideCard?
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

    private var layout: RootLayout { .of(sizeClass, pad: UIDevice.current.userInterfaceIdiom == .pad) }

    var body: some View {
        switch layout {
        case .sheet:
            map
                .sheet(isPresented: $sheetUp) {
                    SheetView(tab: $tab, airports: $airports, pill: detent == RootView.pill)
                        .presentationDetents([RootView.pill, .medium, .large], selection: $detent)
                        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                        .presentationBackground(.regularMaterial)
                        .presentationCornerRadius(24)
                        .interactiveDismissDisabled()
                }
        case .split:
            SplitLayout(map: map, tab: $tab, airports: $airports, card: $sideCard)
        }
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
            MapButtons(following: $following, routeAway: routeAway && plan.course != nil, fitRoute: { fitRequest += 1 })
        }
        .overlay(alignment: .top) {
            AlertsBanner(alerts: ownShip.ahead).padding(.trailing, 64)
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
        .task { await traffic.run { [ownShip] in ownShip.fix?.coordinate } }
        // The airplane tracked, its reports from the map's answers and its
        // own; the watches set; the alerts ahead said aloud where asked.
        .task { await Tracking.shared.run() }
        .onChange(of: traffic.planes) { _, planes in Tracking.shared.heard(planes) }
        .onChange(of: ownShip.ahead) { _, alerts in SpokenAlerts.shared.hear(alerts) }
        // The window's UndoManager for the route's history: shake to undo
        // and the Edit menu (PlanHistory).
        .onAppear { plan.undoManager = undoManager }
        .onChange(of: undoManager) { _, manager in plan.undoManager = manager }
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
    }
}
