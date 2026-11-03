import Foundation
import WidgetKit

/// The Home Screen and Lock Screen widgets' snapshot of the next flight
/// (WidgetSnapshot, the FlightWidget in the WingtipWidgets extension),
/// kept current from the plan on the page and the Brief's verdict. It is
/// written to the App Group only as something changes, and the widget
/// is told to redraw then and not otherwise, since WidgetKit gives each
/// app a budget of redraws a day. Run on the app's one clock (Ticker,
/// WingtipApp) rather than a loop of its own.
@MainActor
final class WidgetFeed {
    static let shared = WidgetFeed()

    /// The widget's kind, as FlightWidget names it.
    static let kind = "FlightWidget"
    /// How long the departure's weather stands before it is asked for
    /// again: a METAR is hourly, with specials between, and the widget
    /// is read at a glance, not flown by.
    static let weatherEvery: TimeInterval = 10 * 60

    /// What was last written, to write only a change.
    private var last: WidgetSnapshot?
    /// The departure's weather as last asked for: which field, the
    /// report, its wind in words, and when; nil for a field with no
    /// report near it, asked again after `weatherEvery`.
    private var weather: (ident: String, metar: Metar?, wind: String?, at: Date)?
    private var fetching: Task<Void, Never>?

    private init() {
        last = WidgetSnapshot.read()
    }

    /// The snapshot brought up to the plan and the verdict on the page,
    /// and the departure's weather asked for where it is due. While the
    /// route is being planned again or the verdict asked again the
    /// figures are kept but the verdict says it is being checked, so an
    /// old answer is never shown against a new route.
    func update(plan: Plan, verdict: Verdict) {
        guard plan.routed else {
            if last != nil {
                last = nil
                WidgetSnapshot.clear()
                WidgetCenter.shared.reloadTimelines(ofKind: Self.kind)
            }
            return
        }
        let dep = plan.dep.uppercased()
        askWeather(for: dep)
        // The planner's own report for the field, else the briefing's
        // where it has one, until the field's card answers.
        let own = weather?.ident == dep ? weather : nil
        let metar = own?.metar ?? (plan.briefing?.metars[dep] ?? nil)
        let wind = own?.wind ?? metar.map { AirportWords.windLine(dirTrueDeg: $0.windDirTrueDeg, speedKt: $0.windSpeedKt, gustKt: $0.windGustKt) }
        let checking = plan.planning || verdict.asking
        var fresh = WidgetSnapshot(
            dep: dep, dest: plan.dest.uppercased(), stops: plan.stops.map { $0.uppercased() },
            distanceNm: plan.totals?.distanceNm, eteMin: plan.totals?.eteMin, fuelGal: plan.totals?.fuelGal,
            verdict: checking ? "pending" : verdict.answer?.line.finding,
            verdictWords: checking ? nil : verdict.answer?.line.words,
            depMetarRaw: metar?.raw, depFlightCategory: metar?.flightCategory, depWind: wind,
            updatedAt: last?.updatedAt ?? Date())
        guard fresh != last else { return }
        fresh.updatedAt = Date()
        last = fresh
        fresh.write()
        WidgetCenter.shared.reloadTimelines(ofKind: Self.kind)
    }

    /// The field's card asked of the planner for its report -- its own,
    /// or one near enough to be said of it (NearbyMetar) -- no more than
    /// every `weatherEvery` and never twice at once; with no answer the
    /// field is marked asked, and asked again when that time is up.
    private func askWeather(for dep: String) {
        if let asked = weather, asked.ident == dep, Date().timeIntervalSince(asked.at) < Self.weatherEvery { return }
        guard fetching == nil else { return }
        fetching = Task { [weak self] in
            let place = try? await Planner.place(dep)
            let metar = place?.metar ?? (place?.nearbyMetar?.near == true ? place?.nearbyMetar?.metar : nil)
            let wind = metar.map { AirportWords.windLine(dirTrueDeg: $0.windDirTrueDeg, speedKt: $0.windSpeedKt, gustKt: $0.windGustKt) }
            guard let self else { return }
            self.weather = (dep, metar, wind, Date())
            self.fetching = nil
        }
    }
}
