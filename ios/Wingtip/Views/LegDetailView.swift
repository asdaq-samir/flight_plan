import SwiftUI

/// One leg in full, as the nav log's row opens in the web app: the
/// course, the wind and its correction, the headings true and magnetic
/// with the variation between them, the speeds, the time and the fuel,
/// and where the climb and the descent fall. Every figure the planner's.
struct LegDetailView: View {
    let leg: Leg

    var body: some View {
        List {
            // Each figure's accessibilityValue is the figure as a pilot says
            // it (SpokenFigures), where "090°" would be read as "ninety".
            Section("Course and heading") {
                LabeledContent("True course", value: AirportWords.degrees(leg.trueCourseDeg))
                    .accessibilityValue(SpokenFigures.degrees(leg.trueCourseDeg))
                if let wind = leg.wind, let dir = wind.directionDeg, let kt = wind.speedKt {
                    LabeledContent("Wind", value: "\(Formats.degrees(dir)) at \(Formats.kt(kt))")
                        .accessibilityValue("\(SpokenFigures.degrees(dir)) at \(SpokenFigures.knots(kt))")
                }
                LabeledContent("Wind correction", value: "\(leg.wcaDeg >= 0 ? "+" : "")\(Formats.number(leg.wcaDeg, decimals: 0))°")
                    .accessibilityValue("\(leg.wcaDeg < 0 ? "minus" : "plus") \(SpokenFigures.number(abs(leg.wcaDeg))) degrees")
                LabeledContent("True heading", value: AirportWords.degrees(leg.trueHeadingDeg))
                    .accessibilityValue(SpokenFigures.degrees(leg.trueHeadingDeg))
                LabeledContent("Variation", value: "\(Formats.number(abs(leg.magneticVariationDeg), decimals: 0))° \(Flight.variationSide(leg.magneticVariationDeg).letter)")
                    .accessibilityValue("\(SpokenFigures.number(abs(leg.magneticVariationDeg))) degrees \(Flight.variationSide(leg.magneticVariationDeg).word)")
                LabeledContent("Magnetic heading", value: AirportWords.degrees(leg.magneticHeadingDeg))
                    .accessibilityValue(SpokenFigures.degrees(leg.magneticHeadingDeg))
            }
            Section("Speed, time and fuel") {
                LabeledContent("Altitude", value: Formats.feet(leg.altitudeFt))
                    .accessibilityValue(SpokenFigures.feet(leg.altitudeFt))
                LabeledContent("True airspeed", value: AirportWords.kt(leg.tasKt))
                    .accessibilityValue(SpokenFigures.knots(leg.tasKt))
                if let gs = leg.groundspeedKt { LabeledContent("Groundspeed", value: AirportWords.kt(gs)).accessibilityValue(SpokenFigures.knots(gs)) }
                LabeledContent("Distance", value: AirportWords.nm(leg.distanceNm))
                    .accessibilityValue(SpokenFigures.nauticalMiles(leg.distanceNm))
                if let ete = leg.eteMin { LabeledContent("Time", value: hoursMinutes(ete)).accessibilityValue(SpokenFigures.minutes(ete)) }
                if let fuel = leg.fuelGal { LabeledContent("Fuel", value: AirportWords.gal(fuel)).accessibilityValue(SpokenFigures.gallons(fuel)) }
                if let climb = leg.climbMin, climb > 0 { LabeledContent("Climbing", value: hoursMinutes(climb)).accessibilityValue(SpokenFigures.minutes(climb)) }
            }
            if leg.toc != nil || leg.tod != nil {
                Section("Climb and descent") {
                    if let toc = leg.toc, let along = toc.alongNm { LabeledContent("Top of climb", value: "\(Formats.nm(along)) along") }
                    if let tod = leg.tod, let along = tod.alongNm { LabeledContent("Top of descent", value: "\(Formats.nm(along)) along") }
                }
            }
        }
        .navigationTitle("\(leg.from) → \(leg.to)")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview("LegDetailView") {
    NavigationStack {
        LegDetailView(leg: Leg(from: "KDLH", to: "KHIB", distanceNm: 62.4, altitudeFt: 4500, trueCourseDeg: 318, magneticHeadingDeg: 315,
                               wcaDeg: -4, trueHeadingDeg: 314, magneticVariationDeg: -1, climbMin: 6, groundspeedKt: 104, eteMin: 36,
                               fuelGal: 5.1, tasKt: 112, wind: Leg.Wind(directionDeg: 270, speedKt: 12),
                               toc: Leg.TopOfClimb(alongNm: 9.2), tod: Leg.TopOfDescent(alongNm: 50.1)))
    }
}
