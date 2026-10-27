import SwiftUI

/// The Brief: the planner's briefing for the route in a flight service
/// briefer's order (AIM 7-1-5), each report as sent. "VFR flight not
/// recommended" first where the planner says so; then the hazards
/// (SIGMETs), the G-AIRMETs, the TFRs on the way, the PIREPs, the
/// forecast's lowest ceiling and visibility, and each station's METAR.
/// The Go / No-Go over it all is the planner's (POST /api/go-no-go, the
/// web app's lib/verdict on the planner), so no judgment is made on the
/// phone: each finding opens where the Brief says it.
struct BriefView: View {
    @Environment(Plan.self) private var plan
    @Environment(Verdict.self) private var verdict
    @Environment(Session.self) private var session

    /// The first of the weather's parts the Brief has, where the weather's
    /// finding opens: VFR not recommended, the hazards, the G-AIRMETs, else
    /// the forecast.
    private func weatherPart(_ briefing: Briefing) -> String {
        if !(briefing.vfrNotRecommended ?? []).isEmpty { return "vnr" }
        if !briefing.hazards.isEmpty { return "hazards" }
        if !(briefing.gairmets ?? []).isEmpty { return "gairmets" }
        return "forecast"
    }

    /// A row's id: the anchor a finding scrolls to on the first row of its
    /// part, else one of the row's own.
    private func rowId(_ part: String, _ index: Int, anchorAt: String, anchor: String) -> String {
        part == anchorAt && index == 0 ? anchor : "\(part)-\(index)"
    }

    var body: some View {
        ScrollViewReader { reader in
            List {
                if plan.routed {
                    GoNoGoSection { anchor in withAnimation { reader.scrollTo(anchor, anchor: .top) } }
                }
                if let briefing = plan.briefing {
                    let weatherAt = weatherPart(briefing)
                    if let notRecommended = briefing.vfrNotRecommended, !notRecommended.isEmpty {
                        Section {
                            ForEach(Array(notRecommended.enumerated()), id: \.offset) { i, reason in
                                Label(reason, systemImage: "xmark.octagon.fill").foregroundStyle(.red)
                                    .id(rowId("vnr", i, anchorAt: weatherAt, anchor: VerdictTarget.weatherAnchor))
                            }
                        } header: { Text("VFR flight not recommended") }
                    }
                    if !briefing.weatherUnavailable.isEmpty {
                        Section("Not available") {
                            ForEach(briefing.weatherUnavailable, id: \.self) { Text($0).foregroundStyle(.secondary) }
                        }
                    }
                    if !briefing.hazards.isEmpty {
                        Section("Hazards") {
                            ForEach(Array(briefing.hazards.enumerated()), id: \.offset) { i, hazard in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text([hazard.type, hazard.hazard].compactMap { $0 }.joined(separator: " · ")).font(.headline)
                                    if let low = hazard.altitudeLowFt, let high = hazard.altitudeHighFt {
                                        Text("\(Int(low).formatted()) to \(Int(high).formatted()) ft").font(.footnote).foregroundStyle(.secondary)
                                    }
                                    if let raw = hazard.raw { Text(raw).font(.footnote.monospaced()).foregroundStyle(.secondary) }
                                }
                                .id(rowId("hazards", i, anchorAt: weatherAt, anchor: VerdictTarget.weatherAnchor))
                                // Its legs and when the airplane is there; a tap shows them.
                                OnRouteRow(on: hazard.onRoute, key: "sigmet-\(i)-\(hazard.raw ?? "")")
                            }
                        }
                    }
                    if let gairmets = briefing.gairmets, !gairmets.isEmpty {
                        Section("G-AIRMETs") {
                            ForEach(Array(gairmets.enumerated()), id: \.offset) { i, g in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text([g.hazard, g.severity].compactMap { $0 }.joined(separator: " · ")).font(.headline)
                                    HStack(spacing: 8) {
                                        if let low = g.altitudeLowFt, let high = g.altitudeHighFt { Text("\(Int(low).formatted()) to \(Int(high).formatted()) ft") }
                                        if let due = g.dueTo { Text(due) }
                                        if let at = g.validAt { Text(at) }
                                    }
                                    .font(.footnote).foregroundStyle(.secondary)
                                }
                                .id(rowId("gairmets", i, anchorAt: weatherAt, anchor: VerdictTarget.weatherAnchor))
                                OnRouteRow(on: g.onRoute, key: "gairmet-\(g.hazard)")
                            }
                        }
                    }
                    if let tfrs = briefing.tfrs, !tfrs.isEmpty {
                        Section("TFRs on the way") {
                            ForEach(Array(tfrs.enumerated()), id: \.offset) { i, tfr in
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack {
                                        Text(tfr.title ?? tfr.notamId).font(.headline)
                                        if tfr.crosses { Text("crosses").foregroundStyle(.red).font(.footnote.weight(.semibold)) }
                                        if tfr.activeNow { Text("active now").foregroundStyle(.red).font(.footnote.weight(.semibold)) }
                                    }
                                    HStack(spacing: 8) {
                                        Text(String(format: "%.0f nm along", tfr.alongTrackNm))
                                        if let floor = tfr.floorFt, let ceiling = tfr.ceilingFt { Text("\(Int(floor).formatted()) to \(Int(ceiling).formatted()) ft") }
                                        if let effective = tfr.effective { Text("from \(effective)") }
                                    }
                                    .font(.footnote).foregroundStyle(.secondary)
                                }
                                .id(rowId("tfrs", i, anchorAt: "tfrs", anchor: VerdictTarget.airspaceAnchor))
                                OnRouteRow(on: tfr.onRoute, key: "tfr-\(tfr.notamId)")
                            }
                        }
                    }
                    if let pireps = briefing.pireps, !pireps.isEmpty {
                        Section("Pilot reports") {
                            ForEach(Array(pireps.enumerated()), id: \.offset) { i, p in
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 8) {
                                        Text(String(format: "%.0f nm along", p.alongTrackNm)).font(.headline)
                                        if let turbulence = p.turbulence { Text("turbulence \(turbulence)") }
                                        if let icing = p.icing { Text("icing \(icing)") }
                                        if p.urgent == true { Text("URGENT").foregroundStyle(.red).bold() }
                                    }
                                    if let raw = p.raw { Text(raw).font(.footnote.monospaced()).foregroundStyle(.secondary) }
                                }
                                OnRouteRow(on: p.onRoute, key: "pirep-\(i)-\(p.raw ?? "")")
                            }
                        }
                    }
                    FieldsBelowVfrSection(fields: briefing.fieldsBelowVfr ?? [])
                    if let forecast = briefing.forecast {
                        Section("Forecast along the route") {
                            LabeledContent("Lowest ceiling", value: forecast.minCeilingFt.map { "\(Int($0).formatted()) ft" } ?? "—")
                                .id(rowId("forecast", 0, anchorAt: weatherAt, anchor: VerdictTarget.weatherAnchor))
                            LabeledContent("Lowest visibility", value: forecast.minVisibilitySm.map { String(format: "%g SM", $0) } ?? "—")
                            ForEach(Array(forecast.stations.enumerated()), id: \.offset) { _, station in
                                if let raw = station.raw {
                                    VStack(alignment: .leading, spacing: 2) {
                                        if let ident = station.ident { Text(ident).font(.headline) }
                                        Text(raw).font(.footnote.monospaced()).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    let stations = briefing.metars.keys.sorted()
                    if !stations.isEmpty {
                        Section("METARs") {
                            ForEach(stations, id: \.self) { ident in
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack {
                                        Text(ident).font(.headline)
                                        if let category = briefing.metars[ident]??.flightCategory { Text(category).font(.footnote.weight(.semibold)).foregroundStyle(.secondary) }
                                    }
                                    if let raw = briefing.metars[ident]??.raw {
                                        Text(raw).font(.footnote.monospaced()).foregroundStyle(.secondary)
                                    } else {
                                        Text("No report").font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                } else if let problem = plan.briefingProblem {
                    ContentUnavailableView("No briefing", systemImage: "exclamationmark.triangle", description: Text(problem))
                } else {
                    ProgressView("Fetching the briefing…")
                }
            }
        }
        .navigationTitle("Brief")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if plan.briefing == nil, plan.routed {
                await plan.brief(dep: plan.dep, dest: plan.dest, stops: plan.stops, eteMin: plan.totals?.eteMin)
            }
        }
        // Asked again whenever the plan or what the pilot set changes.
        .task(id: verdict.key(for: plan)) { await verdict.refresh(plan: plan, signedIn: session.signedIn) }
    }
}
