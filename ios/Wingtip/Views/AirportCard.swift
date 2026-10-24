import SwiftUI

/// A field's card, as the web app's PlaceCard has it: the weather first
/// (the METAR as sent, with its figures), then the runways with the wind
/// on each, the frequencies, the pattern, and the two ways into the
/// route: Fly Here and Add Stop.
struct AirportCard: View {
    let ident: String
    @Environment(Plan.self) private var plan
    @State private var place: AirportPlace?
    @State private var problem: String?

    var body: some View {
        List {
            if let place {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(place.name).font(.title3.weight(.semibold))
                        Text([place.municipality, place.region].compactMap { $0 }.joined(separator: ", ")).foregroundStyle(.secondary)
                        HStack(spacing: 12) {
                            if let elevation = place.elevationFt { Text("\(Int(elevation).formatted()) ft") }
                            Text(place.towered ? "Towered" : "Non-towered")
                            if let cls = place.airspaceClass { Text("Class \(cls)") }
                        }
                        .font(.subheadline).foregroundStyle(.secondary)
                    }
                    HStack {
                        Button { plan.dest = ident; plan.plan() } label: { Label("Fly Here", systemImage: "location.north.line") }
                            .buttonStyle(.borderedProminent)
                        Button { plan.stops.append(ident); plan.plan() } label: { Label("Add Stop", systemImage: "plus") }
                            .buttonStyle(.bordered)
                            .disabled(!plan.routed)
                    }
                }
                if let metar = place.metar {
                    Section("Weather") {
                        if let category = metar.flightCategory { LabeledContent("Flight category", value: category) }
                        if let dir = metar.windDirTrueDeg, let speed = metar.windSpeedKt {
                            LabeledContent("Wind", value: String(format: "%03.0f° at %.0f kt%@", dir, speed, metar.windGustKt.map { String(format: ", gusting %.0f", $0) } ?? ""))
                        }
                        if let vis = metar.visibilitySm { LabeledContent("Visibility", value: String(format: "%g SM", vis)) }
                        if let ceiling = metar.ceilingFt { LabeledContent("Ceiling", value: "\(Int(ceiling).formatted()) ft") }
                        if let temp = metar.tempC { LabeledContent("Temperature", value: String(format: "%.0f °C", temp)) }
                        if let alt = metar.altimeterInHg { LabeledContent("Altimeter", value: String(format: "%.2f inHg", alt)) }
                        // The report as sent, never reworded.
                        if let raw = metar.raw { Text(raw).font(.footnote.monospaced()).foregroundStyle(.secondary) }
                    }
                } else if let modelled = place.modelledWeather {
                    Section("Weather, modelled") {
                        LabeledContent("Flight category", value: modelled.flightCategory)
                        LabeledContent("Visibility", value: String(format: "%g SM", modelled.visibilitySm))
                        if let ceiling = modelled.ceilingFt { LabeledContent("Ceiling", value: "\(Int(ceiling).formatted()) ft") }
                    }
                }
                Section("Runways") {
                    ForEach(Array(place.runways.enumerated()), id: \.offset) { _, runway in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(runway.ends ?? "—").font(.headline)
                                Spacer()
                                if let length = runway.lengthFt { Text("\(length.formatted()) ft").font(.subheadline.monospacedDigit()) }
                            }
                            HStack(spacing: 10) {
                                if let surface = runway.surface { Text(surface) }
                                if runway.lighted { Text("Lighted") }
                                if runway.closed { Text("Closed").foregroundStyle(.red) }
                                if let wind = runway.wind {
                                    Text(String(format: "%@: %.0f kt head, %.0f cross", wind.end, wind.headwindKt, wind.crosswindKt))
                                }
                            }
                            .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                if !place.frequencies.isEmpty {
                    Section("Frequencies") {
                        ForEach(Array(place.frequencies.enumerated()), id: \.offset) { _, f in
                            LabeledContent(f.description ?? "—", value: f.frequencyMhz.map { String(format: "%.3f", $0) } ?? "—")
                        }
                    }
                }
                if let pattern = place.pattern, let altitude = pattern.altitudeFt {
                    Section("Pattern") {
                        LabeledContent("Pattern altitude", value: "\(Int(altitude).formatted()) ft MSL, \(Int(pattern.aglFt).formatted()) AGL\(pattern.published ? "" : " (standard)")")
                    }
                }
            } else if let problem {
                ContentUnavailableView("No card for \(ident)", systemImage: "exclamationmark.triangle", description: Text(problem))
            } else {
                ProgressView("Fetching \(ident)…")
            }
        }
        .navigationTitle(ident)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: ident) {
            do { place = try await Planner.place(ident) } catch { problem = error.localizedDescription }
        }
    }
}
