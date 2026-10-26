import SwiftUI

/// How the root lays itself out: on an iPhone (a Max held sideways too,
/// though it is then of the regular width) and on an iPad in a narrow
/// Split View, the map under the system sheet with its detents, the
/// owner's Apple Maps model; on an iPad of the regular width, as Maps lays
/// out on the iPad, the map across the screen with the tabs in the
/// sidebar at its left, a field's card, the profile and the brief in the
/// inspector at its right, and the figures along its foot.
enum RootLayout: Equatable {
    case sheet
    case split

    static func of(_ sizeClass: UserInterfaceSizeClass?, pad: Bool) -> RootLayout {
        pad && sizeClass == .regular ? .split : .sheet
    }

    /// Which of the Airport tab's pages open in the inspector on iPad: a
    /// field's card and the airspace over a point, as Maps opens a place
    /// beside the map. Its lists stay in the sidebar, where they were
    /// opened.
    static func inspects(_ route: AirportRoute) -> Bool {
        switch route {
        case .airport, .airspace: true
        case .list, .nearFrom: false
        }
    }
}

/// The Airport tab's search, typed: kept in one place, as the iPad's
/// sidebar folds the system's search field away (neither the tab's nor
/// the column's .searchable shows there) and the tab draws its own.
@MainActor
@Observable
final class AirportQuery {
    static let shared = AirportQuery()
    static let prompt = "Identifier, name or town"
    var text = ""
}

/// A second-level card, which the iPad shows in the inspector beside the
/// map rather than over the tab: a field's or a point's (as AirportRoute
/// writes it), the profile, the brief, or the flight's own cards
/// (FlightUI's: an airplane, a hold, a flown track and its replay).
enum SideCard: Hashable {
    case airport(String)
    case profile
    case brief
    case flight
    /// The pilot's saved flights (FPL's Flights button).
    case flights
}

extension EnvironmentValues {
    /// Set in the iPad's layout: the flight's cards go to the inspector.
    @Entry var splitLayout = false
    /// Opens a card in the inspector; nil on the iPhone, where it is
    /// pushed in the tab.
    @Entry var openCard: ((SideCard) -> Void)? = nil
    /// Closes the inspector's card; nil on the iPhone.
    @Entry var closeCard: (() -> Void)? = nil
}

/// A link to a second-level card: pushed in its tab on the iPhone, opened
/// in the inspector on the iPad.
struct CardLink<Label: View>: View {
    let card: SideCard
    let label: () -> Label
    @Environment(\.openCard) private var openCard

    init(_ card: SideCard, @ViewBuilder label: @escaping () -> Label) {
        self.card = card
        self.label = label
    }

    var body: some View {
        if let openCard {
            Button { openCard(card) } label: { label() }
        } else {
            NavigationLink(value: Self.page(card)) { label() }
        }
    }

    /// The tab's own page for it, as FPL's stack names them.
    static func page(_ card: SideCard) -> String {
        switch card {
        case .airport(let text): text
        case .profile: "profile"
        case .brief: "brief"
        case .flight: "flight"
        case .flights: "flights"
        }
    }
}

/// The iPad's layout: stock SwiftUI throughout. The tabs in the
/// NavigationSplitView's sidebar (on iPadOS 26 a floating glass card over
/// the map, with the tab bar at its top), the map as its detail across
/// the screen, the second-level card in the system inspector, and the
/// flight's figures along the foot of the map.
struct SplitLayout<Map: View>: View {
    let map: Map
    @Binding var tab: RootView.Tabs
    /// The Airport tab's stack: a field or a point picked there goes to
    /// the inspector instead (RootLayout.inspects).
    @Binding var airports: [String]
    @Binding var card: SideCard?
    @Environment(Plan.self) private var plan
    @State private var columns: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            // A tab's own navigation bar is folded into the column's in
            // the sidebar, which showed none of its title or buttons: the
            // column's bar carries them instead.
            SheetView(tab: $tab, airports: sidebarAirports, pill: false)
                .navigationTitle(Self.title(tab))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { if tab == .fpl { fplItems } }
                .navigationSplitViewColumnWidth(min: 320, ideal: 375, max: 420)
        } detail: {
            map
                .overlay(alignment: .bottom) {
                    FiguresStrip()
                        .padding(.vertical, 10)
                        .frame(maxWidth: 520)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .padding(.bottom, 16)
                        .padding(.horizontal, 16)
                }
                .toolbar(.hidden, for: .navigationBar)
                .inspector(isPresented: inspectorShown) {
                    inspector
                        .inspectorColumnWidth(min: 320, ideal: 375, max: 440)
                }
        }
        .navigationSplitViewStyle(.balanced)
        .environment(\.splitLayout, true)
        .environment(\.openCard, { card = $0 })
        .environment(\.closeCard, { close() })
        // A flight's card (an airplane tapped, a hold, a flown track) opens
        // here; put away from inside, the inspector closes with it.
        .onChange(of: FlightUI.shared.card) { _, next in
            if next != nil {
                card = .flight
            } else if card == .flight {
                card = nil
                Tracking.shared.track(nil)
            }
        }
    }

    /// Airport's stack, as the sidebar sees it: a field or a point pushed
    /// there opens in the inspector instead.
    private var sidebarAirports: Binding<[String]> {
        Binding(
            get: { airports },
            set: { next in
                if next.count > airports.count, let last = next.last, RootLayout.inspects(AirportRoute(last)) {
                    card = .airport(last)
                } else {
                    airports = next
                }
            }
        )
    }

    private var inspectorShown: Binding<Bool> {
        Binding(get: { card != nil }, set: { shown in if !shown { close() } })
    }

    private func close() {
        if card == .flight {
            FlightUI.shared.card = nil
            Tracking.shared.track(nil)
        }
        card = nil
    }

    @ViewBuilder private var inspector: some View {
        switch card {
        case .airport(let text):
            NavigationStack {
                AirportDestination(route: AirportRoute(text), nearest: []).toolbar { closeItem }
            }
            .id(text)
        case .profile:
            NavigationStack { ProfileCard().toolbar { closeItem } }
        case .brief:
            NavigationStack { BriefView().toolbar { closeItem } }
        case .flights:
            NavigationStack { FlightsView().toolbar { closeItem } }
        case .flight:
            // Each has its own stack and close (FlightSheets' cards).
            switch FlightUI.shared.card {
            case .airplane(let hex): AirplaneCard(hex: hex).id(hex)
            case .hold(let fix): HoldSheet(fix: fix).id(fix)
            case .flown(let id, let title): FlownTrackView(flight: id, title: title).id(id)
            case nil: EmptyView()
            }
        case nil:
            EmptyView()
        }
    }

    /// Each tab's title, as its own stack has it.
    static func title(_ tab: RootView.Tabs) -> String {
        switch tab {
        case .fpl: "Flight plan"
        case .airport: "Airport"
        case .aircraft: "Aircraft"
        case .setup: "Setup"
        }
    }

    /// FPL's own bar, in the column's: the saved flights (in the
    /// inspector), and with a route, the stops' Edit, Share and Clear.
    @ToolbarContentBuilder private var fplItems: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button { card = .flights } label: { Label("Flights", systemImage: "tray.full") }
        }
        if !plan.stops.isEmpty {
            ToolbarItem(placement: .topBarLeading) { EditButton() }
        }
        if plan.routed {
            ToolbarItem(placement: .topBarTrailing) { ShareMenu() }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Clear", role: .destructive) { plan.clear() }
            }
        }
    }

    private var closeItem: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { close() } label: { Image(systemName: "xmark") }.accessibilityLabel("Close")
        }
    }
}
