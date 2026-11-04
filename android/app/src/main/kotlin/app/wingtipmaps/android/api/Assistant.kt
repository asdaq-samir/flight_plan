package app.wingtipmaps.android.api

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.wingtipmaps.android.Config
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * One line of the assistant's stream (POST /api/assistant, newline-
 * delimited JSON, app.assistant): a "tool" line while it looks something
 * up, "text" lines that add to the answer, one "sources" line with the
 * raw reports the answer rests on, then "done" -- or "error" in the
 * planner's words. Decoded by hand, as NavLog.kt and the iOS app's
 * Assistant.swift do: a stream is not an OpenAPI response.
 */
sealed interface AssistantLine {
    data class Tool(val name: String, val label: String) : AssistantLine

    data class Text(val text: String) : AssistantLine

    data class Sources(val sources: List<AssistantSource>) : AssistantLine

    data object Done : AssistantLine

    data class Problem(val words: String) : AssistantLine
}

/** A raw thing an answer rests on (a METAR, a NOTAM), shown to the pilot
 *  as sent when its chip is tapped. */
@Serializable
data class AssistantSource(val id: String, val label: String, val text: String)

/** One turn of the conversation: the pilot's question, or the
 *  assistant's answer with the sources it cited and, where the stream
 *  broke, why. */
data class AssistantTurn(
    val id: Long,
    val role: Role,
    val content: String,
    val sources: List<AssistantSource> = emptyList(),
    val problem: String? = null,
) {
    enum class Role(val wire: String) { USER("user"), ASSISTANT("assistant") }
}

/** The pilot's plan, position and record as the planner's Context takes
 *  them, in its snake case. */
@Serializable
data class AssistantContext(
    val dep: String = "",
    val dest: String = "",
    val stops: List<String> = emptyList(),
    val aircraft: String = "",
    @SerialName("altitude_ft") val altitudeFt: Double? = null,
    /** ISO 8601 UTC; null for the planner's own now. */
    val depart: String? = null,
    @SerialName("own_ship") val ownShip: OwnShipFix? = null,
    val pilot: PilotRecord? = null,
) {
    @Serializable
    data class OwnShipFix(
        val lat: Double,
        val lon: Double,
        @SerialName("altitude_ft") val altitudeFt: Double? = null,
        @SerialName("track_deg") val trackDeg: Double? = null,
        @SerialName("groundspeed_kt") val groundspeedKt: Double? = null,
    )

    /** The pilot's own, as words for the model to read, never to compute
     *  from: the home base here; the personal minimums and the currency
     *  once the Android app keeps them (the iOS app's Verdict). */
    @Serializable
    data class PilotRecord(
        @SerialName("personal_minimums") val personalMinimums: Map<String, Double>? = null,
        val currency: List<String> = emptyList(),
        @SerialName("home_base") val homeBase: String? = null,
    )
}

/**
 * The conversation as the pilot sees it, append-only: each streamed
 * answer becomes the next assistant turn, and the whole list is resent
 * with the next question. Pure, so a stream can be folded into it in a
 * test (AssistantTest).
 */
data class AssistantConversation(
    val turns: List<AssistantTurn> = emptyList(),
    /** What the assistant is doing right now (a tool's label), while it
     *  is answering; null between answers and once the text starts. */
    val status: String? = null,
    val answering: Boolean = false,
) {
    private val nextId: Long get() = (turns.lastOrNull()?.id ?: 0L) + 1

    /** The pilot's question, and the assistant's answer begun, empty. */
    fun ask(question: String): AssistantConversation = copy(
        turns = turns + AssistantTurn(nextId, AssistantTurn.Role.USER, question) +
            AssistantTurn(nextId + 1, AssistantTurn.Role.ASSISTANT, ""),
        status = null,
        answering = true,
    )

    /** One line of the stream folded into the answer being written. */
    fun take(line: AssistantLine): AssistantConversation {
        val last = turns.lastOrNull()?.takeIf { it.role == AssistantTurn.Role.ASSISTANT } ?: return this
        return when (line) {
            is AssistantLine.Tool -> copy(status = line.label)
            is AssistantLine.Text -> replacingLast(last.copy(content = last.content + line.text)).copy(status = null)
            is AssistantLine.Sources -> replacingLast(last.copy(sources = last.sources + line.sources))
            AssistantLine.Done -> copy(status = null, answering = false)
            is AssistantLine.Problem -> replacingLast(last.copy(problem = line.words)).copy(status = null, answering = false)
        }
    }

    /** The stream ended without its "done": the call failed, or was given
     *  up. What came stays; why is said under it. */
    fun broke(problem: String?): AssistantConversation {
        val last = turns.lastOrNull()?.takeIf { it.role == AssistantTurn.Role.ASSISTANT }
        val settled = copy(status = null, answering = false)
        return if (last != null && problem != null) settled.replacingLast(last.copy(problem = problem)) else settled
    }

    private fun replacingLast(turn: AssistantTurn) = copy(turns = turns.dropLast(1) + turn)

    /** The turns the planner is sent: every one with words (its Turn
     *  refuses an empty content, which an answer cut off before its first
     *  word would be). */
    val messages: List<Assistant.Message>
        get() = turns.filter { it.content.isNotEmpty() }.map { Assistant.Message(it.role.wire, it.content) }
}

/**
 * The assistant's call, through the gateway's proxy
 * (/api/planner/assistant, on its allow-list) over Gateway.client, with
 * the pilot's session cookie as every planner call carries it.
 */
object Assistant {
    @Serializable
    data class Message(val role: String, val content: String)

    @Serializable
    data class Ask(val messages: List<Message>, val context: AssistantContext? = null)

    /** What a planner without the assistant answers (404 through the
     *  gateway's proxy): said where the question was asked. */
    const val NOT_HERE = "The assistant isn't on this planner yet."

    @Serializable
    private class Kind(val type: String)

    @Serializable
    private class ToolLine(val name: String? = null, val label: String? = null)

    @Serializable
    private class TextLine(val text: String? = null)

    @Serializable
    private class SourcesLine(val sources: List<AssistantSource>? = null)

    @Serializable
    private class ProblemLine(val words: String? = null, val detail: String? = null)

    /** One line of the stream, or null for a kind the app has no use for. */
    fun decode(line: String): AssistantLine? {
        val json = Gateway.json
        return when (json.decodeFromString<Kind>(line).type) {
            "tool" -> json.decodeFromString<ToolLine>(line).let { AssistantLine.Tool(it.name ?: "", it.label ?: "Working…") }
            "text" -> AssistantLine.Text(json.decodeFromString<TextLine>(line).text ?: "")
            "sources" -> AssistantLine.Sources(json.decodeFromString<SourcesLine>(line).sources.orEmpty())
            "done" -> AssistantLine.Done
            "error" -> json.decodeFromString<ProblemLine>(line).let { AssistantLine.Problem(it.words ?: it.detail ?: "The assistant could not answer.") }
            else -> null
        }
    }

    /** The planner's words for a call that failed, where it is said. */
    fun words(e: Exception): String = when {
        e is Planner.Failure && e.status == 404 -> NOT_HERE
        e is Planner.Failure -> e.message ?: "The planner answered ${e.status}."
        e is IOException -> "The assistant could not be reached: ${e.message}"
        else -> e.message ?: "The assistant could not answer."
    }

    /** The answer's lines as the planner streams them. A POST that
     *  changes nothing goes with the CSRF token where the session has
     *  one, as the gateway's own calls carry it. */
    fun stream(ask: Ask): Flow<AssistantLine> = flow {
        val body = Gateway.json.encodeToString(ask).toRequestBody("application/json".toMediaType())
        val builder = Request.Builder().url(Config.gateway + Config.plannerPath("/api/assistant"))
            .header("Accept", "application/x-ndjson").post(body)
        Gateway.csrfToken?.let { builder.header("X-XSRF-TOKEN", it) }
        Gateway.client.newCall(builder.build()).execute().use { response ->
            if (response.code != 200) throw Planner.Failure(response.code, Planner.detail(response.body?.string() ?: ""))
            val source = response.body?.source() ?: return@use
            while (true) {
                val line = source.readUtf8Line() ?: break
                if (line.isNotEmpty()) decode(line)?.let { emit(it) }
            }
        }
    }.flowOn(Dispatchers.IO)
}

/**
 * The conversation with the assistant, one question at a time: a new one
 * cancels the stream of the last, whose words so far stay on the page.
 * A ViewModel, as Plan and Session are, with the conversation in a flow
 * for AskScreen to draw.
 */
class AssistantClient : ViewModel() {
    private val _conversation = MutableStateFlow(AssistantConversation())
    val conversation: StateFlow<AssistantConversation> = _conversation.asStateFlow()

    private var running: Job? = null

    fun ask(question: String, context: AssistantContext?) {
        val words = question.trim()
        if (words.isEmpty()) return
        cancel()
        _conversation.update { it.ask(words) }
        val ask = Assistant.Ask(_conversation.value.messages, context)
        running = viewModelScope.launch {
            try {
                Assistant.stream(ask).collect { line -> _conversation.update { it.take(line) } }
                // A stream that ends with no "done" is cut off; the words so
                // far stay, and the pilot is told the answer is short.
                if (_conversation.value.answering) _conversation.update { it.broke("The answer was cut off.") }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _conversation.update { it.broke(Assistant.words(e)) }
            }
        }
    }

    /** The stream of the last question given up: what came stays. */
    fun cancel() {
        running?.cancel()
        running = null
        if (_conversation.value.answering) _conversation.update { it.broke(null) }
    }

    fun clear() {
        cancel()
        _conversation.value = AssistantConversation()
    }
}
