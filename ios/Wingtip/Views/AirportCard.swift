import SwiftUI

/// A field's card, as the web app's PlaceCard has it: its name, where it
/// is and its weather's colour; the runways' picture with the field from
/// the air and the ground a swipe across; the actions -- Fly Here, Add
/// Stop, Call, Address -- and four tabs under them: Info (the radio, the
/// lights, what is on the ground), Weather, Runways and Charts.
struct AirportCard: View {
    let ident: String
    @Environment(Plan.self) private var plan
    @State private var place: AirportPlace?
    @State private var problem: String?
    @State private var notFound = false
    @State private var photos: AirportPhotos?
    @State private var tab: CardTab = .info
    @State private var shown: ShownPicture?
    private var shelf: AirportShelf { .shared }

    /// The card's pages, in the pilot's order (the web app's CARD_TABS).
    enum CardTab: String, CaseIterable, Identifiable {
        case info = "Info", weather = "Weather", runways = "Runways", charts = "Charts"
        var id: String { rawValue }
    }

    var body: some View {
        List {
            if let place {
                Section {
                    // The UI tests' sign the card is up (WingtipUITests/FlowTests).
                    AirportHead(place: place).accessibilityIdentifier("airport-card-head")
                    AirportPictures(place: place, photos: photos, shown: $shown)
                        .listRowInsets(EdgeInsets())
                    actions(place)
                }
                Section {
                    Picker("Section", selection: $tab) {
                        ForEach(CardTab.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                switch tab {
                case .info: AirportInfoTab(place: place)
                case .weather: AirportWeatherTab(place: place)
                case .runways: AirportRunwaysTab(place: place)
                case .charts: AirportChartsTab(place: place, shown: $shown)
                }
            } else if let problem {
                ContentUnavailableView {
                    Label(notFound ? "No field \(ident)" : "No card for \(ident)", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(problem)
                } actions: {
                    // A field not found has nothing to ask again.
                    if !notFound { Button("Try Again") { Task { await load() } } }
                }
            } else {
                ProgressView("Fetching \(ident)…")
            }
        }
        .navigationTitle(ident)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let place {
                    ShareLink(item: URL(string: "https://\(Config.host)/app/plan?place=\(place.ident)")!,
                              subject: Text(place.name)) { Image(systemName: "square.and.arrow.up") }
                        .accessibilityLabel("Share")
                    let kept = shelf.isFavorite(place.ident)
                    Button { shelf.toggleFavorite(KeptAirport(place)) } label: {
                        Image(systemName: kept ? "star.fill" : "star")
                            .foregroundStyle(kept ? Color.yellow : Color.accentColor)
                    }
                    .accessibilityLabel(kept ? "Remove from Favorites" : "Add to Favorites")
                }
            }
        }
        .fullScreenCover(item: $shown) { PictureViewer(picture: $0) }
        .refreshable { await load() }
        .task(id: ident) {
            async let pictures = try? Planner.photos(ident)
            await load()
            photos = await pictures
            // The weather a report's freshness: asked again every five
            // minutes while the card is open, as the web app's is.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(300))
                guard !Task.isCancelled else { break }
                if let fresh = try? await Planner.place(ident) { place = fresh }
            }
        }
    }

    private func load() async {
        do {
            let fresh = try await Planner.place(ident)
            place = fresh
            problem = nil
            shelf.opened(KeptAirport(fresh))
        } catch let failure as Planner.Failure where failure.status == 404 {
            notFound = true
            problem = "The planner knows no field by that identifier."
        } catch {
            if place == nil { problem = error.localizedDescription }
        }
    }

    /// Fly Here is the Direct-To; Add Stop makes the field the route's
    /// next stop; Call and Address from the FAA's airport file, greyed
    /// where it lists none.
    private func actions(_ place: AirportPlace) -> some View {
        HStack(spacing: 8) {
            Button { plan.dest = place.ident; plan.plan() } label: { CardActionLabel(title: "Fly Here", systemImage: "location.north.line") }
                .buttonStyle(.borderedProminent)
            Button { plan.stops.append(place.ident); plan.plan() } label: { CardActionLabel(title: "Add Stop", systemImage: "mappin.and.ellipse") }
                .buttonStyle(.bordered)
                .disabled(!plan.routed || plan.idents.contains(place.ident))
            if let phone = place.phone, let call = URL(string: "tel:" + phone.filter { !$0.isWhitespace }) {
                Link(destination: call) { CardActionLabel(title: "Call", systemImage: "phone") }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Call \(phone)")
            } else {
                Button {} label: { CardActionLabel(title: "Call", systemImage: "phone") }
                    .buttonStyle(.bordered).disabled(true)
                    .accessibilityLabel("Call: no phone listed")
            }
            Link(destination: Self.mapsLink(place)) { CardActionLabel(title: "Address", systemImage: "map") }
                .buttonStyle(.bordered)
                .accessibilityLabel(place.address.map { "\($0), in Maps" } ?? "Where it is, in Maps")
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
        // Four actions across the phone, each a glyph over a word: the row
        // stops growing at the second accessibility size, where the words
        // would no longer fit side by side.
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }

    /// The field in Apple's Maps by its street address where the FAA
    /// lists one, so Maps names the road a driver is taken to, and by
    /// where it is otherwise; its name the pin's either way.
    static func mapsLink(_ place: AirportPlace) -> URL {
        var parts = URLComponents(string: "https://maps.apple.com/")!
        parts.queryItems = [URLQueryItem(name: "q", value: place.name)] + (place.address.map { [URLQueryItem(name: "address", value: $0)] }
            ?? [URLQueryItem(name: "ll", value: AirportWords.point(place.lat, place.lon))])
        return parts.url!
    }
}

/// The card's head: the name, where it is, a field to keep out of, its
/// elevation, and its weather's colour -- its own report's, or with none
/// the modelled one or a near station's, marked "≈".
struct AirportHead: View {
    let place: AirportPlace

    /// The category the chip shows, and whether it is the field's own.
    static func category(_ place: AirportPlace) -> (category: String, own: Bool)? {
        if let own = place.metar?.flightCategory { return (own, true) }
        if place.metar == nil, let modelled = place.modelledWeather?.flightCategory { return (modelled, false) }
        if place.metar == nil, let near = place.nearbyMetar, near.near, let category = near.metar.flightCategory { return (category, false) }
        return nil
    }

    /// A field the armed services own (the FAA's airport file), or a
    /// private one: a field most pilots may not land at unasked.
    static func restriction(_ place: AirportPlace) -> String? {
        switch place.military {
        case "military": return "Military, permission required"
        case "joint": return "Joint use"
        default: return place.isPrivate == true ? "Private, permission required" : nil
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(place.name).font(.title3.weight(.semibold))
                let region = place.region.map { $0.hasPrefix("US-") ? String($0.dropFirst(3)) : $0 }
                let whereIs = [place.municipality, region].compactMap { $0 }.joined(separator: ", ")
                if !whereIs.isEmpty { Text(whereIs).foregroundStyle(.secondary) }
                if let restriction = Self.restriction(place) { Text(restriction).font(.subheadline).foregroundStyle(.orange) }
                HStack(spacing: 12) {
                    if let elevation = place.elevationFt { Text("Elev \(AirportWords.feet(elevation))") }
                    Text(place.towered ? "Towered" : "Non-towered")
                    if let cls = place.airspaceClass { Text("Class \(cls)") }
                }
                .font(.subheadline).foregroundStyle(.secondary)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel([place.elevationFt.map { "elevation \(SpokenFigures.feet($0))" }, place.towered ? "towered" : "non-towered",
                                     place.airspaceClass.map { "Class \($0)" }].compactMap { $0 }.joined(separator: ", "))
            }
            Spacer(minLength: 0)
            if let chip = Self.category(place) {
                VStack(spacing: 0) {
                    if !chip.own { Text("≈") }
                    Text(chip.category)
                }
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6).padding(.vertical, 3)
                .background(Color(uiColor: AirportAnnotation.colour(chip.category)), in: RoundedRectangle(cornerRadius: 6))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(chip.own ? "Flight category \(chip.category)" : "About \(chip.category), not this field's own report")
            }
        }
    }
}

/// The runways' picture -- the FAA's diagram cropped to them where the
/// field has one, else a sketch from their surveyed ends -- with the field
/// from the air and from the ground a swipe across, each a tap from full
/// screen (the owner's "airport photos swipe behind the airport diagram
/// thumbnail", 2026-10-23).
struct AirportPictures: View {
    let place: AirportPlace
    let photos: AirportPhotos?
    @Binding var shown: ShownPicture?

    var body: some View {
        let sketched = !RunwaySketch.strips(place.runways).isEmpty
        TabView {
            if let cycle = place.airportDiagramCycle {
                Button {
                    shown = .paths("\(place.ident) airport diagram", [Planner.diagramPath(ident: place.ident, cycle: cycle)])
                } label: {
                    RemotePicture(path: Planner.diagramPath(ident: place.ident, cycle: cycle, runwaysOnly: true), fit: true)
                        .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.white)
                }
                .accessibilityLabel("\(place.ident) airport diagram, full screen")
            } else if sketched {
                Button { shown = AirportChartsTab.sketch(place) } label: {
                    RunwaySketch(runways: place.runways).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .accessibilityLabel("\(place.ident) runways sketch, full screen")
            }
            if let photos {
                Button { shown = .paths("\(place.ident) from the air", [photos.aerialUrl]) } label: {
                    RemotePicture(path: photos.aerialUrl).frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                }
                .accessibilityLabel("\(place.ident) from the air, full screen")
                if let photo = photos.photo {
                    let credit = photo.credit + ((photo.license ?? "").isEmpty ? "" : " · " + (photo.license ?? ""))
                    Button { shown = .paths("\(place.ident) from the ground", [photo.url], credit: credit) } label: {
                        RemotePicture(path: photo.url).frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                            .overlay(alignment: .bottomLeading) {
                                // Its photographer and licence, as Commons' licences ask.
                                Text(credit).font(.caption2).lineLimit(1)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(.thinMaterial, in: Capsule()).padding(6)
                            }
                    }
                    .accessibilityLabel("\(place.ident) from the ground, full screen")
                }
            }
        }
        .buttonStyle(.plain)
        .tabViewStyle(.page(indexDisplayMode: .always))
        .indexViewStyle(.page(backgroundDisplayMode: .always))
        .frame(height: 190)
    }
}

/// Info: the radio, with the airspace the field is in beside its title;
/// the lights the mic turns on; then what is on the ground.
struct AirportInfoTab: View {
    let place: AirportPlace

    var body: some View {
        Section(place.airspaceClass.map { "Frequencies (Class \($0))" } ?? "Frequencies") {
            if place.frequencies.isEmpty { Text("None listed").foregroundStyle(.secondary) }
            ForEach(Array(place.frequencies.enumerated()), id: \.offset) { _, f in FrequencyRowView(frequency: f) }
            // What some fields read out on so many clicks of the mic on
            // the CTAF: the weather, a radio check (wingtip.remarks).
            ForEach(place.radioNotes ?? [], id: \.self) { note in
                CardRow(badge: RowBadge(systemImage: "antenna.radiowaves.left.and.right", colour: Badge.traffic), title: note)
            }
        }
        if !(place.lighting ?? []).isEmpty || place.standardKeying == true {
            Section("Lights") {
                ForEach(place.lighting ?? [], id: \.self) { note in
                    CardRow(badge: RowBadge(systemImage: "lightbulb", colour: Badge.lights), title: note)
                }
                // Pilot-controlled lighting's standard keying (AIM 2-1-9):
                // seven clicks within five seconds for high intensity,
                // five for medium, three for low.
                if place.standardKeying == true {
                    LabeledContent("Keying", value: "7 high · 5 medium · 3 low")
                }
            }
        }
        StopServicesSections(ident: place.ident)
    }
}

/// Weather: the report first, its age first of all, each figure with its
/// glyph and the report as sent under them; for a field with no report,
/// the weather modelled at it and the nearest station's report.
struct AirportWeatherTab: View {
    let place: AirportPlace

    var body: some View {
        Section {
            if let metar = place.metar {
                if let observed = metar.observedAt.flatMap({ AirportWords.observed($0) }) {
                    LabeledContent("Observed", value: observed)
                }
                // The wind true, as reported.
                if metar.windSpeedKt != nil {
                    figure("wind", "Wind", AirportWords.windLine(dirTrueDeg: metar.windDirTrueDeg, speedKt: metar.windSpeedKt, gustKt: metar.windGustKt))
                }
                figure("eye", "Visibility", metar.visibilitySm.map { "\(AirportWords.plain($0)) sm" } ?? "—", spoken: metar.visibilitySm.map(SpokenFigures.statuteMiles))
                figure("cloud", "Ceiling", metar.ceilingFt.map(AirportWords.feet) ?? "None", spoken: metar.ceilingFt.map(SpokenFigures.feet))
                if let temp = metar.tempC {
                    CardRow(badge: RowBadge(systemImage: "thermometer.medium", colour: Badge.weather), title: "Temperature",
                            detail: metar.dewpointC.map { "Dew point \(Int($0.rounded())) °C" }) {
                        Text("\(Int(temp.rounded())) °C").fontWeight(.semibold)
                            .accessibilityLabel("\(SpokenFigures.number(temp)) degrees Celsius")
                    }
                }
                if let altimeter = metar.altimeterInHg {
                    // Read as set on the altimeter: "two niner niner two".
                    figure("gauge.with.dots.needle.33percent", "Altimeter", "\(Formats.number(altimeter, decimals: 2)) inHg",
                           spoken: "\(SpokenFigures.digits(Formats.number(altimeter, decimals: 2))) inches")
                }
                // The report as sent, never reworded.
                if let raw = metar.raw { Text(raw).font(.footnote.monospaced()).textSelection(.enabled) }
            } else {
                Text(place.weatherUnavailable == true ? "The weather service could not be reached" : "No weather station reports from this field")
                    .foregroundStyle(.secondary)
            }
        }
        // The National Weather Service's Gridded LAMP at the field for the
        // hour (wingtip.glmp): planning guidance from a model, not a report.
        if place.metar == nil, let modelled = place.modelledWeather {
            Section("Modelled for \(AirportWords.date(modelled.validAt).map(AirportWords.zulu) ?? modelled.validAt)") {
                figure("cloud.sun", "Flight category", modelled.flightCategory, spoken: SpokenFigures.flightCategory(modelled.flightCategory))
                // GLMP's most is 10 sm, as a METAR's "10SM" is.
                figure("eye", "Visibility", modelled.visibilitySm >= 10 ? "10+ sm" : "\(AirportWords.plain(modelled.visibilitySm)) sm",
                       spoken: modelled.visibilitySm >= 10 ? "ten statute miles or more" : SpokenFigures.statuteMiles(modelled.visibilitySm))
                figure("cloud", "Ceiling", modelled.ceilingFt.map(AirportWords.feet) ?? "None", spoken: modelled.ceilingFt.map(SpokenFigures.feet))
            }
        }
        AtisSection()
        if place.metar == nil, let nearby = place.nearbyMetar {
            Section("Nearest report, \(AirportWords.plain(nearby.distanceNm)) nm \(AirportWords.compassPoint(Double(nearby.bearingDeg)))") {
                CardRow(title: nearby.ident, detail: nearby.metar.observedAt.flatMap { AirportWords.observed($0) }) {
                    if let category = nearby.metar.flightCategory {
                        Text(category).fontWeight(.semibold).accessibilityLabel(SpokenFigures.flightCategory(category))
                    }
                }
                if let raw = nearby.metar.raw { Text(raw).font(.footnote.monospaced()).textSelection(.enabled) }
            }
        }
    }

    /// Listen to ATIS: one broadcast heard through the microphone
    /// (ClearanceListener.hearBroadcast, the radio's recognizer), read by the
    /// engine (Atis), and what matters at the hold-short line in one
    /// line -- the runway in use and the altimeter -- with the figures
    /// in a short table under it and the transcript folded away. A
    /// failure is said in the row (ProblemLine), not an alert.
    struct AtisSection: View {
        @State private var listening = false
        @State private var heard = ""
        @State private var reading: Atis?
        @State private var problem: String?
        @State private var hearing: Task<Void, Never>?

        var body: some View {
            Section {
                Button {
                    if listening {
                        ClearanceListener.shared.stop()
                        return
                    }
                    listening = true
                    problem = nil
                    reading = nil
                    heard = ""
                    hearing = Task { @MainActor in
                        let text = await ClearanceListener.shared.hearBroadcast { heard = $0 }
                        listening = false
                        guard let text else {
                            problem = ClearanceListener.shared.problem ?? "Nothing could be heard."
                            return
                        }
                        guard !text.isEmpty else {
                            problem = "Nothing was heard. Tune the ATIS, hold the phone to the speaker and tap again."
                            return
                        }
                        guard let read = Atis.read(text) else {
                            problem = "The broadcast could not be read."
                            return
                        }
                        reading = read
                        if !read.heardAny { problem = "Nothing of a broadcast was heard in that." }
                    }
                } label: {
                    CardRow(badge: RowBadge(systemImage: "dot.radiowaves.left.and.right", colour: Badge.weather),
                            title: listening ? "Listening…" : "Listen to ATIS",
                            detail: listening ? (heard.isEmpty ? "Tune the ATIS or AWOS and hold the phone to the speaker" : heard) : nil) {
                        if listening { ProgressView() }
                    }
                }
                .accessibilityLabel(listening ? "Stop listening" : "Listen to ATIS")
                ProblemLine(problem)
                if let reading, reading.heardAny {
                    CardRow(title: reading.glance) {
                        if let letter = reading.information { Text("Information \(letter)") }
                    }
                    ForEach(Array(reading.rows.enumerated()), id: \.offset) { _, row in
                        LabeledContent(row.label, value: row.value)
                    }
                }
                if let reading {
                    DisclosureGroup("Transcript") {
                        Text(reading.raw).font(.footnote.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
            }
            .onDisappear { hearing?.cancel(); if listening { ClearanceListener.shared.stop() } }
        }
    }

    /// One figure of the report; `spoken` is the figure as VoiceOver says
    /// it (SpokenFigures), where "29.92 inHg" would be read as letters.
    private func figure(_ symbol: String, _ title: String, _ value: String, spoken: String? = nil) -> some View {
        CardRow(badge: RowBadge(systemImage: symbol, colour: Badge.weather), title: title) {
            Text(value).fontWeight(.semibold).accessibilityLabel(spoken ?? value)
        }
    }
}

/// Runways: the pattern altitude, then each runway with the wind on it.
struct AirportRunwaysTab: View {
    let place: AirportPlace

    var body: some View {
        Section {
            // The FAA's published pattern altitude, else 1,000 ft over the
            // field (AC 90-66C, 8.4), as the planner gives it.
            if let pattern = place.pattern, let altitude = pattern.altitudeFt {
                CardRow(badge: RowBadge(systemImage: "arrow.triangle.2.circlepath", colour: Badge.runway), title: "Pattern altitude",
                        detail: pattern.published == true ? "As the FAA publishes it" : "1,000 ft above the field: none published") {
                    Text(AirportWords.feet(altitude)).fontWeight(.semibold).accessibilityLabel(SpokenFigures.feet(altitude))
                }
            }
            if place.runways.isEmpty { Text("No runways listed").foregroundStyle(.secondary) }
            ForEach(Array(place.runways.enumerated()), id: \.offset) { _, runway in RunwayRowView(runway: runway) }
        }
    }
}

/// Charts: the airport diagram and the Chart Supplement, then the field's
/// approaches, departures, arrivals and minimums in this cycle's d-TPP,
/// each shown in the app full screen to pinch in on. A procedure's title
/// as the FAA prints it, as pilots know it from the plate.
struct AirportChartsTab: View {
    let place: AirportPlace
    @Binding var shown: ShownPicture?

    /// The groups by the FAA's chart codes (wingtip.publications); the
    /// airport's own -- hot spots, land and hold short -- go with its
    /// diagram.
    static let groups: [(title: String, kinds: [String])] = [
        ("Approaches", ["IAP"]), ("Departures", ["DP", "ODP"]), ("Arrivals", ["STR"]), ("Minimums", ["MIN"]),
    ]
    static let airportCharts = ["HOT", "LAH"]

    struct ChartGroup: Identifiable {
        let title: String
        let charts: [TerminalChart]
        var id: String { title }
    }

    /// The rest of the charts, in groups, with "Other" for any code the
    /// groups leave out.
    static func grouped(_ charts: [TerminalChart]) -> [ChartGroup] {
        let known = Set(["APD"] + airportCharts + groups.flatMap { $0.kinds })
        let other = (title: "Other", kinds: Array(Set(charts.map { $0.kind }).subtracting(known)).sorted())
        return (groups + [other]).compactMap { group in
            let mine = charts.filter { group.kinds.contains($0.kind) }
            return mine.isEmpty ? nil : ChartGroup(title: group.title, charts: mine)
        }
    }

    /// The sketch full screen, for a field the FAA draws no diagram for.
    @MainActor
    static func sketch(_ place: AirportPlace) -> ShownPicture {
        let renderer = ImageRenderer(content: RunwaySketch(runways: place.runways)
            .frame(width: 900, height: 900).background(Color.white).environment(\.colorScheme, .light))
        renderer.scale = 2
        let image = renderer.uiImage
        return ShownPicture(title: "\(place.ident) runways") { image.map { [$0] } ?? [] }
    }

    var body: some View {
        let charts = place.procedures ?? []
        let sketched = !RunwaySketch.strips(place.runways).isEmpty
        Section("Airport") {
            if let cycle = place.airportDiagramCycle {
                row("Airport diagram", "map") {
                    shown = .paths("\(place.ident) airport diagram", [Planner.diagramPath(ident: place.ident, cycle: cycle)])
                }
            } else if let url = place.airportDiagramUrl {
                row("Airport diagram", "map") { shown = .faaChart("\(place.ident) airport diagram", url: url, airport: place.ident) }
            } else if sketched {
                row("Airport diagram", "map", detail: "A sketch of the runways: the FAA publishes none") { shown = Self.sketch(place) }
            } else {
                Text("The FAA publishes no airport diagram for this field").foregroundStyle(.secondary)
            }
            if let supplement = place.chartSupplementUrl {
                row("Chart Supplement", "book") { shown = .faaChart("\(place.ident) Chart Supplement", url: supplement, airport: place.ident) }
            }
            ForEach(charts.filter { Self.airportCharts.contains($0.kind) }) { chart in chartRow(chart) }
        }
        ForEach(Self.grouped(charts)) { group in
            Section(group.title) {
                ForEach(group.charts) { chart in chartRow(chart) }
            }
        }
    }

    private func chartRow(_ chart: TerminalChart) -> some View {
        let symbol = chart.kind == "IAP" ? "airplane.arrival" : chart.kind == "DP" || chart.kind == "ODP" ? "airplane.departure"
            : chart.kind == "STR" ? "point.topleft.down.to.point.bottomright.curvepath" : "doc.richtext"
        return row(chart.name, symbol, colour: chart.kind == "IAP" || chart.kind == "DP" || chart.kind == "ODP" || chart.kind == "STR" ? Badge.approach : Badge.chart) {
            shown = .faaChart(chart.name, url: chart.url, airport: place.ident)
        }
    }

    private func row(_ title: String, _ symbol: String, detail: String? = nil, colour: Color = Badge.chart, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            HStack {
                CardRow(badge: RowBadge(systemImage: symbol, colour: colour), title: title, detail: detail)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(.primary)
    }
}

/// A field with its weather, runways surveyed at both ends (so the
/// sketch draws with no network), an FAA diagram by its address and a
/// few plates.
private enum PreviewData {
    static let place = AirportPlace(
        address: "4701 Grinden Dr, Duluth, MN 55811",
        airportDiagramUrl: "https://aeronav.faa.gov/d-tpp/2511/00126AD.PDF",
        airspaceClass: "D",
        chartSupplementUrl: "https://aeronav.faa.gov/afd/03nov2026/nc_181_03NOV2026.pdf",
        elevationFt: 1428,
        frequencies: [
            Frequency(description: "ATIS", frequencyMhz: 124.1, type: "ATIS"),
            Frequency(description: "DULUTH TOWER", frequencyMhz: 118.3, type: "TWR"),
            Frequency(description: "GROUND", frequencyMhz: 121.9, type: "GND"),
            Frequency(description: "DULUTH APPROACH", frequencyMhz: 125.45, type: "APP"),
        ],
        ident: "KDLH",
        kind: "large_airport",
        lat: 46.8420,
        lighting: ["Runway lights on from dusk to dawn"],
        lon: -92.1936,
        metar: Metar(altimeterInHg: 30.12, dewpointC: -3, flightCategory: "VFR", observedAt: "2026-11-03T14:53:00Z",
                     raw: "KDLH 031453Z 27009KT 10SM FEW040 BKN250 04/M03 A3012", tempC: 4, visibilitySm: 10, windDirTrueDeg: 270,
                     windSpeedKt: 9),
        municipality: "Duluth",
        name: "Duluth Intl",
        pattern: TrafficPattern(aglFt: 1000, altitudeFt: 2428, published: false),
        phone: "218 555 0100",
        procedures: [
            TerminalChart(kind: "IAP", name: "ILS OR LOC RWY 09", url: "https://aeronav.faa.gov/d-tpp/2511/00126IL9.PDF"),
            TerminalChart(kind: "IAP", name: "RNAV (GPS) RWY 27", url: "https://aeronav.faa.gov/d-tpp/2511/00126R27.PDF"),
            TerminalChart(kind: "DP", name: "DULUTH ONE", url: "https://aeronav.faa.gov/d-tpp/2511/00126DULUTH.PDF"),
            TerminalChart(kind: "MIN", name: "TAKEOFF MINIMUMS", url: "https://aeronav.faa.gov/d-tpp/2511/NC1TO.PDF"),
        ],
        radioNotes: ["A radio check on the CTAF: key the mic three times"],
        region: "US-MN",
        runways: [
            Runway(closed: false, ends: "09/27", lengthFt: 10162, lighted: true, runwayEnds: [RunwayEnd(headingTrueDeg: 92, ident: "09", lat: 46.8415, lon: -92.2140),
                                RunwayEnd(headingTrueDeg: 272, ident: "27", lat: 46.8425, lon: -92.1733, traffic: "right")],
                   surface: "ASPH", widthFt: 150, wind: RunwayWind(crosswindKt: 4, end: "27", headwindKt: 9)),
            Runway(closed: false, ends: "03/21", lengthFt: 5719, lighted: true, runwayEnds: [RunwayEnd(headingTrueDeg: 33, ident: "03", lat: 46.8355, lon: -92.2005),
                                RunwayEnd(headingTrueDeg: 213, ident: "21", lat: 46.8490, lon: -92.1880)],
                   surface: "ASPH", widthFt: 150),
        ],
        standardKeying: true,
        towered: true)
}

#Preview("AirportHead") {
    List { AirportHead(place: PreviewData.place) }
}

#Preview("AirportPictures") {
    @Previewable @State var shown: ShownPicture? = nil
    List { AirportPictures(place: PreviewData.place, photos: nil, shown: $shown).listRowInsets(EdgeInsets()) }
}

#Preview("AirportInfoTab") {
    List { AirportInfoTab(place: PreviewData.place) }
}

#Preview("AirportWeatherTab") {
    List { AirportWeatherTab(place: PreviewData.place) }
}

#Preview("AirportRunwaysTab") {
    List { AirportRunwaysTab(place: PreviewData.place) }
}

#Preview("AirportChartsTab") {
    @Previewable @State var shown: ShownPicture? = nil
    List { AirportChartsTab(place: PreviewData.place, shown: $shown) }
}
