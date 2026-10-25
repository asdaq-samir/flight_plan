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
    @State private var detent: PresentationDetent = .medium
    @State private var sheetUp = true
    @State private var tab: Tabs = .fpl
    @State private var airports: [String] = []
    @State private var following = false
    @State private var routeAway = false
    @State private var fitRequest = 0

    enum Tabs: Hashable { case fpl, airport, aircraft, setup }

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
            following: $following, routeAway: $routeAway, fitRequest: fitRequest
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
                // The licence's credit, beside the traffic it covers.
                if traffic.on, !traffic.planes.isEmpty {
                    Text(Traffic.credit(traffic.source)).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.thinMaterial, in: Capsule())
                }
            }
            .padding(.leading, 12).padding(.top, 12)
        }
        .task { await traffic.run { [ownShip] in ownShip.fix?.coordinate } }
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
