import SwiftUI

/// The rows an airport's card is made of, as the web app's are
/// (FrequencyRow, RunwayRow, StopServices): a glyph on a coloured badge,
/// the name, a line under it, and the figure a pilot looks for at the
/// right in the text's own colour.

/// The badges' colours, the web app's (lib/rowBadges).
enum Badge {
    static func hex(_ rgb: UInt32) -> Color { Color(uiColor: UIColor(hex: rgb)) }

    static let tower = hex(0x2465b8)
    static let ground = hex(0x0f766e)
    static let weather = hex(0x0284c7)
    static let approach = hex(0x5b5bd6)
    static let traffic = hex(0xc2410c)
    static let other = hex(0x6b7280)
    static let runway = hex(0x3f4652)
    static let chart = hex(0x475569)
    static let rule = hex(0x64748b)
    static let hazard = hex(0xb42318)
    static let lights = hex(0xa16207)
    static let fuel = hex(0xb45309)
    static let car = hex(0x2563eb)
    static let food = hex(0xbe185d)
    static let lodging = hex(0x7e3fb8)
}

/// A glyph on a rounded square of colour, as Settings' rows have them.
struct RowBadge: View {
    let systemImage: String
    let colour: Color

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(colour, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A row of the card: badge, title, the line under it, the value at the right.
struct CardRow<Value: View>: View {
    var badge: RowBadge?
    let title: String
    var detail: String?
    @ViewBuilder var value: () -> Value

    var body: some View {
        HStack(spacing: 12) {
            if let badge { badge }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let detail, !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            value().multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

extension CardRow where Value == EmptyView {
    init(badge: RowBadge? = nil, title: String, detail: String? = nil) {
        self.init(badge: badge, title: title, detail: detail) { EmptyView() }
    }
}

/// A field's frequency: its name in words, a glyph by its kind, and the
/// frequency as pilots write it at the right.
struct FrequencyRowView: View {
    let frequency: Frequency

    static func glyph(_ kind: AirportWords.FrequencyKind) -> (String, Color) {
        switch kind {
        case .tower: ("building.columns", Badge.tower)
        case .ground: ("headphones", Badge.ground)
        case .weather: ("cloud.sun", Badge.weather)
        case .approach: ("dot.radiowaves.left.and.right", Badge.approach)
        case .traffic: ("antenna.radiowaves.left.and.right", Badge.traffic)
        case .other: ("radio", Badge.other)
        }
    }

    var body: some View {
        let line = AirportWords.frequencyLine(type: frequency.type, description: frequency.description)
        let glyph = Self.glyph(line.kind)
        CardRow(badge: RowBadge(systemImage: glyph.0, colour: glyph.1), title: line.name, detail: line.detail) {
            Text(frequency.frequencyMhz.map(AirportWords.mhz) ?? "—").fontWeight(.semibold).monospacedDigit()
        }
    }
}

/// A runway: drawn on its badge along its true heading, its ends, its
/// surface and lights, any end flown with right traffic, the reported
/// wind on the end it favours as the planner worked it out, and its
/// length and width at the right.
struct RunwayRowView: View {
    let runway: Runway

    var body: some View {
        let heading = (runway.runwayEnds ?? []).compactMap(\.headingTrueDeg).first
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Badge.runway)
                RoundedRectangle(cornerRadius: 1).fill(.white).frame(width: 5, height: 18)
                    .rotationEffect(.degrees(heading ?? 0))
            }
            .frame(width: 28, height: 28)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Runway \(runway.ends ?? "—")")
                let detail = AirportWords.runwayDetail(runway)
                if !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                if let wind = runway.wind {
                    Text(AirportWords.runwayWind(wind)).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(runway.lengthFt.map { "\(AirportWords.grouped(Double($0))) ft" } ?? "—").fontWeight(.semibold).monospacedDigit()
                if let width = runway.widthFt { Text("\(width) ft wide").font(.footnote).foregroundStyle(.secondary) }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The field's runways drawn north up from where the FAA surveys their
/// ends, for a field with no FAA diagram (the web app's RunwaySketch): a
/// picture of where they lie, not a chart to taxi by.
struct RunwaySketch: View {
    let runways: [Runway]

    /// The runways with both ends surveyed, as pairs of points.
    static func strips(_ runways: [Runway]) -> [(ends: [String], a: CGPoint, b: CGPoint)] {
        let surveyed = runways.compactMap { runway -> (ends: [String], a: (Double, Double), b: (Double, Double))? in
            let ends = (runway.runwayEnds ?? []).filter { $0.lat != nil && $0.lon != nil }
            guard ends.count >= 2, let a = ends.first, let b = ends.last else { return nil }
            return ([a.ident, b.ident], (a.lat!, a.lon!), (b.lat!, b.lon!))
        }
        guard let first = surveyed.first else { return [] }
        let squeeze = cos(first.a.0 * .pi / 180)
        return surveyed.map { strip in
            (strip.ends, CGPoint(x: strip.a.1 * squeeze, y: -strip.a.0), CGPoint(x: strip.b.1 * squeeze, y: -strip.b.0))
        }
    }

    var body: some View {
        Canvas { context, size in
            let strips = Self.strips(runways)
            let xs = strips.flatMap { [$0.a.x, $0.b.x] }, ys = strips.flatMap { [$0.a.y, $0.b.y] }
            guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() else { return }
            let span = max(maxX - minX, maxY - minY, 1e-6)
            let scale = min(size.width, size.height) * 0.75 / span
            let middle = CGPoint(x: (minX + maxX) / 2, y: (minY + maxY) / 2)
            func place(_ p: CGPoint) -> CGPoint {
                CGPoint(x: size.width / 2 + (p.x - middle.x) * scale, y: size.height / 2 + (p.y - middle.y) * scale)
            }
            for strip in strips {
                var line = Path()
                line.move(to: place(strip.a))
                line.addLine(to: place(strip.b))
                context.stroke(line, with: .color(.primary), style: StrokeStyle(lineWidth: max(4, min(size.width, size.height) / 28), lineCap: .butt))
                // Each end's number just past it, along the runway.
                let pa = place(strip.a), pb = place(strip.b)
                let length = max(hypot(pa.x - pb.x, pa.y - pb.y), 1)
                let dx = (pa.x - pb.x) / length * 12, dy = (pa.y - pb.y) / length * 12
                context.draw(Text(AirportWords.runwayNumber(strip.ends[0])).font(.caption2.weight(.bold)), at: CGPoint(x: pa.x + dx, y: pa.y + dy))
                context.draw(Text(AirportWords.runwayNumber(strip.ends[1])).font(.caption2.weight(.bold)), at: CGPoint(x: pb.x - dx, y: pb.y - dy))
            }
        }
        .accessibilityLabel("Runways \(Self.strips(runways).map { $0.ends.joined(separator: "/") }.joined(separator: ", ")), north up")
    }
}

/// One of the card's actions, as Maps' place card has them: a glyph over
/// its name on a rounded pane, the first in the tint.
struct CardActionLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: systemImage).font(.title3)
            Text(title).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, minHeight: 44)
    }
}

/// What the field offers on the ground, after the radio and the lights
/// (the web app's StopServices): the fuel and its remarks, what is on
/// the field from its Chart Supplement entry, then the places to eat,
/// sleep and hire a car within five miles, nearest first. A place with a
/// website opens it, one with a phone calls it.
struct StopServicesSections: View {
    let ident: String
    @State private var services: AirportServices?
    @State private var problem: String?

    var body: some View {
        Group {
            if let s = services {
                Section("Fuel") {
                    CardRow(badge: RowBadge(systemImage: "fuelpump", colour: Badge.fuel),
                            title: (s.fuelTypes ?? []).isEmpty ? "None listed" : AirportWords.fuelNames(s.fuelTypes ?? []))
                    // The remarks in plain English as the planner gives
                    // them (vfr.remarks.service_notes).
                    ForEach(s.fuelNotes ?? [], id: \.self) { Text($0) }
                }
                let field = onTheField(s)
                if !field.isEmpty {
                    Section("On the field") {
                        ForEach(field, id: \.title) { row in
                            CardRow(badge: RowBadge(systemImage: row.symbol, colour: row.colour), title: row.title, detail: row.detail) {
                                if let value = row.value { Text(value).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                places("Food nearby", s.food, "fork.knife", Badge.food)
                places("Places to stay", s.lodging, "bed.double", Badge.lodging)
                places("Car rental", s.cars, "car", Badge.car)
                if s.nearbyUnavailable == true {
                    Section("Nearby") { Text("Places near the field could not be looked up").foregroundStyle(.secondary) }
                }
            } else if let problem {
                Section("Services") {
                    Text(problem).foregroundStyle(.secondary)
                    Button("Try Again") { Task { await load() } }
                }
            } else {
                Section("Services") { ProgressView("Fetching the services…") }
            }
        }
        .task(id: ident) { await load() }
    }

    private func load() async {
        problem = nil
        do { services = try await Planner.services(ident) } catch { problem = "The services could not be fetched." }
    }

    private struct FieldRow { let symbol: String; let colour: Color; let title: String; var detail: String?; var value: String? }

    private func onTheField(_ s: AirportServices) -> [FieldRow] {
        let repair = [s.airframeRepair.map { "airframe \($0)" }, s.powerplantRepair.map { "engine \($0)" }].compactMap { $0 }.joined(separator: ", ")
        return [
            s.courtesyCar == true ? FieldRow(symbol: "car.fill", colour: Badge.car, title: "Courtesy car", detail: (s.groundNotes ?? []).joined(separator: " ")) : nil,
            s.tieDown == true ? FieldRow(symbol: "parkingsign", colour: Badge.runway, title: "Tie-downs") : nil,
            s.hangar == true ? FieldRow(symbol: "house.lodge", colour: Badge.runway, title: "Hangars") : nil,
            repair.isEmpty ? nil : FieldRow(symbol: "wrench.and.screwdriver", colour: Badge.other, title: "Repair", value: repair),
            s.oxygen == true ? FieldRow(symbol: "aqi.medium", colour: Badge.other, title: "Oxygen") : nil,
            s.landingFee.map { FieldRow(symbol: "doc.text", colour: Badge.other, title: "Landing fee", value: $0 ? "Yes" : "None") },
        ].compactMap { $0 }
    }

    @ViewBuilder
    private func places(_ title: String, _ list: [NearbyPlace]?, _ symbol: String, _ colour: Color) -> some View {
        if let list, !list.isEmpty {
            Section {
                ForEach(list) { place in
                    let row = CardRow(badge: RowBadge(systemImage: symbol, colour: colour), title: place.name, detail: place.kind) {
                        Text(AirportWords.away(place)).foregroundStyle(.secondary).monospacedDigit()
                    }
                    if let link = place.website.flatMap(URL.init(string:)) ?? place.phone.flatMap({ URL(string: "tel:" + $0.filter { !$0.isWhitespace }) }) {
                        Link(destination: link) { row }.foregroundStyle(.primary)
                    } else {
                        row
                    }
                }
            } header: {
                Text(title)
            } footer: {
                // Overture's credit under its places, as its licence asks.
                Text("Places © Overture Maps Foundation")
            }
        }
    }
}
