package app.wingtipmaps.android.flight

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import app.wingtipmaps.android.api.Planner
import app.wingtipmaps.android.api.TrafficAircraft
import app.wingtipmaps.android.api.name
import app.wingtipmaps.android.api.traffic
import app.wingtipmaps.android.engine.Engine
import app.wingtipmaps.android.engine.TrafficMarksAnswerElement
import app.wingtipmaps.android.notify.Notifications
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

/** The app's settings file (Jetpack DataStore), for the few switches a
 *  flight piece keeps: the traffic layer on or off. */
private val Context.settings: DataStore<Preferences> by preferencesDataStore(name = "settings")

/**
 * The traffic layer's switch, kept in the app's settings file under
 * "traffic" so it holds across launches. On until the pilot turns it
 * off, as the app has always started with traffic on (the iOS app's
 * Traffic.on starts the same way). Its own small piece, apart from
 * Traffic's polling, so its wiring is tested on a plain DataStore.
 */
class TrafficSwitch(private val store: DataStore<Preferences>, private val scope: CoroutineScope) {
    private val _on = MutableStateFlow(true)
    val on: StateFlow<Boolean> = _on.asStateFlow()

    /** The kept value read once; a choice made before it lands wins. */
    val loaded: Job = scope.launch { store.data.first()[KEY]?.let { _on.value = it } }

    /** Turns the layer on or off now and keeps it; the write's job. */
    fun set(on: Boolean): Job {
        loaded.cancel()
        _on.value = on
        return scope.launch { store.edit { it[KEY] = on } }
    }

    companion object {
        val KEY = booleanPreferencesKey("traffic")
    }
}

/** An airplane's mark: the engine's `traffic_marks` answer, one per airplane. */
typealias Mark = TrafficMarksAnswerElement

/**
 * The airplanes ADS-B receivers hear about the map, from the planner
 * (/api/traffic, wingtip.traffic, adsb.lol's open data), as the web app's
 * TrafficLayer and the iOS app's Traffic ask for them: every five
 * seconds, about own ship where there is a fix, else the middle of the
 * map, out to the map's corners (10 to 60 nm). For knowing what is
 * about, never for avoiding it. Each airplane's mark -- its height
 * against own ship's as TCAS writes it, and whether it is near -- is the
 * engine's (`traffic_marks`), in one call for the whole answer.
 */
class Traffic private constructor(private val context: Context, private val ticker: Ticker, private val scope: CoroutineScope) {
    private val switch = TrafficSwitch(context.settings, scope)
    /** Whether the layer is on; kept across launches (TrafficSwitch),
     *  turned on and off from Setup's Map section. */
    val on: StateFlow<Boolean> = switch.on

    private val _planes = MutableStateFlow<List<TrafficAircraft>>(emptyList())
    val planes: StateFlow<List<TrafficAircraft>> = _planes.asStateFlow()

    /** Each airplane's mark, in the planes' order. */
    private val _marks = MutableStateFlow<List<Mark>>(emptyList())
    val marks: StateFlow<List<Mark>> = _marks.asStateFlow()

    private val _source = MutableStateFlow<String?>(null)
    val source: StateFlow<String?> = _source.asStateFlow()

    /** When the airplanes last heard were where they are given: the
     *  answer's time less its own age (TrafficAnswer.age_s). */
    private val _heardAtMs = MutableStateFlow<Long?>(null)
    val heardAtMs: StateFlow<Long?> = _heardAtMs.asStateFlow()

    /** The middle of the map and the miles to its corner, as the map last
     *  rested: the screen sets them. */
    var mapCentre: Pair<Double, Double>? = null
    var mapRadiusNm = 30.0

    /** The airplanes near own ship at the last answer, each told once. */
    private var nearHexes: Set<String> = emptySet()
    private var every: Ticker.Registration? = null

    fun setOn(on: Boolean) {
        switch.set(on)
        if (!on) {
            _planes.value = emptyList()
            _marks.value = emptyList()
        }
    }

    /** Asked again and again while the map is shown, on the app's one
     *  clock, about own ship where there is a fix (its height tells which
     *  airplanes are near), else about the middle of the map. */
    fun start() {
        if (every == null) every = ticker.every(EVERY_MS) { ask(OwnShip.of(context).fix.value) }
    }

    fun stop() {
        every?.cancel()
        every = null
    }

    /** One answer about a point, where traffic is on and there is one. */
    private suspend fun ask(fix: OwnShip.Fix?) {
        if (!on.value) return
        val at = fix?.let { it.lat to it.lon } ?: mapCentre ?: return
        val radius = mapRadiusNm.coerceIn(10.0, 60.0)
        val answer = try {
            Planner.traffic(at.first, at.second, radius)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return
        }
        if (!on.value) return
        val age = answer.ageS ?: 0.0
        val planes = answer.aircraft.filter { (it.seenS ?: 0.0) + age <= STALE_S }
        _planes.value = planes
        _marks.value = marks(planes, fix?.altitudeFt)
        _source.value = answer.source
        _heardAtMs.value = System.currentTimeMillis() - (age * 1000).toLong()
        Tracking.of(context).heard(planes)
        tellNear(fix, planes, _marks.value)
    }

    /** The airplanes near own ship (the engine's `traffic_marks`, the
     *  amber mark: within 1,000 ft of its height) and within
     *  TELL_WITHIN_NM, each told once as it comes near, as a heads-up
     *  notification while the app is not in front; on the screen the
     *  amber mark says it, so nothing is sent then. Permission is asked
     *  the first time traffic is near with the app in front, the moment
     *  the pilot sees what it is for. */
    private fun tellNear(fix: OwnShip.Fix?, planes: List<TrafficAircraft>, marks: List<Mark>) {
        val ownFt = fix?.altitudeFt
        if (fix == null || ownFt == null) {
            nearHexes = emptySet()
            return
        }
        val near = HashSet<String>()
        for ((plane, mark) in planes.zip(marks)) {
            if (!mark.near) continue
            val nm = Geo.nm(fix.lat, fix.lon, plane.lat, plane.lon)
            if (nm > TELL_WITHIN_NM) continue
            near += plane.hex
            if (plane.hex in nearHexes) continue
            if (Notifications.inFront) {
                Notifications.allow()
                continue
            }
            val against = plane.altitudeFt?.let { ", ${against(it - ownFt)}" } ?: ""
            val place = "${nm.roundToInt()} nm ${Geo.compassPoint(Geo.bearingDeg(fix.lat, fix.lon, plane.lat, plane.lon))} of you"
            Notifications.tell(context, Notifications.CHANNEL_TRAFFIC, "Traffic near you", "${plane.name}, $place$against", "traffic-${plane.hex}")
        }
        nearHexes = near
    }

    /** What is drawn under an airplane: its height against own ship's in
     *  hundreds of feet, "+05" above and "-12" below, as TCAS writes it,
     *  with an arrow climbing or descending at 500 ft/min or more (the
     *  FAA's Introduction to TCAS II, version 7.1); with own ship's height
     *  not known, its own height in feet; nothing where it sends none.
     *  And whether it is near, within 1,000 ft of own ship's height,
     *  drawn amber: a design choice, the web app's, 1,000 ft being the
     *  spacing VFR cruising altitudes keep between opposite directions
     *  (14 CFR 91.159). All the engine's, its type generated from the
     *  engine's contract (engine/EngineContract.kt); the app draws it. */

    companion object {
        /** The planner asks adsb.lol about a region at most every five
         *  seconds (wingtip.traffic), so no sooner than that; twice that with
         *  the app put away (Ticker). */
        const val EVERY_MS = 5_000L
        /** No newer report than this, s, and the airplane is not drawn:
         *  the web app's CARRY_S. */
        const val STALE_S = 30.0
        /** An airplane within this of own ship, with its height within
         *  1,000 ft (`near`), is told while the app is not in front. A
         *  design choice, no rule: the amber mark says it on the screen
         *  out to the map's edge, but a notification is for traffic a
         *  pilot looks for now, so the bound keeps an airplane 40 nm off
         *  quiet. */
        const val TELL_WITHIN_NM = 5.0

        @Volatile
        private var shared: Traffic? = null

        fun of(context: Context): Traffic =
            shared ?: synchronized(this) {
                shared ?: Traffic(context.applicationContext, Ticker.shared, CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate))
                    .also { shared = it }
            }

        @Serializable
        private class PlaneAsk(@SerialName("altitude_ft") val altitudeFt: Double?, @SerialName("vertical_fpm") val verticalFpm: Double?)

        @Serializable
        private class MarksAsk(@SerialName("own_ft") val ownFt: Double?, val planes: List<PlaneAsk>)

        /** Each airplane's mark, in one call (the engine's `traffic_marks`,
         *  the web app's trafficLabel); none where the engine cannot answer. */
        fun marks(planes: List<TrafficAircraft>, ownFt: Double?): List<Mark> =
            runCatching {
                Engine.call<MarksAsk, List<Mark>>("traffic_marks", MarksAsk(ownFt, planes.map { PlaneAsk(it.altitudeFt, it.verticalFpm) }))
            }.getOrDefault(emptyList())

        /** A height against own ship's in words for a notification: "500
         *  ft above", "1,200 ft below", "at your height". */
        fun against(deltaFt: Double): String {
            val rounded = (deltaFt / 100).roundToInt() * 100
            return when {
                rounded == 0 -> "at your height"
                rounded > 0 -> "${"%,d".format(rounded)} ft above"
                else -> "${"%,d".format(-rounded)} ft below"
            }
        }

        /** What the Open Database License asks of a map that draws
         *  adsb.lol's data: its source and the licence, named. */
        fun credit(source: String?): String {
            val credits = mapOf("adsb.lol" to "Traffic adsb.lol, ODbL", "ADS-B Exchange" to "ADS-B Exchange", "adsb.fi" to "adsb.fi")
            val named = (source ?: "adsb.lol").split(" and ").mapNotNull { credits[it] }
            val first = named.firstOrNull() ?: return "Traffic adsb.lol, ODbL"
            return if (first == "Traffic adsb.lol, ODbL") named.joinToString(" · ") else "Traffic ${named.joinToString(" · ")}"
        }
    }
}
