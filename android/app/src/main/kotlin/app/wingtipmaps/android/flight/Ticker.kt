package app.wingtipmaps.android.flight

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The app's one clock for the work it repeats: the traffic about the
 * map, the tracked and watched airplanes, and what is ahead on the track
 * are each a registration here, with its own interval, and one coroutine
 * runs them as they fall due, one after another on the scope's thread
 * (the main thread in the app). With the app in the background every
 * interval is doubled -- twice, not more, since what is ahead still
 * matters in flight with the screen off, and the planner looks five
 * minutes along the track -- and the loop stops when nothing is
 * registered. The twin of the iOS app's Ticker.swift; Android has no
 * "phone locked" notice an app may read, so the process's lifecycle
 * (ProcessLifecycleOwner) is the one signal, and the screen off with
 * the app in front counts as in front.
 *
 * The scope and the clock come in so a test runs it on virtual time.
 */
class Ticker(private val scope: CoroutineScope, private val now: () -> Long = System::currentTimeMillis) {
    /** A piece of work registered: cancel it to take it off the clock. */
    inner class Registration internal constructor(val everyMs: Long, val work: suspend () -> Unit) {
        internal var dueMs: Long = now()
        internal var live = true

        fun cancel() {
            live = false
            remove(this)
        }
    }

    private val items = ArrayList<Registration>()
    private var loop: Job? = null
    /** The wait for the next due item, a job of its own so a new
     *  registration or the app coming back can cut it short. */
    private var waiting: Job? = null

    /** Whether the intervals are stretched: the app in the background. */
    var background: Boolean = false
        set(value) {
            field = value
            // Back on the screen: nothing waits longer than its own
            // interval, and what fell due while away runs now.
            if (!value) {
                val soon = now()
                for (item in items) item.dueMs = minOf(item.dueMs, soon + item.everyMs)
                waiting?.cancel()
            }
        }

    private val factor: Long get() = if (background) SLOWED else 1

    /** Work done every so many milliseconds (the first time now), until
     *  the registration is cancelled. */
    fun every(everyMs: Long, work: suspend () -> Unit): Registration {
        val item = Registration(everyMs, work)
        items += item
        if (loop == null) {
            loop = scope.launch { run() }
        } else {
            waiting?.cancel()
        }
        return item
    }

    /** What is on the clock, for a test and a debug screen. */
    val count: Int get() = items.size

    private fun remove(item: Registration) {
        items.remove(item)
        if (items.isEmpty()) {
            loop?.cancel()
            loop = null
            waiting?.cancel()
        }
    }

    /** The loop: each item due is run, in the order registered, then the
     *  clock waits for the soonest. It ends by being cancelled (`remove`,
     *  as the last item goes), so a loop still finishing an item's work
     *  never mistakes a newer loop for itself. */
    private suspend fun run() {
        while (items.isNotEmpty()) {
            val at = now()
            for (item in items.toList()) {
                if (!item.live || item.dueMs > at) continue
                item.work()
                // A run that took longer than the interval is followed by
                // the next at once, with no pile-up.
                item.dueMs = now() + item.everyMs * factor
            }
            val next = items.filter { it.live }.minOfOrNull { it.dueMs } ?: break
            val wait = maxOf(10L, next - now())
            val waiting = scope.launch { delay(wait) }
            this.waiting = waiting
            waiting.join()
        }
    }

    companion object {
        /** How much longer each interval is with the app put away. */
        const val SLOWED = 2L

        /** The app's clock, on the main thread, slowed while the whole
         *  process is in the background (ProcessLifecycleOwner: no
         *  activity started). Made on first use, from the main thread. */
        val shared: Ticker by lazy {
            Ticker(CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)).also { ticker ->
                ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
                    override fun onStart(owner: LifecycleOwner) { ticker.background = false }
                    override fun onStop(owner: LifecycleOwner) { ticker.background = true }
                })
            }
        }
    }
}
