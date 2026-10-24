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

    enum Tabs: Hashable { case fpl, airport, aircraft, setup }

    var body: some View {
        ChartMap(
            template: charts.template, minZoom: charts.base?.minZoom ?? 5, maxZoom: charts.base?.maxZoom ?? 12,
            course: plan.course,
            // A field tapped on the chart: the destination where the route
            // has none, else the Airport tab's search, filled in.
            onAirport: { ident in
                if plan.dep.isEmpty { plan.dep = ident } else if plan.dest.isEmpty { plan.dest = ident; plan.plan() }
                tab = plan.routed ? .fpl : .airport
                if detent == .large { detent = .medium }
            }
        )
        .ignoresSafeArea()
        .sheet(isPresented: $sheetUp) {
            SheetView(tab: $tab)
                .presentationDetents([.height(132), .medium, .large], selection: $detent)
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

    var body: some View {
        TabView(selection: $tab) {
            Tab("FPL", systemImage: "point.topleft.down.to.point.bottomright.curvepath", value: RootView.Tabs.fpl) {
                FPLView()
            }
            Tab("Airport", systemImage: "airplane.departure", value: RootView.Tabs.airport) {
                AirportSearchView()
            }
            Tab("Aircraft", systemImage: "airplane", value: RootView.Tabs.aircraft) {
                ComingView(title: "Aircraft", detail: "The airplane by its N-number and its planning figures come in phase 3.")
            }
            Tab("Setup", systemImage: "gearshape", value: RootView.Tabs.setup) {
                SetupView()
            }
        }
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
