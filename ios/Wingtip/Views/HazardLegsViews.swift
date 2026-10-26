import MapKit
import SwiftUI

/// Under a hazard in the Brief, where and when the flight meets it --
/// "Legs 2–3 · 14:20–14:45, valid till 15:00", the planner's (OnRoute) --
/// and a tap shows those legs on the map, a second puts them away, as the
/// web app's OnRouteRow does. Nothing for a hazard the planner could not
/// place.
struct OnRouteRow: View {
    @Environment(Plan.self) private var plan
    let on: OnRoute?
    let key: String

    var body: some View {
        if let on, !on.legs.isEmpty {
            let shown = plan.hazardLegs?.key == key
            Button {
                let lines = BriefLegs.lines(on.legs, fixes: plan.briefing?.legFixes ?? [])
                plan.hazardLegs = shown || lines.isEmpty ? nil : HazardLegs(key: key, lines: lines)
            } label: {
                Label(BriefLegs.line(on), systemImage: shown ? "map.fill" : "map")
                    .font(.subheadline)
            }
            .accessibilityHint(shown ? "Shown on the map" : "Shows these legs on the map")
            .accessibilityAddTraits(shown ? .isSelected : [])
        }
    }
}

/// The fields below VFR where the flight meets them, in the Brief.
struct FieldsBelowVfrSection: View {
    let fields: [FieldBelowVfr]

    var body: some View {
        if !fields.isEmpty {
            Section("Fields below VFR") {
                ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(field.ident) · \(field.source == "METAR" ? "\(field.flightCategory ?? "IFR") now" : "forecast then")").font(.headline)
                        Text([field.ceilingFt.map { "\(Int($0).formatted()) ft" } ?? "no ceiling",
                              field.visibilitySm.map { String(format: "%g sm", $0) } ?? "—"].joined(separator: " · "))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    OnRouteRow(on: field.onRoute, key: "field-\(field.ident)-\(field.source)")
                }
            }
        }
    }
}

/// When the data under each of the map's weather layers is from, in
/// Setup's Map section: the METARs behind the fields' colours and the
/// TFRs as the planner fetched them (/api/map/ages), the traffic as the
/// map last heard it. Asked and said again each minute.
struct LayerAgesRows: View {
    @Environment(Traffic.self) private var traffic
    @State private var ages: MapLayerAges?
    @State private var now = Date()

    var body: some View {
        Group {
            LabeledContent("METARs", value: words("aviationweather.gov", BriefLegs.date(ages?.metarsAt)))
            LabeledContent("TFRs", value: words("tfr.faa.gov", BriefLegs.date(ages?.tfrsAt)))
            if traffic.on {
                LabeledContent("Traffic data", value: words("adsb.lol", traffic.heardAt))
            }
        }
        .task {
            while !Task.isCancelled {
                if let fresh = try? await Planner.mapAges() { ages = fresh }
                now = Date()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    private func words(_ source: String, _ at: Date?) -> String {
        BriefLegs.age(at, now: now).map { "\(source) · \($0)" } ?? source
    }
}

/// The legs a hazard tapped in the Brief is on, drawn wide in amber with
/// the course, told from it by its class.
final class HazardPolyline: MKPolyline {}

extension ChartMap.Coordinator {
    /// The legs shown as `legs` says, brought into view clear of the
    /// sheet when they change; put away with nil.
    @MainActor
    func showHazardLegs(_ legs: HazardLegs?, on map: MKMapView) {
        guard hazardShown != legs else { return }
        hazardShown = legs
        map.removeOverlays(hazardLines)
        hazardLines = (legs?.lines ?? []).filter { $0.count >= 2 }.map { HazardPolyline(coordinates: $0, count: $0.count) }
        for line in hazardLines {
            if let course = courseLine { map.insertOverlay(line, below: course) } else { map.addOverlay(line, level: .aboveLabels) }
        }
        if let first = hazardLines.first {
            let rect = hazardLines.dropFirst().reduce(first.boundingMapRect) { $0.union($1.boundingMapRect) }
            map.setVisibleMapRect(rect, edgePadding: ChartMap.routePadding(in: map), animated: true)
        }
    }
}
