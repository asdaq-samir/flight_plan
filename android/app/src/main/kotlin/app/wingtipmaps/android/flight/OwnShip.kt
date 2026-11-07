package app.wingtipmaps.android.flight

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationCompat
import androidx.core.location.altitude.AltitudeConverterCompat
import app.wingtipmaps.android.api.AheadAlert
import app.wingtipmaps.android.api.Planner
import app.wingtipmaps.android.api.ahead
import app.wingtipmaps.android.engine.CyclePacks
import app.wingtipmaps.android.engine.Engine
import app.wingtipmaps.android.notify.Notifications
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Own ship: where the phone is, which way it is going and how fast, from
 * the fused location provider at one fix a second while the map is
 * shown, as the web app's useOwnShip and the iOS app's OwnShip keep it.
 * Nothing is worked out from the fix here but the figures of flying it:
 * what is ahead on the track, which the planner is asked for
 * (/api/airspace/ahead), or the packs on the phone when it cannot be
 * reached (CyclePacks.ahead).
 *
 * Kept going with the screen off or the app put away while the airplane
 * is at flying speed: Android's equivalent of iOS's background location
 * is a foreground service of the location type (OwnShipService), which
 * the system keeps alive, with the persistent notification Android
 * requires for one (Notifications.ownShip). On the ground the reading
 * stops with the app, as any map's does.
 *
 * The permission is the screen's to ask through the system's request,
 * precise and approximate together as Android 12 and later require;
 * `start` reads `denied` from whether neither is held, and `approximate`
 * from whether only the approximate one is. An approximate position
 * (to within about three square kilometres, Android's
 * "approximate location") is no position to fly by:
 * the alerts ahead, the ground alert and the traffic near would all be
 * worked out from the wrong place, so no fixes are read from it at all
 * and the screen says why and asks again.
 */
class OwnShip private constructor(private val context: Context) {
    /** A fix as the flight pieces read it: feet, knots, degrees true,
     *  ms since 1970. Null where the provider did not send a figure. */
    data class Fix(
        val lat: Double,
        val lon: Double,
        val altitudeFt: Double?,
        val trackDeg: Double?,
        val groundspeedKt: Double?,
        val accuracyM: Double,
        val atMs: Long,
    )

    private val _fix = MutableStateFlow<Fix?>(null)
    val fix: StateFlow<Fix?> = _fix.asStateFlow()

    private val _denied = MutableStateFlow(false)
    val denied: StateFlow<Boolean> = _denied.asStateFlow()

    /** Only approximate location allowed (Android 12 and later let the
     *  pilot pick it): nothing is read, and the screen asks for precise. */
    private val _approximate = MutableStateFlow(false)
    val approximate: StateFlow<Boolean> = _approximate.asStateFlow()

    /** What the track runs into in the next minutes, from the planner or
     *  the packs. */
    private val _ahead = MutableStateFlow<List<AheadAlert>>(emptyList())
    val ahead: StateFlow<List<AheadAlert>> = _ahead.asStateFlow()

    private val provider: FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var asking: Job? = null
    private var aheadEvery: Ticker.Registration? = null
    private var reading = false
    private var serving = false

    /** The geoid's conversion, one fix at a time and in order, off the
     *  main thread: its first call reads the model from disk. */
    private val converting = Dispatchers.Default.limitedParallelism(1)

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val last = result.lastLocation ?: return
            // The fix's own altitude (Location.getAltitude) is height above
            // the WGS84 ellipsoid, not above mean sea level: over the US the
            // geoid lies 30 to 115 ft below it, and the ground alert, the
            // traffic near and the track are all MSL. Android 14 and later
            // may give MSL with the fix (Location.getMslAltitudeMeters);
            // otherwise the geoid model adds it (AltitudeConverterCompat,
            // androidx.core:core-location-altitude, Android's own
            // AltitudeConverter on 14 and later). Where neither can, the
            // fix has no altitude rather than the ellipsoid's.
            // developer.android.com/reference/android/location/Location#getAltitude()
            if (!last.hasAltitude() || LocationCompat.hasMslAltitude(last)) {
                took(fixOf(last))
                return
            }
            scope.launch {
                withContext(converting) {
                    try {
                        AltitudeConverterCompat.addMslAltitudeToLocation(context, last)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        // No conversion: the fix goes without an altitude.
                    }
                }
                took(fixOf(last))
            }
        }
    }

    /** Whether precise location is allowed: what the dot, the alerts and
     *  the track need. */
    val permitted: Boolean
        get() = held(Manifest.permission.ACCESS_FINE_LOCATION)

    private fun held(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /** The fixes started, one a second: the map is shown. Nothing without
     *  the permission, and `denied` says so for the screen. */
    fun start() {
        // Checked here, in the method that asks the provider, so lint's
        // MissingPermission sees the check beside the call it guards.
        val precise = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        _approximate.value = !precise && coarse
        _denied.value = !precise && !coarse
        if (!precise) {
            // Downgraded to approximate (or off) while reading: the
            // fixes stop with the permission.
            stop()
            return
        }
        if (!reading) {
            reading = true
            // One fix a second at the best accuracy, as the iOS app asks
            // Core Location: what the alerts ahead and the path need.
            val request = com.google.android.gms.location.LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, EVERY_MS)
                .setMinUpdateIntervalMillis(EVERY_MS)
                .build()
            try {
                provider.requestLocationUpdates(request, callback, Looper.getMainLooper())
            } catch (e: SecurityException) {
                reading = false
                _denied.value = true
                return
            }
        }
        if (aheadEvery == null) aheadEvery = Ticker.shared.every(AHEAD_EVERY_MS) { askAhead() }
    }

    /** The fixes stopped: the map is put away on the ground. In the air
     *  the service keeps the reading (stopService is `landed`'s). */
    fun stop() {
        if (!reading) return
        reading = false
        provider.removeLocationUpdates(callback)
        aheadEvery?.cancel()
        aheadEvery = null
        asking?.cancel()
        serve(false)
    }

    private fun took(fix: Fix) {
        // A fix converted after the reading stopped is left out.
        if (!reading) return
        // A fix converted late can be overtaken by a newer one that needed
        // no conversion; time does not go backwards for the trail and the
        // alerts.
        if (_fix.value.let { it != null && fix.atMs <= it.atMs }) return
        _fix.value = fix
        // The path flown, and the phone's position kept with the screen
        // off only while flying: the service is started as the airplane
        // reaches flying speed and stopped as it slows below it.
        serve(OwnTrail.of(context).took(fix))
    }

    /** The foreground service on while flying, off otherwise. Android 12
     *  and later refuse to start a foreground service from the
     *  background in most states; a start refused is tried again at the
     *  next fix, which only comes while the app is in front anyway. */
    private fun serve(flying: Boolean) {
        if (flying == serving) return
        val intent = Intent(context, OwnShipService::class.java)
        if (flying) {
            try {
                ContextCompat.startForegroundService(context, intent)
                serving = true
            } catch (e: IllegalStateException) {
                serving = false
            }
        } else {
            context.stopService(intent)
            serving = false
        }
    }

    /** What is ahead, asked of the latest fix every ten seconds while the
     *  airplane is at flying speed (the clock's, Ticker): the planner looks
     *  five minutes along the track (wingtip.alerts). Flying speed is the
     *  engine's `underway`, the speed the engine's own look ahead starts
     *  at, so a taxiing airplane asks nothing it would not answer. The
     *  asking is a job of its own, so the next question cancels one still
     *  unanswered. */
    private fun askAhead() {
        val fix = _fix.value ?: return
        val track = fix.trackDeg ?: return
        val gs = fix.groundspeedKt ?: return
        if (!underway(gs)) return
        asking?.cancel()
        asking = scope.launch {
            val alerts = try {
                Planner.ahead(fix.lat, fix.lon, track, gs, fix.altitudeFt)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // No planner in the air: the same alerts from the packs
                // kept for the route (CyclePacks.ahead).
                CyclePacks.of(context).ahead(fix.lat, fix.lon, track, gs, fix.altitudeFt)?.alerts ?: return@launch
            }
            _ahead.value = alerts
        }
    }

    companion object {
        /** A fix as the flight pieces read it, its altitude above mean sea
         *  level or none (the callback's comment says why). */
        fun fixOf(location: Location): Fix =
            Fix(
                lat = location.latitude, lon = location.longitude,
                altitudeFt = mslFeet(if (LocationCompat.hasMslAltitude(location)) LocationCompat.getMslAltitudeMeters(location) else null),
                trackDeg = if (location.hasBearing()) location.bearing.toDouble() else null,
                groundspeedKt = if (location.hasSpeed()) location.speed * KT_PER_MPS else null,
                accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else Double.NaN,
                atMs = location.time,
            )

        /** Feet above mean sea level from metres above it; none stays none,
         *  never the ellipsoid's height in its place. */
        fun mslFeet(mslMeters: Double?): Double? = mslMeters?.let { it * FT_PER_M }

        /** One fix a second. */
        const val EVERY_MS = 1000L
        /** How often what is ahead is asked while moving; the planner looks
         *  five minutes along the track, so twice this with the app put
         *  away still leaves minutes. */
        const val AHEAD_EVERY_MS = 10_000L
        /** Whether a ground speed is flying speed: the engine's
         *  `underway` (motion/glide.rs, AIRBORNE_KT), which the trail and
         *  the strip go by too. Below it nothing ahead is asked: taxiing,
         *  or a fix wandering while parked. */
        fun underway(speedKt: Double?): Boolean =
            Engine.call<OwnTrail.Speed, Boolean>("underway", OwnTrail.Speed(speedKt))
        const val FT_PER_M = 3.28084
        const val KT_PER_MPS = 1.943844

        @Volatile
        private var shared: OwnShip? = null

        fun of(context: Context): OwnShip =
            shared ?: synchronized(this) { shared ?: OwnShip(context.applicationContext).also { shared = it } }
    }
}

/**
 * The foreground service that keeps the process alive while the airplane
 * is flying, so the fixes go on with the screen off (the manifest's
 * foregroundServiceType="location"). It reads nothing itself: OwnShip's
 * callback runs in this process whether or not an activity is shown, and
 * the service is only Android's reason not to end it. Its notification
 * is the one Android requires, on the low channel.
 */
class OwnShipService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = Notifications.ownShip(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(this, Notifications.OWN_SHIP_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(Notifications.OWN_SHIP_ID, notification)
        }
        // Not restarted by the system once stopped: a flight the system
        // ended is not resumed on the ground.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
