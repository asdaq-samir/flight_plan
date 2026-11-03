import SwiftUI

/// Wingtip Maps on the wrist (the owner's ask of 2026-11-03): the timers
/// a pilot runs with a hand on the yoke, the airplane's checklist to tick
/// through, and the nearest airports. The watch links no engine and
/// calls no server; everything it knows comes from the phone over
/// WatchConnectivity (WatchSession, Wingtip/Shared/WatchMessages.swift).
@main
struct WingtipWatchApp: App {
    @State private var session = WatchSession()

    var body: some Scene {
        WindowGroup {
            TabView {
                TimersView()
                    .tag("timers")
                ChecklistView()
                    .tag("checklist")
                NearestView()
                    .tag("nearest")
            }
            .tabViewStyle(.verticalPage)
            .environment(session)
            .task { session.start() }
        }
    }
}
