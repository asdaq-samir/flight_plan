import SwiftUI

/// The pilot's saved flights: each a tap back onto the page, a swipe
/// away, and the plan on the page saved with the button at the top.
struct FlightsView: View {
    @Environment(Plan.self) private var plan
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var flights: [SavedFlight] = []
    @State private var problem: String?
    @State private var saving = false

    var body: some View {
        List {
            if !session.signedIn {
                ContentUnavailableView("Sign in to save flights", systemImage: "person.crop.circle", description: Text("Your flights are kept with your account, on every device."))
            } else if flights.isEmpty {
                ContentUnavailableView("No saved flights", systemImage: "tray", description: Text("Save the plan on the page with the button above."))
            }
            ForEach(flights) { flight in
                Button {
                    plan.open(flight)
                    dismiss()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(([flight.departureIdent] + flight.stops + [flight.destinationIdent]).joined(separator: " → ")).font(.headline.monospaced())
                        HStack(spacing: 10) {
                            if let nm = flight.totalDistanceNm { Text(String(format: "%.0f nm", nm)) }
                            if let min = flight.totalEteMin { Text(hoursMinutes(min)) }
                            if let gal = flight.totalFuelGal { Text(String(format: "%.1f gal", gal)) }
                            if let tail = flight.aircraftTailNumber { Text(tail) }
                        }
                        .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .foregroundStyle(.primary)
                // Its flown track: the profile, on the map, from a GPX file.
                .contextMenu {
                    Button {
                        FlightUI.shared.card = .flown(flight.id, ([flight.departureIdent] + flight.stops + [flight.destinationIdent]).joined(separator: " → "))
                    } label: { Label("Flown Track", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                }
            }
            .onDelete { at in
                let gone = at.map { flights[$0] }
                flights.remove(atOffsets: at)
                Task { for flight in gone { try? await Gateway.deleteFlight(flight.id) } }
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("Flights")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(saving ? "Saving…" : "Save This Plan") {
                    guard let request = plan.saved() else { return }
                    saving = true
                    Task {
                        do { try await Gateway.save(request); flights = try await Gateway.flights(); problem = nil }
                        catch { problem = error.localizedDescription }
                        saving = false
                    }
                }
                .disabled(saving || !session.signedIn || plan.totals == nil)
            }
        }
        .task(id: session.signedIn) {
            do { flights = try await Gateway.flights() } catch { problem = error.localizedDescription }
        }
    }
}

/// The logbook and the gateway's currency, as given: the dates each
/// window runs to (14 CFR 61.57, 61.56, 61.23, worked out there).
struct LogbookView: View {
    @Environment(Session.self) private var session
    @State private var entries: [LogbookEntry] = []
    @State private var currency: Currency?
    @State private var problem: String?

    var body: some View {
        List {
            if !session.signedIn {
                ContentUnavailableView("Sign in for your logbook", systemImage: "book.closed", description: Text("Your logbook and currency are kept with your account."))
            }
            if let currency {
                Section("Currency") {
                    LabeledContent("Total time", value: String(format: "%.1f h", currency.totalHours))
                    LabeledContent("Night", value: String(format: "%.1f h", currency.nightHours))
                    LabeledContent("Cross-country", value: String(format: "%.1f h", currency.crossCountryHours))
                    LabeledContent("Passengers by day until", value: currency.dayPassengersUntil ?? "not current")
                    LabeledContent("Passengers at night until", value: currency.nightPassengersUntil ?? "not current")
                    LabeledContent("Instrument until", value: currency.instrumentCurrentUntil ?? "not current")
                    LabeledContent("Flight review until", value: currency.flightReviewUntil ?? "—")
                    LabeledContent("Medical expires", value: currency.medicalExpiresOn ?? "—")
                }
            }
            Section("Entries") {
                if entries.isEmpty, session.signedIn { Text("No entries yet.").foregroundStyle(.secondary) }
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(entry.flownOn).font(.headline)
                            Spacer()
                            Text(String(format: "%.1f h", entry.totalHours)).font(.subheadline.monospacedDigit())
                        }
                        Text([entry.route, entry.aircraft, entry.aircraftType].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                        if let remarks = entry.remarks, !remarks.isEmpty { Text(remarks).font(.footnote) }
                    }
                }
            }
            if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
        }
        .navigationTitle("Logbook")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: session.signedIn) {
            do {
                entries = try await Gateway.logbook()
                currency = try await Gateway.currency()
            } catch { problem = error.localizedDescription }
        }
    }
}
