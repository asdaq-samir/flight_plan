package app.wingtipmaps.android.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

// The planner's and the gateway's calls a flight under way makes, as
// extensions of Planner and Gateway (Planner.kt and Gateway.kt are
// phase 0's; these are the flight pieces', beside them): what is ahead,
// the traffic about a point, a tracked airplane's state, and a saved
// flight's track. Each as the iOS app's Planner.swift and
// FlightExtras.swift have them.

@Serializable
private class AheadAnswer(val alerts: List<AheadAlert>)

/** What the airplane's track runs into in the next minutes
 *  (/api/airspace/ahead): the planner's alerts, in its words. Waits no
 *  longer than IN_FLIGHT_MS, so OwnShip falls back to the packs. */
suspend fun Planner.ahead(lat: Double, lon: Double, trackDeg: Double, groundspeedKt: Double, altitudeFt: Double?): List<AheadAlert> {
    val query = mapOf(
        "lat" to lat.toString(), "lon" to lon.toString(),
        "track" to Math.round(trackDeg).toString(), "gs" to Math.round(groundspeedKt).toString(),
        "alt" to altitudeFt?.let { Math.round(it).toString() },
    )
    return Gateway.json.decodeFromString<AheadAnswer>(fetch("/api/airspace/ahead", query, timeoutMs = IN_FLIGHT_MS)).alerts
}

/** The airplanes heard about a point (/api/traffic), out to a radius in nm. */
suspend fun Planner.traffic(lat: Double, lon: Double, radiusNm: Double): TrafficAnswer =
    Gateway.json.decodeFromString(
        fetch("/api/traffic", mapOf("lat" to lat.toString(), "lon" to lon.toString(), "radius" to Math.round(radiusNm).toString())),
    )

/** A tracked airplane's state now (/api/traffic/flight/{hex}/status). */
suspend fun Planner.flightStatus(hex: String): FlightStatus =
    Gateway.json.decodeFromString(fetch("/api/traffic/flight/$hex/status"))

/** The flown track kept with a saved flight (PUT /api/flights/{id}/track):
 *  own ship's path (OwnTrail.asSavedTrack) once the flight is saved. */
suspend fun Gateway.saveTrack(flight: Long, track: SavedTrack) {
    send("PUT", "/api/flights/$flight/track", json = json.encodeToString(track))
}

/** A saved flight's track, or null where it has none (204, 404). */
suspend fun Gateway.track(flight: Long): SavedTrack? = read("/api/flights/$flight/track", none = setOf(204, 404))
