import SwiftUI

/// Wingtip Maps, native: the FAA chart that works like Apple Maps, and
/// the route, checkpoints and nav log for a flight, on the same planner
/// and gateway as the website (docs/NATIVE.md). The web app stays the
/// product until this one passes the plan's gates.
@main
struct WingtipApp: App {
    @State private var session = Session()
    @State private var charts = Charts()
    @State private var plan = Plan()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(charts)
                .environment(plan)
                .task { await session.refresh() }
                .task { await charts.load() }
                .task { plan.restore() }
                // The sign-in link from Mail opens the app (Associated
                // Domains): its token is handed to the gateway here, and
                // the pilot is signed in without a browser.
                .onOpenURL { url in Task { await session.open(url) } }
        }
    }
}
