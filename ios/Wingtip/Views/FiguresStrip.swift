import SwiftUI

/// The flight's figures in one line -- To, Dist, ETE, Fuel -- what the
/// web app's pill shows at the sheet's foot (FlightLine), and what the
/// pilot glances at in the air. The fuel is the engine's `strip_fuel`,
/// the web's and Android's: the fuel required, less what a flight under
/// way has burnt, red where the tanks do not hold it and its reserve (14
/// CFR 91.151, 91.167).
struct FiguresStrip: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(DryRun.self) private var dryRun

    /// In the air on the route -- moving, within 3 nm of the line -- the
    /// figures count down from where the airplane is, as the web app's do
    /// in a dry run (Flight): what is left to the destination at the
    /// groundspeed now, and the fuel still required.
    private var flying: (leftNm: Double, minutes: Double?, fuelGal: Double?)? {
        // A dry run's airplane counts as flying; else own ship, moving.
        guard let fix = dryRun.fix ?? ownShip.fix, let gs = fix.groundspeedKt, Flight.underway(gs), let course = plan.course,
              let along = Flight.along(fix.coordinate, line: course.coordinates),
              Flight.off(fix.coordinate, line: course.coordinates) <= 3 else { return nil }
        let required = Self.fuel(plan.totals, burntGal: Flight.burnt(legs: plan.legs, alongNm: along.alongNm)).requiredGal
        return (along.leftNm, along.leftNm / gs * 60, required)
    }

    /// The engine's answer to strip_fuel.
    struct StripFuel: Decodable {
        struct Short: Decodable { let name: String; let shortGal: Double }
        let requiredGal: Double?
        let short: [Short]
    }

    /// The strip's fuel from the planner's totals, as the engine works it
    /// for the three apps: required, less `burntGal`, and where short.
    static func fuel(_ totals: Totals?, burntGal: Double? = nil) -> StripFuel {
        let answer: StripFuel? = try? Engine.call("strip_fuel", json: [
            "fuel_required_gal": totals?.fuelRequiredGal, "fuel_margin_gal": totals?.fuelMarginGal, "burnt_gal": burntGal,
        ], decoder: Planner.snakeCase)
        return answer ?? StripFuel(requiredGal: nil, short: [])
    }

    var body: some View {
        let fuel = Self.fuel(plan.totals)
        let warn = !fuel.short.isEmpty
        HStack {
            stripFigure("TO", plan.routed ? plan.dest : "—")
            if let flying {
                stripFigure("DIST", AirportWords.nm(flying.leftNm), spoken: SpokenFigures.nauticalMiles(flying.leftNm))
                stripFigure("ETE", flying.minutes.map(hoursMinutes) ?? "—", spoken: flying.minutes.map(SpokenFigures.minutes))
                stripFigure("FUEL", flying.fuelGal.map(AirportWords.gal) ?? "—", spoken: flying.fuelGal.map(SpokenFigures.gallons), warn: warn)
            } else {
                let distance = plan.totals?.distanceNm ?? plan.course?.distanceNm
                stripFigure("DIST", distance.map(AirportWords.nm) ?? "—", spoken: distance.map(SpokenFigures.nauticalMiles))
                stripFigure("ETE", plan.totals?.eteMin.map(hoursMinutes) ?? "—", spoken: plan.totals?.eteMin.map(SpokenFigures.minutes))
                stripFigure("FUEL", fuel.requiredGal.map(AirportWords.gal) ?? "—", spoken: fuel.requiredGal.map(SpokenFigures.gallons), warn: warn)
            }
        }
        .padding(.horizontal)
        .frame(maxWidth: .infinity)
        // Four figures across a phone: past the second accessibility size
        // they would not fit the line, so the strip stops there.
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .accessibilityElement(children: .combine)
    }
}

/// One figure of a strip, its name over it: the sheet's strip and FPL's
/// totals. `spoken` is the figure as VoiceOver says it (SpokenFigures),
/// where the written one would be read as letters.
func stripFigure(_ name: String, _ value: String, spoken: String? = nil, warn: Bool = false) -> some View {
    VStack(spacing: 2) {
        Text(name).font(.caption2).foregroundStyle(.secondary)
        HStack(spacing: 3) {
            // A mark with the red, for a pilot who does not see the colour
            // (the owner's rule: warn, never limit).
            if warn { Image(systemName: "exclamationmark.triangle.fill").font(.caption2) }
            Text(value).font(.headline.monospacedDigit())
        }
        .foregroundStyle(warn ? Color.red : Color.primary)
        .lineLimit(1).minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(stripFigureName(name)), \(spoken ?? value)\(warn ? ", under the reserve" : "")")
}

/// The strip's short headings in full for VoiceOver.
private func stripFigureName(_ name: String) -> String {
    switch name {
    case "TO": "To"
    case "DIST": "Distance"
    case "ETE": "Time en route"
    case "FUEL": "Fuel"
    default: name
    }
}

/// The route's own bar items, FPL's on the iPhone and in the iPad's
/// column alike: the stops' Edit, and with a route, Share and Clear.
struct RouteToolbar: ToolbarContent {
    let plan: Plan

    var body: some ToolbarContent {
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
}

#Preview("FiguresStrip") {
    // The totals come with the planner's nav log, so the figures past the
    // destination show as dashes here.
    let plan = Plan()
    plan.dep = "KDLH"
    plan.dest = "KHIB"
    return FiguresStrip()
        .environment(plan)
        .environment(OwnShip())
        .environment(DryRun())
}
