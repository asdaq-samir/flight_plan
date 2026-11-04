import SwiftUI

/// Setup: the pilot's account, and the chart's edition and what of it is
/// kept for the air.
struct SetupView: View {
    @Environment(Session.self) private var session
    @Environment(Charts.self) private var charts
    @Environment(Traffic.self) private var traffic
    @Environment(Plan.self) private var plan
    @State private var signingIn = false
    @State private var keptBytes: Int64 = 0
    @AppStorage(MapExtrasInput.Keys.waypoints) private var waypointsOn = false
    @AppStorage(MapExtrasInput.Keys.classB) private var classBOn = false
    @AppStorage(MapExtrasInput.Keys.plates) private var platesOn = true
    @AppStorage(MapExtrasInput.Keys.military) private var militaryOn = false
    @AppStorage(MapExtrasInput.Keys.privateFields) private var privateOn = false
    @AppStorage(ChartNight.key) private var chartNight = ChartNight.dimmed.rawValue
    /// The screen's layout, the tabs or the strip (RootView).
    @AppStorage("layout") private var layoutName = "tabs"

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    if let pilot = session.pilot {
                        LabeledContent("Signed in as", value: pilot.displayName ?? pilot.email ?? "you")
                        if let email = pilot.email, pilot.displayName != nil { LabeledContent("Email", value: email) }
                        NavigationLink("Contact") { ContactView() }
                        Button("Sign Out", role: .destructive) { Task { await session.signOut(); plan.forgetPilot() } }
                        DeleteAccountButton()
                    } else {
                        Button("Sign In") { signingIn = true }
                            .disabled(!session.loaded)
                    }
                    ProblemLine(session.problem)
                }
                if session.signedIn {
                    Section("Pilot") {
                        NavigationLink("Logbook and currency") { LogbookView() }
                        NavigationLink("Training") { TrainingView() }
                        NavigationLink("Instructing") { InstructorView() }
                    }
                }
                // The weather the pilot will not take off or land in, kept
                // on this phone: the Brief's Go / No-Go holds it to them.
                Section {
                    NavigationLink("Personal minimums") { MinimumsView() }
                    NavigationLink("Guide") { PilotGuideView() }
                }
                Section("Map") {
                    Toggle("Traffic", isOn: Binding(get: { traffic.on }, set: { traffic.on = $0 }))
                    SpokenAlertsToggle()
                    ForgetNotesButton()
                    Toggle("VFR waypoints", isOn: $waypointsOn)
                    Toggle("Class B weather", isOn: $classBOn)
                    Toggle("Approach plates", isOn: $platesOn)
                    Toggle("Military fields", isOn: $militaryOn)
                    Toggle("Private fields", isOn: $privateOn)
                    // How old each weather layer's data is.
                    LayerAgesRows()
                }
                // The tabs, or the strip: one field and the flight as one
                // strip (StripSheetView), the owner's pick of 2026-11-04,
                // tried beside the tabs; a segmented control, as a setting
                // of two is.
                Section("Screen") {
                    Picker("Screen", selection: $layoutName) {
                        Text("Tabs").tag("tabs")
                        Text("Strip").tag("strip")
                    }
                    .pickerStyle(.segmented)
                }
                Section("Chart") {
                    // The white paper chart dimmed in dark appearance, so it
                    // does not take the pilot's night vision: a menu of two,
                    // as the web app's Settings has it.
                    Picker("Chart at night", selection: $chartNight) {
                        ForEach(ChartNight.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    if let info = charts.info {
                        LabeledContent("Edition", value: info.chartCycle)
                        if let base = charts.base { LabeledContent("Layer", value: base.label) }
                        LabeledContent("Kept for the air", value: ByteCountFormatter.string(fromByteCount: keptBytes, countStyle: .file))
                    } else {
                        LabeledContent("Edition", value: "Fetching…")
                    }
                    ProblemLine(charts.problem)
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

#Preview("SetupView") {
    SetupView()
        .environment(Session())
        .environment(Charts())
        .environment(Traffic())
        .environment(Plan())
}
