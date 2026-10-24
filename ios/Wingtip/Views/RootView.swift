import SwiftUI

/// The map under a sheet with three sizes -- the pill, half and full, as
/// Apple Maps has them and as the web app imitates them -- holding the
/// four tabs. The system's own sheet, so the drag, the detents and the
/// glass are iOS's, not a copy.
struct RootView: View {
    @Environment(Charts.self) private var charts
    @State private var detent: PresentationDetent = .medium
    @State private var sheetUp = true

    var body: some View {
        ChartMap(template: charts.template, minZoom: charts.base?.minZoom ?? 5, maxZoom: charts.base?.maxZoom ?? 12)
            .ignoresSafeArea()
            .sheet(isPresented: $sheetUp) {
                SheetView()
                    .presentationDetents([.height(132), .medium, .large], selection: $detent)
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .presentationBackground(.regularMaterial)
                    .presentationCornerRadius(24)
                    .interactiveDismissDisabled()
            }
    }
}

/// The four tabs of the planner, in the sheet: FPL, Airport, Aircraft
/// and Setup. Phase 0 fills Setup; the others say what is coming.
struct SheetView: View {
    var body: some View {
        TabView {
            Tab("FPL", systemImage: "point.topleft.down.to.point.bottomright.curvepath") {
                ComingView(title: "Flight plan", detail: "The route box, the route in order and the nav log come in phase 1.")
            }
            Tab("Airport", systemImage: "airplane.departure") {
                ComingView(title: "Airport", detail: "Search, favourites and the airport's card come in phase 1.")
            }
            Tab("Aircraft", systemImage: "airplane") {
                ComingView(title: "Aircraft", detail: "The airplane by its N-number and its planning figures come in phase 3.")
            }
            Tab("Setup", systemImage: "gearshape") {
                SetupView()
            }
        }
    }
}

private struct ComingView: View {
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
