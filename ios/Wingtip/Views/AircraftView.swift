import SwiftUI

/// Aircraft: the planner's airplane types, one picked for the flight, with
/// the handbook figures it flies on. The pilot's own airplane by its
/// N-number and its own figures come in phase 3; until then the type's.
struct AircraftView: View {
    @Environment(Plan.self) private var plan
    @State private var profiles: [AircraftProfile] = []
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            List {
                if profiles.isEmpty {
                    if let problem {
                        ContentUnavailableView("No airplanes", systemImage: "airplane", description: Text(problem))
                    } else {
                        ProgressView("Fetching the airplanes…")
                    }
                } else {
                    Section("Type") {
                        ForEach(profiles, id: \.name) { profile in
                            Button {
                                plan.aircraft = profile.name
                                if plan.routed { plan.plan() }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(profile.type ?? profile.designator ?? profile.name.uppercased()).font(.headline)
                                        Text(String(format: "%.0f kt · %.1f gal/h · ceiling %@ ft%@", profile.cruiseTasKt, profile.fuelBurnGph,
                                                    Int(profile.serviceCeilingFt).formatted(),
                                                    profile.usableFuelGal.map { String(format: " · %.0f gal usable", $0) } ?? ""))
                                            .font(.footnote).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if profile.name == plan.aircraft {
                                        Image(systemName: "checkmark").foregroundStyle(.tint)
                                    }
                                }
                            }
                            .foregroundStyle(.primary)
                        }
                    }
                }
            }
            .navigationTitle("Aircraft")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                do { profiles = try await Planner.aircraftProfiles() } catch { problem = error.localizedDescription }
            }
        }
    }
}
