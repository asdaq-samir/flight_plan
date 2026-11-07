package app.wingtipmaps.android.flight

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
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
 * The permission (ACCESS_FINE_LOCATION) is the screen's to ask through
 * the system's request; `start` reads `denied` from whether it is held.
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

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val last = result.lastLocation ?: return
            took(
                Fix(
                    lat = last.latitude, lon = last.longitude,
                    altitudeFt = if (last.hasAltitude()) last.altitude * FT_PER_M else null,
                    trackDeg = if (last.hasBearing()) last.bearing.toDouble() else null,
                    groundspeedKt = if (last.hasSpeed()) last.speed * KT_PER_MPS else null,
                    accuracyM = if (last.hasAccuracy()) last.accuracy.toDouble() else Double.NaN,
                    atMs = last.time,
                ),
            )
        }
    }

    val permitted: Boolean
        get() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** The fixes started, one a second: the map is shown. Nothing without
     *  the permission, and `denied` says so for the screen. */
    fun start() {
        // Checked here, in the method that asks the provider, so lint's
        // MissingPermission sees the check beside the call it guards.
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            _denied.value = true
            return
        }
        _denied.value = false
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
