package app.wingtipmaps.android.flight

import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * The two figures of the sphere the flight pieces need between fixes,
 * worked here rather than through the engine: a fix comes every second
 * (OwnShip), and a call into the engine per fix for one distance is
 * waste. The same great-circle arithmetic as the engine's geo and the
 * iOS app's OwnTrail.distanceNm; no rule lives here.
 */
object Geo {
    private const val RAD = Math.PI / 180
    /** The Earth's radius in nm (the FAA's 6,371 km, 3,440.065 nm). */
    private const val EARTH_NM = 3440.065

    /** The great-circle distance between two points, nm. */
    fun nm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val la1 = lat1 * RAD
        val la2 = lat2 * RAD
        val dLon = (lon2 - lon1) * RAD
        val x = sin(la1) * sin(la2) + cos(la1) * cos(la2) * cos(dLon)
        return acos(x.coerceIn(-1.0, 1.0)) * EARTH_NM
    }

    /** The initial true bearing from one point to another, 0 to 360. */
    fun bearingDeg(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val la1 = lat1 * RAD
        val la2 = lat2 * RAD
        val dLon = (lon2 - lon1) * RAD
        val y = sin(dLon) * cos(la2)
        val x = cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dLon)
        return ((atan2(y, x) / RAD) + 360) % 360
    }

    /** The compass point of a bearing, "N", "NE" ... as the iOS app's
     *  AirportWords.compassPoint says where traffic is. */
    fun compassPoint(bearingDeg: Double): String {
        val points = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")
        return points[((bearingDeg % 360 + 360) % 360 / 45 + 0.5).toInt() % 8]
    }
}
