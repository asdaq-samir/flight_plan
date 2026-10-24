import SwiftUI

/// The Brief: the planner's briefing for the route in a flight service
/// briefer's order (AIM 7-1-5), each report as sent. "VFR flight not
/// recommended" first where the planner says so; then the hazards
/// (SIGMETs), the G-AIRMETs, the TFRs on the way, the PIREPs, the
/// forecast's lowest ceiling and visibility, and each station's METAR.
/// The Go / No-Go line the web app works out (lib/verdict) is not
/// computed here: it moves to the planner first, so no judgment is made
/// on the phone.
struct BriefView: View {
    @Environment(Plan.self) private var plan

    var body: some View {
        List {
            if let briefing = plan.briefing {
                if let notRecommended = briefing.vfrNotRecommended, !notRecommended.isEmpty {
                    Section {
                        ForEach(notRecommended, id: \.self) { reason in
                            Label(reason, systemImage: "xmark.octagon.fill").foregroundStyle(.red)
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
                        ForEach(Array(briefing.hazards.enumerated()), id: \.offset) { _, hazard in
                            VStack(alignment: .leading, spacing: 2) {
                                Text([hazard.type, hazard.hazard].compactMap { $0 }.joined(separator: " · ")).font(.headline)
                                if let low = hazard.altitudeLowFt, let high = hazard.altitudeHighFt {
                                    Text("\(Int(low).formatted()) to \(Int(high).formatted()) ft").font(.footnote).foregroundStyle(.secondary)
                                }
                                if let raw = hazard.raw { Text(raw).font(.footnote.monospaced()).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                if let gairmets = briefing.gairmets, !gairmets.isEmpty {
                    Section("G-AIRMETs") {
                        ForEach(Array(gairmets.enumerated()), id: \.offset) { _, g in
                            VStack(alignment: .leading, spacing: 2) {
                                Text([g.hazard, g.severity].compactMap { $0 }.joined(separator: " · ")).font(.headline)
                                HStack(spacing: 8) {
                                    if let low = g.altitudeLowFt, let high = g.altitudeHighFt { Text("\(Int(low).formatted()) to \(Int(high).formatted()) ft") }
                                    if let due = g.dueTo { Text(due) }
                                    if let at = g.validAt { Text(at) }
                                }
                                .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if let tfrs = briefing.tfrs, !tfrs.isEmpty {
                    Section("TFRs on the way") {
                        ForEach(tfrs) { tfr in
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
                        }
                    }
                }
                if let pireps = briefing.pireps, !pireps.isEmpty {
                    Section("Pilot reports") {
                        ForEach(Array(pireps.enumerated()), id: \.offset) { _, p in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 8) {
                                    Text(String(format: "%.0f nm along", p.alongTrackNm)).font(.headline)
                                    if let turbulence = p.turbulence { Text("turbulence \(turbulence)") }
                                    if let icing = p.icing { Text("icing \(icing)") }
                                    if p.urgent == true { Text("URGENT").foregroundStyle(.red).bold() }
                                }
                                if let raw = p.raw { Text(raw).font(.footnote.monospaced()).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                if let forecast = briefing.forecast {
                    Section("Forecast along the route") {
                        LabeledContent("Lowest ceiling", value: forecast.minCeilingFt.map { "\(Int($0).formatted()) ft" } ?? "—")
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
        .navigationTitle("Brief")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if plan.briefing == nil, plan.routed {
                await plan.brief(dep: plan.dep, dest: plan.dest, stops: plan.stops, eteMin: plan.totals?.eteMin)
            }
        }
    }
}
