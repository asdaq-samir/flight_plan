import Charts
import CoreLocation
import SwiftUI

/// How the airplane cards write things, as the web app's pastFlightFormat
/// and FlightCard do.
enum FlightWords {
    /// A name in the FAA's or a registry's capitals as a name is written:
    /// "CESSNA 172S" as "Cessna 172S", its codes (a letter, a figure) kept.
    static func nameCase(_ text: String) -> String {
        text.split(separator: " ", omittingEmptySubsequences: false).map { word -> String in
            guard word.count >= 2, word.allSatisfy({ $0.isLetter && $0.isUppercase }) else { return String(word) }
            return String(word.prefix(1)) + word.dropFirst().lowercased()
        }.joined(separator: " ")
    }

    /// "2 h 13 min", "41 min".
    static func lasted(_ seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        return minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"
    }

    /// A field's town as FlightAware writes it under the ident: "Skyhaven,
    /// NH" in the US, the town alone abroad, its name where its town is
    /// not known.
    static func place(_ field: PastFlightField?) -> String? {
        guard let field else { return nil }
        let state = field.region.flatMap { $0.hasPrefix("US-") ? String($0.dropFirst(3)) : nil }
        if let city = field.city { return state.map { "\(city), \($0)" } ?? city }
        return field.name
    }

    /// "15:10 today", "09:42 yesterday", "18:05 Sat 11 Oct", in this
    /// device's clock.
    static func when(_ seconds: Double, now: Date = Date()) -> String {
        let at = Date(timeIntervalSince1970: seconds)
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: at), to: calendar.startOfDay(for: now)).day ?? 0
        let time = at.formatted(date: .omitted, time: .shortened)
        switch days {
        case 0: return "\(time) today"
        case 1: return "\(time) yesterday"
        default: return "\(time) \(at.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))"
        }
    }

    /// How a flight ended and how long it flew: "Landed · 52 min".
    static func ended(_ flight: PastFlightSummary) -> String {
        "\(flight.inAir ? "In the air" : flight.local ? "Local flight" : flight.landed ? "Landed" : "Last heard") · \(lasted(flight.on - flight.off))"
    }

    /// A transponder code said in words, where it says more than a code:
    /// 7500 unlawful interference (AIM 6-3-4), 7600 two-way radio failure
    /// (AIM 6-4-2), 7700 an emergency (AIM 6-2-2) -- the engine's
    /// `squawk_meaning`, the web's and Android's.
    static func squawk(_ code: String?) -> String? {
        do { return try Engine.call("squawk_meaning", json: ["squawk": code]) as String? } catch { return nil }
    }

    /// Feet against own ship's: "500 ft above", "1,200 ft below", "level".
    static func against(_ feet: Double) -> String {
        let rounded = Int((feet / 100).rounded()) * 100
        if rounded == 0 { return "level" }
        return "\(abs(rounded).formatted()) ft \(rounded > 0 ? "above" : "below")"
    }
}

/// An airplane being tracked, as FlightAware's flight page and the web
/// app's FlightCard show one: what it is and who flies it; the star,
/// Follow, Share and the watches; its flight now and the ones before it,
/// each opened with its path on the map and its profile; then what it is
/// and the FAA's record. Seconds-old internet data from adsb.lol's
/// receivers: for knowing what is about, not for avoiding it.
struct AirplaneCard: View {
    let hex: String
    @State private var detail: FlightDetail?
    @State private var route: FlightRoute?
    @State private var flights: [PastFlightSummary] = []
    @State private var history: PastFlights?
    @State private var based: PastFlightField?
    @State private var fetchingMore = false
    @State private var problem: String?
    private var tracking: Tracking { Tracking.shared }

    private var plane: TrafficAircraft? { tracking.hex == hex.lowercased() ? tracking.latest : nil }
    private var name: String {
        if let callsign = plane?.callsign { return callsign }
        if let registration = detail?.registration ?? plane?.registration { return registration }
        if let tail = detail?.faa?.nNumber { return tail }
        return tracking.recents.first(where: { $0.hex == hex })?.name ?? hex.uppercased()
    }
    private var kept: KeptAirplane? {
        let registration = detail?.registration ?? plane?.registration
        guard let name = registration ?? detail?.faa?.nNumber ?? plane?.callsign else { return nil }
        return KeptAirplane(hex: hex.lowercased(), name: name, type: detail?.type ?? plane?.type)
    }
    private var link: URL { Config.gateway.appending(path: "/app/plan").appending(queryItems: [URLQueryItem(name: "flight", value: hex)]) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(detail?.description.map(FlightWords.nameCase) ?? detail?.type ?? plane?.type ?? name).font(.title3.weight(.semibold))
                        if let op = detail?.operator { Text(FlightWords.nameCase(op)).foregroundStyle(.secondary) }
                    }
                    HStack(spacing: 10) {
                        Button {
                            if let kept { tracking.toggleFavorite(kept) }
                        } label: {
                            Label(tracking.isFavorite(hex) ? "Favorite" : "Add to Favorites", systemImage: tracking.isFavorite(hex) ? "star.fill" : "star")
                        }
                        .disabled(kept == nil)
                        // Nothing to follow where it is not heard now.
                        Button {
                            tracking.follow.toggle()
                        } label: {
                            Label(tracking.follow && plane != nil ? "Following" : "Follow", systemImage: "scope")
                        }
                        .disabled(plane == nil)
                        Menu {
                            Toggle("Tell me when it takes off", isOn: watchBinding(.takeoff))
                            Toggle("Tell me when it lands", isOn: watchBinding(.land))
                        } label: {
                            Label("Alert", systemImage: tracking.watching(hex, .takeoff) || tracking.watching(hex, .land) ? "bell.fill" : "bell")
                        }
                        ShareLink(item: link, subject: Text(name)) { Label("Share", systemImage: "square.and.arrow.up") }
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.bordered)
                    .font(.body)
                }
                if let plane {
                    Section("Now") { NowFlightRow(plane: plane, detail: detail, route: route?.plausible == false ? nil : route) }
                }
                Section(plane != nil ? "Earlier" : "Last flights") {
                    if history == nil, problem == nil {
                        Text("Fetching its flights…").foregroundStyle(.secondary)
                    }
                    ForEach(flights.filter { !(plane != nil && $0.inAir) }) { flight in
                        NavigationLink(value: flight) { PastFlightRow(flight: flight, type: detail?.type ?? plane?.type ?? history?.type) }
                    }
                    if history != nil, flights.isEmpty {
                        Text("No flights heard in the last six weeks").foregroundStyle(.secondary)
                    }
                    if let unread = history?.unreadDays, unread > 0 {
                        Text(unread >= 7 ? "adsb.lol's flight history can't be read now, so only flights followed in this app are listed."
                             : "\(unread == 1 ? "One day" : "\(unread) days") could not be read from adsb.lol just now, so their flights are missing.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if history?.nextUntil != nil {
                        Button(fetchingMore ? "Fetching earlier flights…" : "Show earlier flights") { Task { await more() } }
                            .disabled(fetchingMore)
                    }
                    ProblemLine(problem)
                }
                Section("Airplane") {
                    if let model = detail?.description { LabeledContent("Model", value: FlightWords.nameCase(model)) }
                    if let op = detail?.operator { LabeledContent("Operator", value: FlightWords.nameCase(op)) }
                    LabeledContent("Registration", value: detail?.registration ?? plane?.registration ?? "—")
                    LabeledContent("Type", value: [detail?.type ?? plane?.type, detail?.year].compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "—")
                    LabeledContent("ICAO address", value: hex.uppercased())
                    LabeledContent("Callsign", value: plane?.callsign ?? "—")
                    if let based { LabeledContent("Based at", value: [based.ident, FlightWords.place(based)].compactMap { $0 }.joined(separator: " · ")) }
                }
                if let route {
                    // Its flight number's scheduled route, not the flight
                    // plan filed, which the FAA does not publish openly.
                    Section("Scheduled route") {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(route.airports.map(\.ident).joined(separator: " → ")).font(.headline)
                            Text([route.airports.compactMap { $0.location ?? $0.name }.joined(separator: " to "),
                                  route.plausible == false ? "not where it is flying now" : nil].compactMap { $0 }.joined(separator: " · "))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                if let faa = detail?.faa { FAARecordSection(faa: faa) }
            }
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // The card's own close, whether a sheet (iPhone) or the
                    // inspector (iPad) holds it.
                    Button { FlightUI.shared.card = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Close")
                }
            }
            .navigationDestination(for: PastFlightSummary.self) { flight in PastFlightCard(hex: hex, flight: flight) }
            .task(id: hex) { await load() }
            .task(id: plane?.callsign) {
                guard let callsign = plane?.callsign?.trimmingCharacters(in: .whitespaces), !callsign.isEmpty else { return }
                route = try? await Planner.flightRoute(callsign: callsign, lat: plane?.lat, lon: plane?.lon)
            }
        }
    }

    private func watchBinding(_ kind: AirplaneWatch.Kind) -> Binding<Bool> {
        Binding(get: { tracking.watching(hex, kind) }, set: { _ in tracking.toggleWatch(AirplaneWatch(hex: hex.lowercased(), name: name, kind: kind)) })
    }

    private func load() async {
        async let detailAsk = Planner.flight(hex)
        async let pastAsk = Planner.pastFlights(hex)
        async let basedAsk = Planner.based([hex])
        detail = try? await detailAsk
        if let trail = detail?.trail { tracking.seed(trail, for: hex) }
        if let kept { tracking.remember(kept) }
        do {
            history = try await pastAsk
            flights = history?.flights ?? []
        } catch {
            problem = "Its past flights could not be had. Try again in a moment."
        }
        based = (try? await basedAsk)?.based[hex.lowercased()] ?? nil
    }

    /// Ten more, before the last listed, as far back as the archive goes.
    private func more() async {
        guard let until = history?.nextUntil else { return }
        fetchingMore = true
        if let page = try? await Planner.pastFlights(hex, until: until, before: flights.last?.off) {
            history = page
            flights += (page.flights ?? []).filter { f in !flights.contains { $0.id == f.id } }
        }
        fetchingMore = false
    }
}

extension String {
    /// Nil for an empty string, for a "—" in its place.
    var nonEmpty: String? { isEmpty ? nil : self }
}

/// The flight it is on now, laid out as FlightAware's entry for a flight
/// in the air: how long it has flown, where it left and where it is bound,
/// how it is flying, its squawk, and with own ship known, how far and
/// which way it is and how high against own ship.
struct NowFlightRow: View {
    let plane: TrafficAircraft
    let detail: FlightDetail?
    let route: FlightRoute?
    @Environment(OwnShip.self) private var ownShip

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Circle().fill(.green).frame(width: 8, height: 8)
                Text(started.map { "In the air · \(FlightWords.lasted(Date().timeIntervalSince1970 - $0))" } ?? "In the air")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.green)
                Spacer()
                if let type = detail?.type ?? plane.type { Text(type).font(.subheadline).foregroundStyle(.secondary) }
            }
            HStack(alignment: .top) {
                VStack(alignment: .leading) {
                    Text(detail?.departed?.ident ?? route?.airports.first?.ident ?? "?").font(.title3.bold())
                    if let at = detail?.departed?.at { Text(Date(timeIntervalSince1970: at).formatted(date: .omitted, time: .shortened)).font(.footnote) }
                }
                Spacer()
                Image(systemName: "arrow.right")
                Spacer()
                Text(route.flatMap { $0.airports.count > 1 ? $0.airports.last?.ident : nil } ?? "Now").font(.title3.bold())
            }
            Text(flying).font(.subheadline.monospacedDigit().weight(.semibold))
                .accessibilityLabel(spokenFlying)
            if let squawk = plane.squawk {
                // An emergency code says its meaning in words beside the
                // red (FlightWords.squawk), so the colour is not the only
                // sign of it.
                Text("Squawk \(squawk)\(FlightWords.squawk(squawk).map { " · \($0)" } ?? "")")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(FlightWords.squawk(squawk) != nil ? Color.red : Color.secondary)
                    .accessibilityLabel("Squawk \(SpokenFigures.digits(squawk))\(FlightWords.squawk(squawk).map { ", \($0)" } ?? "")")
            }
            if let fix = ownShip.fix {
                Text(fromYou(fix)).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var started: Double? { detail?.departed?.at ?? detail?.trail?.first?.t }

    /// Its height to the 25 ft, its climb, ground speed and track, as sent.
    private var flying: String {
        let rate = plane.verticalFpm ?? 0
        let climb = abs(rate) >= 100 ? "\(rate > 0 ? "↑" : "↓") \((Int((abs(rate) / 100).rounded()) * 100).formatted()) fpm" : "level"
        let height = plane.altitudeFt.map { "\((Int(($0 / 25).rounded()) * 25).formatted()) ft" } ?? "—"
        let speed = plane.speedKt.map { "\(Int($0.rounded())) kt" } ?? "—"
        let track = plane.trackDeg.map { " · \(Formats.degrees($0)) true" } ?? ""
        return "\(height) \(climb) · \(speed)\(track)"
    }

    /// The same line in words: the arrows would be read as "up arrow".
    private var spokenFlying: String {
        let rate = plane.verticalFpm ?? 0
        let climb = abs(rate) >= 100 ? "\(rate > 0 ? "climbing" : "descending") \(SpokenFigures.feetPerMinute((abs(rate) / 100).rounded() * 100))" : "level"
        return [plane.altitudeFt.map { SpokenFigures.feet(($0 / 25).rounded() * 25) }, climb, plane.speedKt.map(SpokenFigures.knots),
                plane.trackDeg.map { "track \(SpokenFigures.degrees($0)) true" }].compactMap { $0 }.joined(separator: ", ")
    }

    private func fromYou(_ fix: OwnShip.Fix) -> String {
        let here = CLLocationCoordinate2D(latitude: plane.lat, longitude: plane.lon)
        let nm = Flight.nm(from: fix.coordinate, to: here)
        let bearing = Flight.bearing(from: fix.coordinate, to: here)
        let height = fix.altitudeFt.flatMap { own in plane.altitudeFt.map { ", " + FlightWords.against($0 - own) } } ?? ""
        return "\(Formats.nm(nm, decimals: 0)) \(AirportWords.compassPoint(bearing)) of you" + height
    }
}

/// One of its flights, as FlightAware's list sets it: how it ended and its
/// type, then from and to, each field's town and when.
struct PastFlightRow: View {
    let flight: PastFlightSummary
    let type: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(FlightWords.ended(flight)).foregroundStyle(flight.landed || flight.inAir ? Color.green : Color.secondary)
                Spacer()
                if let type { Text(type).foregroundStyle(.secondary) }
            }
            .font(.subheadline.weight(.semibold))
            HStack(alignment: .top) {
                end(flight.origin?.ident ?? "?", FlightWords.place(flight.origin), FlightWords.when(flight.off), trailing: false)
                Image(systemName: flight.local ? "arrow.clockwise" : "arrow.right").padding(.top, 4)
                end(flight.inAir ? "Now" : flight.destination?.ident ?? "?", flight.inAir ? nil : FlightWords.place(flight.destination),
                    flight.inAir ? nil : FlightWords.when(flight.on), trailing: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func end(_ ident: String, _ place: String?, _ when: String?, trailing: Bool) -> some View {
        VStack(alignment: trailing ? .trailing : .leading, spacing: 1) {
            Text(ident).font(.headline)
            if let place { Text(place).font(.footnote).foregroundStyle(.secondary).lineLimit(1) }
            if let when { Text(when).font(.footnote) }
        }
        .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
    }
}

/// One of its flights opened: its path on the map in its heights'
/// colours, and its profile, height and ground speed against time, as
/// FlightAware's graph of a flight (the web app's PastFlightChart).
struct PastFlightCard: View {
    let hex: String
    let flight: PastFlightSummary
    @State private var points: [PastFlightPoint] = []
    @State private var problem: String?

    var body: some View {
        List {
            Section { PastFlightRow(flight: flight, type: nil) }
            if points.isEmpty {
                Section("Profile") {
                    Text(problem ?? "Fetching its track…").foregroundStyle(problem == nil ? Color.secondary : Color.red)
                }
            } else {
                // Its replay, the airplane flown along it again on the map.
                ReplaySection(points: Replay.points(points), key: replayKey)
                Section {
                    LabeledContent("Highest", value: "\(Int(flight.maxAltFt).formatted()) ft")
                    LabeledContent("Flown", value: FlightWords.lasted(flight.on - flight.off))
                }
            }
        }
        .navigationTitle("\(flight.origin?.ident ?? "?") → \(flight.inAir ? "Now" : flight.destination?.ident ?? "?")")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: flight.id) {
            do {
                points = try await Planner.pastFlight(hex, id: flight.id).points
                Tracking.shared.past = points.map { PathPoint(t: $0.t, lat: $0.lat, lon: $0.lon, altFt: $0.altFt) }
            } catch {
                problem = "Its track could not be had."
            }
        }
        .onDisappear {
            Tracking.shared.past = []
            Replay.shared.clear(replayKey)
        }
    }

    private var replayKey: String { "past:\(hex):\(flight.id)" }
}

/// A flight's height against time and its ground speed where known,
/// Swift Charts: the replay's moment a cursor across it, with a dot on
/// each trace where the airplane is, and a finger drawn along it moves
/// the replay there (the web app's PastFlightChart). The speed is held to
/// the lower half, so the two read apart where both run level, as the
/// web app's are.
struct FlightProfileChart: View {
    let points: [Replay.Point]
    /// The replay's airplane, where it is.
    var cursor: Replay.Point?
    /// A finger on the profile: the moment under it, s since 1970.
    var onScrub: ((Double) -> Void)?
    @State private var picked: Date?

    /// At most this many points drawn: a long flight's thousands of
    /// reports drawn again with each tick of a replay were the cost, not
    /// the look.
    static let drawn = 400

    private var shown: [Replay.Point] {
        guard points.count > Self.drawn, let last = points.last else { return points }
        let every = (points.count + Self.drawn - 1) / Self.drawn
        return Swift.stride(from: 0, to: points.count, by: every).map { points[$0] } + [last]
    }

    private var top: Double { max(1000, (points.compactMap(\.altFt).max() ?? 0) * 1.25) }
    private var ktTop: Double { max(1, (points.compactMap(\.gsKt).max() ?? 0) * 2.2) }
    private func feet(_ kt: Double) -> Double { kt / ktTop * top }

    var body: some View {
        Chart {
            ForEach(Array(shown.enumerated()), id: \.offset) { _, point in
                if let ft = point.altFt {
                    AreaMark(x: .value("Time", Date(timeIntervalSince1970: point.t)), y: .value("Feet", ft))
                        .foregroundStyle(.linearGradient(colors: [Color.accentColor.opacity(0.3), Color.accentColor.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    LineMark(x: .value("Time", Date(timeIntervalSince1970: point.t)), y: .value("Feet", ft), series: .value("Trace", "Height"))
                        .foregroundStyle(Color.accentColor)
                }
                if let kt = point.gsKt {
                    LineMark(x: .value("Time", Date(timeIntervalSince1970: point.t)), y: .value("Feet", feet(kt)), series: .value("Trace", "Ground speed"))
                        .foregroundStyle(Color.orange)
                }
            }
            if let cursor {
                RuleMark(x: .value("Now", Date(timeIntervalSince1970: cursor.t)))
                    .foregroundStyle(Color.primary.opacity(0.5))
                if let ft = cursor.altFt {
                    PointMark(x: .value("Now", Date(timeIntervalSince1970: cursor.t)), y: .value("Feet", ft))
                        .foregroundStyle(Color.accentColor).symbolSize(60)
                }
                if let kt = cursor.gsKt {
                    PointMark(x: .value("Now", Date(timeIntervalSince1970: cursor.t)), y: .value("Feet", feet(kt)))
                        .foregroundStyle(Color.orange).symbolSize(60)
                }
            }
        }
        .chartYScale(domain: 0...top)
        .chartYAxisLabel("ft")
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { _ in AxisGridLine(); AxisValueLabel(format: .dateTime.hour().minute()) } }
        .chartXSelection(value: $picked)
        .onChange(of: picked) { _, date in
            if let date { onScrub?(date.timeIntervalSince1970) }
        }
        .accessibilityLabel("Profile, highest \(SpokenFigures.feet(points.compactMap(\.altFt).max() ?? 0))")
        // Where the replay's airplane is, as the figures over the chart say
        // it; the slider under the chart is the way to move it by VoiceOver.
        .accessibilityValue(cursor.map { "\(ReplaySection.clock($0.t)), \(ReplaySection.spoken($0))" } ?? "")
    }
}

/// A US airplane's FAA registration: who it is registered to and where,
/// whether it is in effect and till when, what it is and its engine, and
/// its airworthiness certificate -- the registry's own record. An owner who
/// asked the FAA to withhold their name (49 U.S.C. 44114) is not in it.
struct FAARecordSection: View {
    let faa: FAARecord

    var body: some View {
        Section("FAA registration") {
            if let owner = faa.owner {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Registered to").font(.subheadline.weight(.semibold))
                    Text([owner, faa.ownerType, [faa.city, faa.state].compactMap { $0 }.joined(separator: ", ").nonEmpty,
                          (faa.coOwners ?? 0) > 0 ? "and \(faa.coOwners!) more" : nil, faa.fractional == true ? "fractional" : nil]
                        .compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                }
            }
            LabeledContent(faa.nNumber) {
                Text(faa.status ?? "—").foregroundStyle(faa.standing == "lapsed" ? Color.red : Color.primary)
            }
            if let expires = faa.expires { LabeledContent("Expires", value: expires) }
            if faa.manufacturer != nil || faa.model != nil {
                LabeledContent([faa.manufacturer, faa.model].compactMap { $0 }.joined(separator: " "),
                               value: [faa.year.map { String($0) }, faa.seats.map { "\($0) seats" }].compactMap { $0 }.joined(separator: " · "))
            }
            if let engine = faa.engine {
                LabeledContent(engine, value: [faa.engineType, faa.horsepower.map { "\($0.formatted()) hp" } ?? faa.thrustLb.map { "\($0.formatted()) lb thrust" }]
                    .compactMap { $0 }.joined(separator: " · "))
            }
            if let airworthiness = faa.airworthiness {
                LabeledContent("Airworthiness", value: [airworthiness, faa.airworthinessDate.map { "since \($0)" }].compactMap { $0 }.joined(separator: " · "))
            }
        }
    }
}

private enum PreviewData {
    static let plane = TrafficAircraft(altitudeFt: 4500, callsign: "N3429J", hex: "a8c2e1", lat: 46.84, lon: -92.19, registration: "N3429J",
                                       speedKt: 112, squawk: "1200", trackDeg: 215, type: "P28A", verticalFpm: 0)
    static let faa = FAARecord(nNumber: "N3429J", airworthiness: "Standard", airworthinessDate: "1998-04-02", city: "Duluth",
                               engine: "Lycoming O-320", engineType: "Reciprocating", expires: "2028-06-30", horsepower: 150,
                               manufacturer: "Piper", model: "PA-28-140", owner: "Lake Superior Flying Club", ownerType: "Corporation",
                               seats: 4, standing: "current", state: "MN", status: "Valid", year: 1968)
    static let detail = FlightDetail(hex: "a8c2e1", departed: FlightDeparted(at: 1_762_180_000, ident: "KDLH", name: "Duluth Intl"),
                                     description: "PIPER PA-28-140", `operator`: "LAKE SUPERIOR FLYING CLUB", registration: "N3429J",
                                     type: "P28A", year: "1968", faa: faa)
    static let route = FlightRoute(airports: [RouteAirport(ident: "KDLH", location: "Duluth", name: "Duluth Intl"),
                                              RouteAirport(ident: "KBRD", location: "Brainerd", name: "Brainerd Lakes Rgnl")], plausible: true)
    static let flight = PastFlightSummary(id: 1, inAir: false, landed: true, maxAltFt: 5500, off: 1_762_000_000, on: 1_762_003_120,
                                          origin: PastFlightField(ident: "KDLH", city: "Duluth", name: "Duluth Intl", region: "US-MN"),
                                          destination: PastFlightField(ident: "KBRD", city: "Brainerd", name: "Brainerd Lakes Rgnl", region: "US-MN"))
}

#Preview("NowFlightRow") {
    List { NowFlightRow(plane: PreviewData.plane, detail: PreviewData.detail, route: PreviewData.route) }
        .environment(OwnShip())
}

#Preview("PastFlightRow") {
    List {
        PastFlightRow(flight: PreviewData.flight, type: "P28A")
        PastFlightRow(flight: PastFlightSummary(id: 2, inAir: true, landed: false, maxAltFt: 4500, off: 1_762_180_000, on: 1_762_182_400,
                                                origin: PastFlightField(ident: "KDLH", city: "Duluth", region: "US-MN")), type: "P28A")
    }
}

#Preview("PastFlightCard") {
    NavigationStack { PastFlightCard(hex: "a8c2e1", flight: PreviewData.flight) }
}

#Preview("FlightProfileChart") {
    let start = 1_762_000_000.0
    // Typed out: as one inferred closure the type checker gave up on it.
    let points: [Replay.Point] = (0..<40).map { (i: Int) -> Replay.Point in
        let n = Double(i)
        let climb: Double = Double(min(i, 20)) * 250
        let gust: Double = Double(i % 7) * 3
        return Replay.Point(t: start + n * 60, lat: 46.84 - n * 0.01, lon: -92.19 - n * 0.015,
                            altFt: 1400 + climb, gsKt: 95 + gust)
    }
    return FlightProfileChart(points: points, cursor: points[15])
        .frame(height: 180)
        .padding()
}

#Preview("FAARecordSection") {
    List { FAARecordSection(faa: PreviewData.faa) }
}
