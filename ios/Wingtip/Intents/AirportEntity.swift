import AppIntents

/// A field as Siri takes one in a phrase: "Plan a trip to KLAS in Wingtip
/// Maps" in one breath, where free text had Siri ask "Where to?" after
/// the phrase (a phrase carries only an entity or an enum). The entity is
/// the field's ident, named for Siri by its name and its town as well
/// (the synonyms), so "KLAS", "Harry Reid" and "Las Vegas" all find it.
/// Siri listens for the fields `suggestedEntities` offers -- the kept
/// route's, the Favorites and the Recents -- and asks for any other,
/// which `AirportEntityQuery` then finds on the planner as the microphone's
/// "plan a trip to Las Vegas" does (IntentLookups.field).
struct AirportEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Airport"
    static let defaultQuery = AirportEntityQuery()

    /// The ident as pilots write it: KLAS, 3CK.
    let id: String
    let name: String
    let city: String?

    init(id: String, name: String, city: String? = nil) {
        self.id = id.uppercased()
        self.name = name
        self.city = city
    }

    init(_ place: AirportPlace) {
        self.init(id: place.ident, name: place.name, city: place.municipality)
    }

    init(_ found: AirportSuggestion) {
        self.init(id: found.ident, name: found.name, city: found.municipality)
    }

    init(_ kept: KeptAirport) {
        self.init(id: kept.ident, name: kept.name, city: kept.municipality)
    }

    /// The ident as the title, the name and town under it, as the route
    /// box's suggestions read; the name and the town are what else Siri
    /// may hear for it.
    var displayRepresentation: DisplayRepresentation {
        let under = [name, city].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        var heard: [LocalizedStringResource] = []
        if !name.isEmpty { heard.append("\(name)") }
        if let city, !city.isEmpty { heard.append("\(city)") }
        return DisplayRepresentation(
            title: "\(id)",
            subtitle: under.isEmpty ? nil : "\(under)",
            image: .init(systemName: "airplane"),
            synonyms: heard
        )
    }
}

/// How Siri and Shortcuts find a field: by its ident, by what was typed
/// or said, and the few offered without asking. Not `AirportQuery`: that
/// is the iPad sidebar's search text (SplitLayout).
struct AirportEntityQuery: EntityStringQuery {
    /// The fields Siri listens for in a phrase, and Shortcuts offers first:
    /// the kept route's, then the Favorites and the Recents, each once.
    /// Named from the device, so this answers with no signal.
    func suggestedEntities() async throws -> [AirportEntity] {
        var seen: Set<String> = []
        var offered: [AirportEntity] = []
        func offer(_ entity: AirportEntity) {
            guard seen.insert(entity.id).inserted else { return }
            offered.append(entity)
        }
        let kept = Kept.load()
        let shelf = await MainActor.run { (AirportShelf.shared.favorites, AirportShelf.shared.recents) }
        let named = Dictionary((shelf.0 + shelf.1).map { ($0.ident, $0) }, uniquingKeysWith: { first, _ in first })
        for ident in (kept.map { [$0.dep] + $0.stops + [$0.dest] } ?? []) where !ident.isEmpty {
            offer(named[ident.uppercased()].map { AirportEntity($0) } ?? AirportEntity(id: ident, name: ""))
        }
        for airport in shelf.0 + shelf.1 { offer(AirportEntity(airport)) }
        return offered
    }

    /// The fields by ident, as a Shortcut keeps a picked one: each from the
    /// planner, or from the device where the planner cannot be reached and
    /// the field is one it knows.
    func entities(for identifiers: [String]) async throws -> [AirportEntity] {
        var found: [AirportEntity] = []
        for ident in identifiers {
            if let place = try? await Planner.place(ident) {
                found.append(AirportEntity(place))
            } else if let offered = (try? await suggestedEntities())?.first(where: { $0.id == ident.uppercased() }) {
                found.append(offered)
            }
        }
        return found
    }

    /// The fields what was said or typed means: an ident, a field's name
    /// (the planner's search, as the route box suggests), or a town or an
    /// address, for which the biggest field by it is the one answer
    /// (IntentLookups.field, the microphone's own lookup).
    func entities(matching string: String) async throws -> [AirportEntity] {
        let said = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !said.isEmpty else { return [] }
        let found = try await Planner.search(said).prefix(10).map { AirportEntity($0) }
        if !found.isEmpty { return found }
        guard let ident = try await IntentLookups.field(for: said) else { return [] }
        return [AirportEntity(try await Planner.place(ident))]
    }
}
