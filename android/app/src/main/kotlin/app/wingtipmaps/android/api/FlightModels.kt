package app.wingtipmaps.android.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The shapes of a flight under way -- the airplanes heard about the map,
// a tracked airplane's state, a flown path and the track a saved flight
// keeps -- as the planner and the gateway give them (Models.swift,
// FlightExtras.swift on iOS), by hand as Models.kt has the rest.

/** An airplane ADS-B receivers hear (TrafficAircraft, wingtip.traffic),
 *  generated from the planner's document (api/generated): its
 *  transponder's code, where it sends one, is said in words on its card
 *  for 7500, 7600 and 7700 (AIM 6-2-2, 6-3-4, 6-4-2). */
typealias TrafficAircraft = app.wingtipmaps.android.api.generated.TrafficAircraft

/** What it is called on the screen: its call sign, else its tail, else
 *  its ICAO address. */
val TrafficAircraft.name: String get() = callsign ?: registration ?: hex

/** The airplanes about a point (Traffic): which receivers' data, and how
 *  old the answer was when sent. */
typealias TrafficAnswer = app.wingtipmaps.android.api.generated.Traffic

/** The field a tracked airplane took off from or landed at (PastFlightField). */
@Serializable
data class PastFlightField(
    val ident: String,
    val city: String? = null,
    val name: String? = null,
    val region: String? = null,
)

/** Where and when an airplane last landed (FlightArrival). */
@Serializable
data class FlightArrival(
    val at: Double,
    val ident: String,
    val city: String? = null,
    val name: String? = null,
    val region: String? = null,
)

/** An airplane's state now, for the watches set on it (FlightStatus). */
@Serializable
data class FlightStatus(
    val hex: String,
    val airborne: Boolean? = null,
    val aircraft: TrafficAircraft? = null,
    val arrived: FlightArrival? = null,
    val departed: PastFlightField? = null,
    @SerialName("heard_s") val heardS: Double? = null,
)

/** A point of a flown path: when (s since 1970), where, how high (feet;
 *  null on the ground or where it was not sent). The iOS app's PathPoint
 *  and the web's, kept the same so a path moves between them. */
@Serializable
data class PathPoint(
    val t: Double,
    val lat: Double,
    val lon: Double,
    @SerialName("alt_ft") val altFt: Double? = null,
)

/** A saved flight's flown track as the gateway keeps it (TrackDto): t in
 *  ms since 1970, GPS altitude in feet; the gateway's JSON is camel case. */
@Serializable
data class SavedTrackPoint(
    val t: Long,
    val lat: Double,
    val lon: Double,
    val altFt: Double? = null,
)

@Serializable
data class SavedTrack(
    val points: List<SavedTrackPoint>,
    val source: String,
)
