package app.wingtipmaps.android.strip

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.wingtipmaps.android.Plan
import app.wingtipmaps.android.api.AssistantClient
import app.wingtipmaps.android.api.AssistantContext
import app.wingtipmaps.android.api.Gateway
import app.wingtipmaps.android.api.Pilot
import app.wingtipmaps.android.api.Planner
import app.wingtipmaps.android.engine.Engine
import app.wingtipmaps.android.flight.OwnShip
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/**
 * What the strip does with a line from the field (FieldCommands.readField
 * says what it means; this does it, as the web's PlanWorkspace.fieldLine
 * does): a route is planned (Plan), a field's card opened, a place looked
 * up through the planner's search and flown to, a screen opened, and
 * anything else asked of the assistant (AssistantClient, the Ask
 * screen's own). Why a line could not be done is said under the field,
 * in the planner's words or the app's, never in a toast.
 *
 * The fields' cards the strip's departure, stops and destination show --
 * the name, whether towered, and the radio chips: the ATIS (or
 * AWOS/ASOS) and the tower or the CTAF -- come from the planner's
 * airport card, the chips picked by the engine's own frequency rules
 * (frequency_of, ctaf_of: the CTAF, else a UNICOM that is also the CTAF,
 * else MULTICOM's 122.9, AC 90-66C 9.6), never by this file.
 */
class StripModel : ViewModel() {
    /** A chip on a field's card: its label in capitals, and the words a
     *  screen reader says ("ATIS 124.8"). */
    data class RadioChip(val label: String, val words: String)

    data class FieldCard(val ident: String, val name: String, val towered: Boolean, val chips: List<RadioChip>)

    /** A screen over the strip, named on the ribbon with its close. */
    sealed interface Over {
        val title: String

        data class Airport(val ident: String) : Over {
            override val title get() = ident
        }

        data object Airplane : Over {
            override val title get() = "My airplane"
        }

        data object Settings : Over {
            override val title get() = "Settings"
        }

        data object Ask : Over {
            override val title get() = "Ask"
        }
    }

    data class State(
        val cards: Map<String, FieldCard> = emptyMap(),
        /** Why the last line could not be done; null once one is. */
        val problem: String? = null,
        val busy: Boolean = false,
        val over: Over? = null,
        /** The assistant's last answer shown as a card over the strip. */
        val answerShown: Boolean = false,
        /** Counts the lines done, so the sheet comes up for each. */
        val done: Int = 0,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    fun open(over: Over?) = _state.update { it.copy(over = over) }

    fun dismissAnswer() = _state.update { it.copy(answerShown = false) }

    /** The assistant asked from a card (a glance's action): its answer
     *  shown over the strip. */
    fun showAnswer() = _state.update { it.copy(answerShown = true, problem = null) }

    /** Something said where it happened: why the microphone could not be
     *  used, under the field. */
    fun say(problem: String) = _state.update { it.copy(problem = problem) }

    /**
     * A line from the field, done: `onOpen` is the layout's own doing of a
     * screen's word, answering why not where it cannot (a screen not on
     * this phone yet). What the field was given is handled whether typed
     * or said.
     */
    fun submit(
        text: String,
        plan: Plan,
        pilot: Pilot?,
        fix: OwnShip.Fix?,
        assistant: AssistantClient,
        context: AssistantContext,
        onOpen: (FieldScreen) -> String?,
    ) {
        val command = FieldCommands.readField(text) ?: return
        if (_state.value.busy) return
        _state.update { it.copy(problem = null, busy = true) }
        viewModelScope.launch {
            val why = try {
                line(command, text, plan, pilot, fix, assistant, context, onOpen)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                e.message ?: "That could not be done."
            }
            _state.update { it.copy(busy = false, problem = why, done = if (why == null) it.done + 1 else it.done) }
        }
    }

    private suspend fun line(
        command: FieldCommand,
        text: String,
        plan: Plan,
        pilot: Pilot?,
        fix: OwnShip.Fix?,
        assistant: AssistantClient,
        context: AssistantContext,
        onOpen: (FieldScreen) -> String?,
    ): String? {
        when (command) {
            is FieldCommand.Open -> return onOpen(command.screen)
            is FieldCommand.Field -> {
                open(Over.Airport(command.ident))
                return null
            }
            is FieldCommand.Route -> return route(command, plan, pilot, fix)
            is FieldCommand.Place -> {
                // The biggest field by the name, as the planner's search ranks
                // them; not a place the search knows: a question after all.
                val found = Planner.search(command.words).firstOrNull()
                if (found != null) return route(FieldCommand.Route(null, emptyList(), found.ident), plan, pilot, fix)
                return ask(text, assistant, context)
            }
            is FieldCommand.Ask -> return ask(command.question, assistant, context)
        }
    }

    private fun ask(question: String, assistant: AssistantClient, context: AssistantContext): String? {
        assistant.ask(question, context)
        _state.update { it.copy(answerShown = true) }
        return null
    }

    /** The route planned: one ident is the destination, from the route's
     *  departure, else the nearest field to the airplane, else the pilot's
     *  home base. */
    private suspend fun route(command: FieldCommand.Route, plan: Plan, pilot: Pilot?, fix: OwnShip.Fix?): String? {
        var dep = command.dep ?: plan.state.value.dep
        if (dep.isEmpty() && fix != null) {
            dep = runCatching { nearest(fix.lat, fix.lon) }.getOrNull() ?: ""
        }
        if (dep.isEmpty()) dep = pilot?.homeBase?.trim()?.uppercase() ?: ""
        if (dep.isEmpty()) return "Say where from too: \"C81 KDLH\", or turn on Show my airplane."
        if (dep == command.dest && command.stops.isEmpty()) return "${command.dest} is where you are. Say somewhere to fly to."
        plan.plan(dep, command.dest, command.stops)
        return null
    }

    @Serializable
    private class NearestAnswer(val airports: List<NearestField>)

    @Serializable
    private class NearestField(val ident: String)

    /** The nearest field to a position, the planner's (/api/airports/nearest). */
    private suspend fun nearest(lat: Double, lon: Double): String? {
        val body = Planner.fetch("/api/airports/nearest", mapOf("lat" to lat.toString(), "lon" to lon.toString(), "limit" to "1"))
        return Gateway.json.decodeFromString<NearestAnswer>(body).airports.firstOrNull()?.ident
    }

    /** The fields the engine reads of a frequency (lib/frequencies' sent). */
    @Serializable
    data class SentFrequency(
        val type: String? = null,
        val description: String? = null,
        @SerialName("frequency_mhz") val frequencyMhz: Double? = null,
    )

    @Serializable
    private class AirportAnswer(
        val ident: String,
        val name: String = "",
        val towered: Boolean = false,
        val frequencies: List<SentFrequency> = emptyList(),
    )

    @Serializable
    private class FrequencyOfAsk(val frequencies: List<SentFrequency>, val types: List<String>)

    @Serializable
    private class FrequenciesAsk(val frequencies: List<SentFrequency>)

    /** The cards of the route's fields, each asked once. */
    fun loadFields(idents: Collection<String>) {
        val wanted = idents.map { it.uppercase() }.filter { it.isNotEmpty() && it !in _state.value.cards }.toSet()
        if (wanted.isEmpty()) return
        viewModelScope.launch {
            for (ident in wanted) {
                val card = try {
                    val answer = Gateway.json.decodeFromString<AirportAnswer>(Planner.fetch("/api/airport/$ident"))
                    FieldCard(answer.ident, answer.name, answer.towered, radioChips(answer.frequencies, answer.towered))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // A card that cannot be had: the row shows the ident alone.
                    FieldCard(ident, "", false, emptyList())
                }
                _state.update { it.copy(cards = it.cards + (ident to card)) }
            }
        }
    }

    /** The frequency chips a field's card offers, as the web's StripList
     *  radioChips picks them through the engine: its ATIS (or AWOS/ASOS),
     *  its tower where towered, else its CTAF. */
    fun radioChips(frequencies: List<SentFrequency>, towered: Boolean): List<RadioChip> {
        if (frequencies.isEmpty()) return emptyList()
        return runCatching {
            val out = mutableListOf<RadioChip>()
            val atis = frequencyOf(frequencies, listOf("ATIS")) ?: frequencyOf(frequencies, listOf("AWOS", "ASOS"))
            if (atis?.frequencyMhz != null) {
                val label = (atis.type ?: "ATIS").uppercase()
                out += RadioChip(label, "$label ${StripData.mhzText(atis.frequencyMhz)}")
            }
            val tower = if (towered) frequencyOf(frequencies, listOf("TWR")) else null
            if (tower?.frequencyMhz != null) {
                out += RadioChip("TOWER", "Tower ${StripData.mhzText(tower.frequencyMhz)}")
            } else {
                val ctaf = ctafOf(frequencies)
                if (ctaf?.frequencyMhz != null) out += RadioChip("CTAF", "CTAF ${StripData.mhzText(ctaf.frequencyMhz)}")
            }
            out.toList()
        }.getOrDefault(emptyList())
    }

    private fun frequencyOf(frequencies: List<SentFrequency>, types: List<String>): SentFrequency? {
        val at: Int? = Engine.call("frequency_of", FrequencyOfAsk(frequencies, types))
        return at?.let(frequencies::getOrNull)
    }

    private fun ctafOf(frequencies: List<SentFrequency>): SentFrequency? {
        val answer = Engine.json.decodeFromString<JsonElement>(
            Engine.callNative("ctaf_of", Engine.json.encodeToString(FrequenciesAsk(frequencies))),
        )
        val index = (answer as? JsonPrimitive)?.intOrNull
        return if (index != null) frequencies.getOrNull(index) else Engine.json.decodeFromString<SentFrequency>(answer.toString())
    }
}
