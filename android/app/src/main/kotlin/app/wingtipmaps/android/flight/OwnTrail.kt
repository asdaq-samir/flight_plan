package app.wingtipmaps.android.flight

import android.content.Context
import app.wingtipmaps.android.api.Gateway
import app.wingtipmaps.android.api.PathPoint
import app.wingtipmaps.android.api.SavedTrack
import app.wingtipmaps.android.api.SavedTrackPoint
import app.wingtipmaps.android.engine.Engine
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

/**
 * Own ship's path flown, as ForeFlight's breadcrumbs and the web app's
 * lib/map/ownTrail: a point of the GPS every tenth of a mile or ten
 * seconds while the airplane is at flying speed (the engine's
 * `underway`), to see where it has been, and to keep as the flight's
 * track for its debrief without a GPX file. A new flight starts a new
 * path: a point more than ten minutes after the last is the first of
 * it. Kept on the phone (a file in filesDir, written at most every half
 * minute), so the app put away in the air keeps the path; at most a long
 * day's flying of it. The figures are the web's and iOS's, to keep the
 * apps' paths the same. The twin of the iOS app's OwnTrail.swift.
 *
 * Whether a speed is flying speed, and the clock, come in so a JVM test
 * holds the keep rules without the native engine.
 */
class OwnTrail(
    private val file: File,
    private val underway: (speedKt: Double?) -> Boolean = { speed -> Engine.call<Speed, Boolean>("underway", Speed(speed)) },
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    /** The `underway` rule's input: a null speed is left out, which the
     *  engine reads as not known. */
    @Serializable
    class Speed(@SerialName("speed_kt") val speedKt: Double?)

    private val _points = MutableStateFlow<List<PathPoint>>(emptyList())
    val points: StateFlow<List<PathPoint>> = _points.asStateFlow()

    /** Whether the airplane was at flying speed at the last fix. */
    var flying: Boolean = false
        private set

    /** When the file was last written; null before the first time. */
    private var lastWrittenMs: Long? = null

    init {
        // The path kept from before, unless the last point is over ten
        // minutes old: that was another flight's, and a new one starts.
        val kept = runCatching { Gateway.json.decodeFromString<List<PathPoint>>(file.readText()) }.getOrNull()
        val last = kept?.lastOrNull()
        if (kept != null && last != null && nowMs() / 1000.0 - last.t < NEW_FLIGHT_S) _points.value = kept
    }

    /** A fix taken: whether the airplane is at flying speed, by the
     *  engine's rule, and so whether the phone keeps its position with
     *  the screen off (OwnShip's service); and the point kept where it
     *  is far or late enough from the last. */
    fun took(fix: OwnShip.Fix): Boolean {
        val isFlying = underway(fix.groundspeedKt)
        flying = isFlying
        if (!isFlying) return false
        val point = PathPoint(t = fix.atMs / 1000.0, lat = fix.lat, lon = fix.lon, altFt = fix.altitudeFt)
        val had = _points.value
        val last = had.lastOrNull()
        if (last != null) {
            val sinceS = point.t - last.t
            if (sinceS < STEP_S && Geo.nm(last.lat, last.lon, point.lat, point.lon) < STEP_NM) return true
            _points.value = if (sinceS > NEW_FLIGHT_S) listOf(point) else (had + point).takeLast(MOST)
        } else {
            _points.value = listOf(point)
        }
        val written = lastWrittenMs
        if (written == null || nowMs() - written > WRITE_EVERY_MS) write()
        return true
    }

    /** The path let go: a new flight's starts empty. */
    fun clear() {
        _points.value = emptyList()
        write()
    }

    /** The path as a saved flight's track (Gateway.saveTrack), where the
     *  phone flew it: t in ms since 1970, as the gateway keeps it. */
    val asSavedTrack: SavedTrack
        get() = SavedTrack(
            points = _points.value.map { SavedTrackPoint(t = (it.t * 1000).toLong(), lat = it.lat, lon = it.lon, altFt = it.altFt) },
            source = "android",
        )

    private fun write() {
        lastWrittenMs = nowMs()
        runCatching {
            file.parentFile?.mkdirs()
            val part = File(file.path + ".part")
            part.writeText(Gateway.json.encodeToString(_points.value))
            if (!part.renameTo(file)) part.delete()
        }
    }

    companion object {
        /** A point every tenth of a mile or ten seconds, whichever first. */
        const val STEP_NM = 0.1
        const val STEP_S = 10.0
        /** A point this long after the last starts a new flight. */
        const val NEW_FLIGHT_S = 10.0 * 60
        /** At most a long day's flying of points. */
        const val MOST = 5000
        const val WRITE_EVERY_MS = 30_000L

        @Volatile
        private var shared: OwnTrail? = null

        /** The app's one path, in filesDir/own-trail.json. */
        fun of(context: Context): OwnTrail =
            shared ?: synchronized(this) {
                shared ?: OwnTrail(File(context.applicationContext.filesDir, "own-trail.json")).also { shared = it }
            }
    }
}
