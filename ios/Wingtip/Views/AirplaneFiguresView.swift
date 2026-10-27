import PhotosUI
import SwiftUI

/// The figures the planner flies the airplane on, for the N-number flown
/// now, each one the pilot may set from their own airplane's handbook,
/// or read off a photo of its specifications page (Handbook, on the
/// phone). Set, they are kept for the N-number on this device and flown
/// on from then on; the type's figures fill what is not set.
struct AirplaneFiguresView: View {
    @Environment(Plan.self) private var plan
    @State private var fields: [String: String] = [:]
    @State private var picked: PhotosPickerItem?
    @State private var reading = false
    @State private var words: [String] = []
    @State private var problem: String?

    private static let rows: [(key: String, label: String, unit: String, min: Double, max: Double)] = [
        ("cruiseTasKt", "Cruise speed (TAS)", "kt", 30, 400),
        ("cruisePowerPct", "At power", "%", 40, 100),
        ("fuelBurnGph", "Fuel burn", "gal/h", 1, 100),
        ("usableFuelGal", "Usable fuel", "gal", 5, 500),
        ("climbTasKt", "Climb speed (TAS)", "kt", 30, 300),
        ("climbFuelBurnGph", "Climb fuel burn", "gal/h", 1, 150),
        ("serviceCeilingFt", "Service ceiling", "ft", 1000, 30000),
    ]

    var body: some View {
        Form {
            Section {
                ForEach(Self.rows, id: \.key) { row in
                    LabeledContent(row.label) {
                        HStack(spacing: 6) {
                            TextField("—", text: Binding(get: { fields[row.key] ?? "" }, set: { fields[row.key] = $0.filter { $0.isNumber || $0 == "." } }))
                                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 80)
                            Text(row.unit).foregroundStyle(.secondary).frame(width: 44, alignment: .leading)
                        }
                    }
                }
            } header: {
                Text(plan.tail.map { "Planning figures for \($0)" } ?? "Planning figures")
            } footer: {
                if !words.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Read from the page: check each against it before saving.").bold()
                        ForEach(words, id: \.self) { Text($0) }
                    }
                }
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            Section {
                PhotosPicker(selection: $picked, matching: .images) {
                    Label(reading ? "Reading the page…" : "Read from a photo", systemImage: "camera")
                }
                .disabled(reading)
                Button("Save") { save() }
                Button("Use the type's figures", role: .destructive) { fields = [:]; plan.figures = Figures(); TailFigures.forget(plan.tail) }
            }
        }
        .navigationTitle("Figures")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { fields = TailFigures.load(plan.tail).fields }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            reading = true; problem = nil; words = []
            Task {
                defer { reading = false; picked = nil }
                guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                    problem = "That photo could not be opened."; return
                }
                do {
                    let found = Handbook.figures(of: try await Handbook.read(image))
                    if found.isEmpty { problem = "No figures were read off that page: take the specifications page, flat and in good light."; return }
                    if let f = found.cruiseTasKt { fields["cruiseTasKt"] = Self.text(f.value) }
                    if let f = found.cruisePowerPct { fields["cruisePowerPct"] = Self.text(f.value) }
                    if let f = found.fuelBurnGph { fields["fuelBurnGph"] = Self.text(f.value) }
                    if let f = found.usableFuelGal { fields["usableFuelGal"] = Self.text(f.value) }
                    if let f = found.climbTasKt { fields["climbTasKt"] = Self.text(f.value) }
                    if let f = found.serviceCeilingFt { fields["serviceCeilingFt"] = Self.text(f.value) }
                    words = Array(Set(found.words)).sorted()
                } catch {
                    problem = "The page could not be read: \(error.localizedDescription)"
                }
            }
        }
    }

    private static func text(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }

    private func save() {
        var figures = Figures()
        for row in Self.rows {
            guard let text = fields[row.key], let n = Double(text), n >= row.min, n <= row.max else { continue }
            switch row.key {
            case "cruiseTasKt": figures.cruiseTasKt = n
            case "cruisePowerPct": figures.cruisePowerPct = n
            case "fuelBurnGph": figures.fuelBurnGph = n
            case "usableFuelGal": figures.usableFuelGal = n
            case "climbTasKt": figures.climbTasKt = n
            case "climbFuelBurnGph": figures.climbFuelBurnGph = n
            case "serviceCeilingFt": figures.serviceCeilingFt = n
            default: break
            }
        }
        plan.figures = figures
        TailFigures.save(figures, for: plan.tail)
        if plan.routed { plan.plan() }
    }
}

/// The figures kept per N-number on this device (the web app's
/// preferences' tailFigures), as text fields.
enum TailFigures {
    /// Each N-number's key, under one prefix that signing out clears.
    static let prefix = "figures:"
    private static func key(_ tail: String?) -> String { prefix + (tail ?? "type") }

    static func save(_ figures: Figures, for tail: String?) {
        UserDefaults.standard.setEncoded(figures, forKey: key(tail))
    }

    static func load(_ tail: String?) -> Figures {
        UserDefaults.standard.decoded(Figures.self, forKey: key(tail)) ?? Figures()
    }

    static func forget(_ tail: String?) { UserDefaults.standard.removeObject(forKey: key(tail)) }
}

extension Figures {
    /// The figures as the form's text.
    var fields: [String: String] {
        var out: [String: String] = [:]
        let pairs: [(String, Double?)] = [
            ("cruiseTasKt", cruiseTasKt), ("cruisePowerPct", cruisePowerPct), ("fuelBurnGph", fuelBurnGph), ("usableFuelGal", usableFuelGal),
            ("climbTasKt", climbTasKt), ("climbFuelBurnGph", climbFuelBurnGph), ("serviceCeilingFt", serviceCeilingFt),
        ]
        for (k, v) in pairs { if let v { out[k] = v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) } }
        return out
    }
}
