package app.wingtipmaps.android

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.wingtipmaps.android.api.Course
import app.wingtipmaps.android.api.Gateway
import app.wingtipmaps.android.api.Leg
import app.wingtipmaps.android.api.NavLogMessage
import app.wingtipmaps.android.api.NavLogTotals
import app.wingtipmaps.android.api.Planner
import app.wingtipmaps.android.engine.CyclePacks
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

/**
 * The route being planned and what the planner has said of it so far: the
 * course as soon as its ends are found, then the nav log's lines as they
 * stream. The log before a re-plan stays on the page until the new one is
 * whole, as the web app keeps it (usePlan) and the iOS app's Plan.swift
 * does, so the pilot is never looking at a blank list. One State, changed
 * only here and read by the screens (unidirectional data flow).
 */
class Plan(app: Application) : AndroidViewModel(app) {
    data class State(
        val dep: String = "",
        val dest: String = "",
        val stops: List<String> = emptyList(),
        /** The planner's aircraft profile; the airplane by N-number is a
         *  later phase. */
        val aircraft: String = "c172",
        val course: Course? = null,
        val legs: List<Leg> = emptyList(),
        val totals: NavLogTotals? = null,
        /** What the planner is doing now, in its words; null when done. */
        val stage: String? = null,
        /** Why there is no plan, in the planner's words; null when there is. */
        val problem: String? = null,
        val planning: Boolean = false,
    ) {
        val routed: Boolean get() = dep.isNotEmpty() && dest.isNotEmpty()
    }

    private val prefs = app.getSharedPreferences("plan", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var running: Job? = null
    private var keepingPacks: Job? = null

    init {
        restore()
    }

    /** The route as typed, planned: idents upper-cased as the planner
     *  reads them, empty stops left out. */
    fun plan(dep: String, dest: String, stops: List<String>) {
        _state.update {
            it.copy(
                dep = dep.trim().uppercase(),
                dest = dest.trim().uppercase(),
                stops = stops.map { s -> s.trim().uppercase() }.filter { s -> s.isNotEmpty() },
            )
        }
        plan()
    }

    /** One of the planner's airplane types picked; the route, where there
     *  is one, planned again on its figures. */
    fun setAircraft(name: String) {
        _state.update { it.copy(aircraft = name) }
        if (_state.value.routed) plan()
    }

    /** Plans the route as entered: the course first, for the map, then the
     *  nav log streamed in. */
    fun plan() {
        val asked = _state.value
        if (!asked.routed) return
        running?.cancel()
        _state.update { it.copy(planning = true, problem = null, stage = "Finding the route…") }
        running = viewModelScope.launch {
            try {
                val course = Planner.course(asked.dep, asked.dest, asked.stops)
                _state.update { it.copy(course = course) }
                val fresh = mutableListOf<Leg>()
                Planner.navlog(asked.dep, asked.dest, asked.stops, asked.aircraft).collect { message ->
                    when (message) {
                        is NavLogMessage.Stage -> _state.update { it.copy(stage = message.detail) }
                        is NavLogMessage.Altitude -> {}
                        is NavLogMessage.OneLeg -> {
                            fresh += message.leg
                            // Each leg as it comes, once the first is in: the
                            // old log stands until then.
                            _state.update { it.copy(legs = fresh.toList()) }
                        }
                        is NavLogMessage.Done -> {
                            _state.update { it.copy(legs = fresh.toList(), totals = message.totals, stage = null) }
                            keep()
                            keepForTheAir()
                        }
                        is NavLogMessage.Problem -> _state.update { it.copy(problem = message.error.detail, stage = null) }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // With no connection the plan kept stands, in silence; a
                // planner's own refusal is said as it is.
                _state.update {
                    val said = if (it.legs.isEmpty() || e !is IOException) e.message ?: "The planner could not be reached." else it.problem
                    it.copy(problem = said, stage = null)
                }
            }
            _state.update { it.copy(planning = false) }
        }
    }

    /** What is on the page, kept for the next launch. */
    @Serializable
    private class Kept(
        val dep: String,
        val dest: String,
        val stops: List<String>,
        val aircraft: String,
        val course: Course? = null,
        val legs: List<Leg> = emptyList(),
        val totals: NavLogTotals? = null,
    )

    private fun keep() {
        val s = _state.value
        if (!s.routed || s.course == null || s.totals == null) return
        val kept = Kept(s.dep, s.dest, s.stops, s.aircraft, s.course, s.legs, s.totals)
        prefs.edit().putString(KEY, Gateway.json.encodeToString(kept)).apply()
    }

    /** The cycle packs of the regions the route crosses (CyclePacks),
     *  fetched once the route is planned, so the airspace there, what is
     *  ahead in the air and a clearance's places are answered with no
     *  connection: the iOS app's Plan.keepForTheAir does the same. A job
     *  of its own, so a re-plan does not cut it short, and the next
     *  route's keep replaces one still running (the files are each
     *  written whole, so nothing is left half kept). */
    private fun keepForTheAir() {
        val line = _state.value.course?.courseLine ?: return
        val packs = CyclePacks.of(getApplication<Application>())
        keepingPacks?.cancel()
        keepingPacks = viewModelScope.launch {
            val regions = withContext(Dispatchers.Default) { CyclePacks.regions(line) }
            packs.keep(regions)
        }
    }

    /** The last plan kept, back on the page at launch: planned again when
     *  the planner answers, kept as it was when it does not. */
    fun restore() {
        val kept = prefs.getString(KEY, null)?.let { text ->
            runCatching { Gateway.json.decodeFromString<Kept>(text) }.getOrNull()
        } ?: return
        _state.update {
            it.copy(dep = kept.dep, dest = kept.dest, stops = kept.stops, aircraft = kept.aircraft,
                    course = kept.course, legs = kept.legs, totals = kept.totals)
        }
        plan()
    }

    /** The route cleared, and what was kept of it. */
    fun clear() {
        running?.cancel()
        _state.value = State(aircraft = _state.value.aircraft)
        prefs.edit().remove(KEY).apply()
    }

    private companion object {
        const val KEY = "kept"
    }
}
