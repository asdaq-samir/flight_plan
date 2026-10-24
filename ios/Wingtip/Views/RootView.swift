import SwiftUI

/// The map under a sheet with three sizes -- the pill, half and full, as
/// Apple Maps has them and as the web app imitates them -- holding the
/// four tabs. The system's own sheet, so the drag, the detents and the
/// glass are iOS's, not a copy.
struct RootView: View {
    @Environment(Charts.self) private var charts
    @Environment(Plan.self) private var plan
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
