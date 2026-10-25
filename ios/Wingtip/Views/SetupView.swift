import SwiftUI

/// Setup: the pilot's account, and the chart's edition and what of it is
/// kept for the air.
struct SetupView: View {
    @Environment(Session.self) private var session
    @Environment(Charts.self) private var charts
    @Environment(Traffic.self) private var traffic
    @State private var signingIn = false
    @State private var keptBytes: Int64 = 0

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    if let pilot = session.pilot {
                        LabeledContent("Signed in as", value: pilot.displayName ?? pilot.email ?? "you")
                        if let email = pilot.email, pilot.displayName != nil { LabeledContent("Email", value: email) }
                        Button("Sign Out", role: .destructive) { Task { await session.signOut() } }
                    } else {
                        Button("Sign In") { signingIn = true }
                            .disabled(!session.loaded)
                    }
                    if let problem = session.problem {
                        Text(problem).foregroundStyle(.red).font(.footnote)
                    }
                }
                if session.signedIn {
                    Section("Pilot") {
                        NavigationLink("Logbook and currency") { LogbookView() }
                        NavigationLink("Training") { TrainingView() }
                    }
                }
                Section("Map") {
                    Toggle("Traffic", isOn: Binding(get: { traffic.on }, set: { traffic.on = $0 }))
                }
                Section("Chart") {
                    if let info = charts.info {
                        LabeledContent("Edition", value: info.chartCycle)
                        if let base = charts.base { LabeledContent("Layer", value: base.label) }
                        LabeledContent("Kept for the air", value: ByteCountFormatter.string(fromByteCount: keptBytes, countStyle: .file))
                    } else {
                        LabeledContent("Edition", value: "Fetching…")
                    }
                    if let problem = charts.problem {
                        Text(problem).foregroundStyle(.red).font(.footnote)
                    }
                }
                Section {
                    LabeledContent("Server", value: Config.host)
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                }
            }
            .navigationTitle("Setup")
            .sheet(isPresented: $signingIn) { SignInView() }
            .task { keptBytes = TileStore.shared.bytes() }
            .refreshable {
                await charts.load()
                await session.refresh()
                keptBytes = TileStore.shared.bytes()
            }
        }
    }
}
