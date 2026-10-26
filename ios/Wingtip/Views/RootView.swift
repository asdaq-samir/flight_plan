import CoreLocation
import SwiftUI

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
    @Environment(\.undoManager) private var undoManager
    @State private var detent: PresentationDetent = .medium
    @State private var sheetUp = true
    @State private var tab: Tabs = .fpl
    @State private var airports: [String] = []
    @State private var following = false
    @State private var routeAway = false
    @State private var fitRequest = 0
    // Setup's map switches (MapExtrasInput.Keys).
    @AppStorage(MapExtrasInput.Keys.waypoints) private var waypointsOn = false
    @AppStorage(MapExtrasInput.Keys.classB) private var classBOn = false
    @AppStorage(MapExtrasInput.Keys.plates) private var platesOn = true

    enum Tabs: Hashable { case fpl, airport, aircraft, setup }

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

    var body: some View {
        ChartMap(
            template: charts.template, minZoom: charts.base?.minZoom ?? 5, maxZoom: charts.base?.maxZoom ?? 12,
            course: plan.course, checkpoints: plan.checkpoints,
            shownWay: plan.shownWay?.path.compactMap { $0.count == 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil } ?? [],
            procedurePaths: plan.legs.compactMap { $0.procedure?.path.compactMap { $0.count == 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil } },
            simulated: dryRun.fix,
            traffic: traffic.on ? traffic.planes : [],
            ownFt: (dryRun.fix ?? ownShip.fix)?.altitudeFt,
            onRegion: { centre, radius in traffic.mapCentre = centre; traffic.mapRadiusNm = radius },
            // A field tapped on the chart opens its card, half way up, as
            // the web app does.
            onAirport: { ident in
                tab = .airport
                airports = [ident]
                if detent != .medium { detent = .medium }
            },
            following: $following, routeAway: $routeAway, fitRequest: fitRequest,
            flight: flightLayer,
            extras: MapExtrasInput(
                held: airports.last.flatMap { AirportRoute($0).heldPoint },
                waypoints: waypointsOn, classB: classBOn, plates: platesOn, approaches: plan.procedures,
                // A finger held on the chart: the airspace there, half way
                // up, as a field's card opens.
                onHold: { at in
                    tab = .airport
                    airports = [AirportRoute.airspace(lat: at.latitude, lon: at.longitude).text]
                    if detent != .medium { detent = .medium }
                },
                onWaypointStop: plan.routed ? { (ident: String) in plan.stops.append(ident); plan.plan() } : nil
            )
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
        .sheet(isPresented: $sheetUp) {
            SheetView(tab: $tab, airports: $airports, pill: detent == RootView.pill)
                .presentationDetents([RootView.pill, .medium, .large], selection: $detent)
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                .presentationBackground(.regularMaterial)
                .presentationCornerRadius(24)
                .interactiveDismissDisabled()
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

struct ComingView: View {
    let title: String
    let detail: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView(title, systemImage: "hammer", description: Text(detail))
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}
