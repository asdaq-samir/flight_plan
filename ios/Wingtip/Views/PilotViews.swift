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
