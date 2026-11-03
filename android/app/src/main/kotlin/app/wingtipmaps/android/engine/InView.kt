package app.wingtipmaps.android.engine

import app.wingtipmaps.android.api.AirportPin
import app.wingtipmaps.android.api.Gateway
import java.nio.ByteBuffer
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString

// What the map draws, from the packs kept on the phone (the engine's view
// module through Packs.airspaceInView, airportsInView and navaidsInView):
// the planner's own answers for /api/airspace/in-view,
// /api/airports/in-view and /api/navaids/in-view, worked out on the phone
// from the regions the pilot keeps, so a pan in flight with no signal
// still has its fields, rings and VORs. The twin of the iOS app's
// InView.swift. A field's live flight category is the planner's alone:
// null here. The map asks here first and the planner second (the iOS
// app's PackMapData); a region never kept, or no index yet, is null, and
// the planner's answer is then the one source.

/** The packs of every region the box touches, mapped for one call; null
 *  where none of them was ever kept. */
private fun CyclePacks.packsInBox(south: Double, west: Double, north: Double, east: Double): Array<ByteBuffer>? {
    if (index == null) return null
    // The regions are 4-degree squares (Engine.regionOf): every 2 degrees
    // across the box and its far edges names each one the box touches.
    val names = HashSet<String>()
    var lat = south
    while (lat <= north + 2) {
        var lon = west
        while (lon <= east + 2) {
            names += Engine.regionOf(minOf(lat, north), minOf(lon, east))
            lon += 2
        }
        lat += 2
    }
    val packs = packs(names)
    return if (packs.isEmpty()) null else packs
}

@Serializable
private class AirportsAnswer(val airports: List<AirportPin>)

/** The fields in the box (AirportsInView), biggest first; null with no pack. */
fun CyclePacks.airportsInView(south: Double, west: Double, north: Double, east: Double): List<AirportPin>? {
    val packs = packsInBox(south, west, north, east) ?: return null
    val json = Packs.airportsInView(packs, south, west, north, east) ?: return null
    return runCatching { Gateway.json.decodeFromString<AirportsAnswer>(json) }.getOrNull()?.airports
}

/** The Class B, C, D and surface E volumes in the box with their rings
 *  (AirspaceInView), as JSON text for the map's own decoder; null with no pack. */
fun CyclePacks.airspaceInView(south: Double, west: Double, north: Double, east: Double): String? {
    val packs = packsInBox(south, west, north, east) ?: return null
    return Packs.airspaceInView(packs, south, west, north, east)
}

/** The VORs in the box (NavaidsInView's vors), as JSON text; null with no pack. */
fun CyclePacks.navaidsInView(south: Double, west: Double, north: Double, east: Double): String? {
    val packs = packsInBox(south, west, north, east) ?: return null
    return Packs.navaidsInView(packs, south, west, north, east)
}
