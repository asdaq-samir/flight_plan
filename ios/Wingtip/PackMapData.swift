import Foundation

/// What the map draws, from the phone's own cycle packs where the engine
/// can answer from them and from the planner otherwise. The packs hold
/// the airports, navaids and airspace of the regions the pilot keeps
/// (wingtip.pack's write_phone; the engine's phone module), and the engine's
/// in-view rules read them with no network, as the airspace at a point
/// is read today. Asked first, so a pan in flight with no signal still
/// has its fields; the planner's answer is the fallback, and the one
/// source for a region with no pack. The engine's answers are the
/// planner's own shapes (snake case, AirportsInView and the rest), so one
/// decoder serves both. The owner's ask, 2026-11-03: the map's data from
/// the packs, for speed in flight and for the air with no signal.
enum PackMapData {
    /// The fields in the box: the packs' (pack_airports_in_view), else the
    /// planner's /api/airports/in-view.
    static func airports(south: Double, west: Double, north: Double, east: Double) async throws -> [AirportPin] {
        // The packs first, through the engine's C reader (CyclePacks.airportsInView,
        // wt_airports_in_view): a region never kept, or no index yet, is nil.
        if let kept = CyclePacks.shared.airportsInView(south: south, west: west, north: north, east: east) {
            return kept
        }
        return try await Planner.airports(south: south, west: west, north: north, east: east)
    }
}
