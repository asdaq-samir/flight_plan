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
                    LabeledContent("Wind", value: String(format: "%03.0f° at %.0f kt", dir, kt))
                        .accessibilityValue("\(SpokenFigures.degrees(dir)) at \(SpokenFigures.knots(kt))")
                }
                LabeledContent("Wind correction", value: String(format: "%+.0f°", leg.wcaDeg))
                    .accessibilityValue("\(leg.wcaDeg < 0 ? "minus" : "plus") \(SpokenFigures.number(abs(leg.wcaDeg))) degrees")
                LabeledContent("True heading", value: AirportWords.degrees(leg.trueHeadingDeg))
                    .accessibilityValue(SpokenFigures.degrees(leg.trueHeadingDeg))
                LabeledContent("Variation", value: String(format: "%.0f° %@", abs(leg.magneticVariationDeg), leg.magneticVariationDeg < 0 ? "E" : "W"))
                    .accessibilityValue("\(SpokenFigures.number(abs(leg.magneticVariationDeg))) degrees \(leg.magneticVariationDeg < 0 ? "east" : "west")")
                LabeledContent("Magnetic heading", value: AirportWords.degrees(leg.magneticHeadingDeg))
                    .accessibilityValue(SpokenFigures.degrees(leg.magneticHeadingDeg))
            }
            Section("Speed, time and fuel") {
                LabeledContent("Altitude", value: "\(Int(leg.altitudeFt).formatted()) ft")
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
                    if let toc = leg.toc, let along = toc.alongNm { LabeledContent("Top of climb", value: String(format: "%.1f nm along", along)) }
                    if let tod = leg.tod, let along = tod.alongNm { LabeledContent("Top of descent", value: String(format: "%.1f nm along", along)) }
                }
            }
        }
        .navigationTitle("\(leg.from) → \(leg.to)")
        .navigationBarTitleDisplayMode(.inline)
    }
}
