import SwiftUI

/// Aircraft: the airplane by its N-number, the owner's rule ("airplane
/// should only be picked by n-number"): one of the pilot's own, with the
/// figures they set, or any N-number typed, looked up in the FAA's
/// registry for its type and flown on the planner's figures for it. The
/// types the planner has figures for are listed under them.
struct AircraftView: View {
    @Environment(Plan.self) private var plan
    @Environment(Session.self) private var session
    @State private var profiles: [AircraftProfile] = []
    @State private var own: [OwnAircraftRecord] = []
    @State private var typed = ""
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            List {
                // Any airplane in the air, by its callsign, N-number or
                // address: its card, tracked on the map.
                Section {
                    NavigationLink { TrafficFindView() } label: { Label("Find an Airplane", systemImage: "magnifyingglass") }
                }
                Section("Airplane") {
                    HStack {
                        TextField("N-number", text: $typed)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .font(.body.monospaced())
                            .onSubmit(fly)
                        Button("Fly") { fly() }
                            .buttonStyle(.borderedProminent)
                            .disabled(!Registered.isNNumber(typed.uppercased()))
                    }
                    if let tail = plan.tail {
                        LabeledContent("Flying", value: "\(tail) on \(plan.aircraft.uppercased())\(plan.figures.cruiseTasKt == nil ? "" : ", your figures")")
                        // The figures the planner flies it on, the pilot's to
                        // set from the handbook, or read off a photo of it.
                        NavigationLink("Planning figures") { AirplaneFiguresView() }
                    }
                }
                if session.signedIn || !own.isEmpty {
                    Section("Yours") {
                        ForEach(own) { airplane in
                            Button {
                                typed = airplane.tailNumber
                                fly()
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(airplane.tailNumber).font(.headline.monospaced())
                                        Text(String(format: "%@ · %.0f kt · %.1f gal/h", airplane.typeDesignator, airplane.cruiseTasKt, airplane.fuelBurnGph))
                                            .font(.footnote).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if plan.tail == airplane.tailNumber { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                            .foregroundStyle(.primary)
                        }
                        // Added, edited and deleted on their own page, with
                        // each one's checklist, squawks and inspections.
                        NavigationLink("Your Airplanes") { OwnAircraftListView() }
                    }
                }
                Section("Types the planner has figures for") {
                    if profiles.isEmpty {
                        if let problem { ProblemLine(problem) } else { ProgressView() }
                    }
                    ForEach(profiles, id: \.name) { profile in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(profile.type ?? profile.designator ?? profile.name.uppercased()).font(.headline)
                                Text(String(format: "%.0f kt · %.1f gal/h · ceiling %@ ft%@", profile.cruiseTasKt, profile.fuelBurnGph,
                                            Int(profile.serviceCeilingFt).formatted(),
                                            profile.usableFuelGal.map { String(format: " · %.0f gal usable", $0) } ?? ""))
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if profile.name == plan.aircraft { Image(systemName: "checkmark").foregroundStyle(.tint) }
                        }
                    }
                }
            }
            .navigationTitle("Aircraft")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                do { profiles = try await Planner.aircraftProfiles() } catch { problem = error.localizedDescription }
            }
            .task(id: session.signedIn) {
                own = (try? await Gateway.aircraftRecords()) ?? []
            }
            // Back from Your Airplanes with one added or changed.
            .onAppear { Task { own = (try? await Gateway.aircraftRecords()) ?? [] } }
        }
    }

    private func fly() {
        let tail = typed.uppercased().trimmingCharacters(in: .whitespaces)
        guard Registered.isNNumber(tail) else { return }
        Task { await plan.fly(tail: tail, own: own, profiles: profiles) }
    }
}
