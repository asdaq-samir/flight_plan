package app.wingtipmaps.android

import app.wingtipmaps.android.api.Assistant
import app.wingtipmaps.android.api.AssistantContext
import app.wingtipmaps.android.api.AssistantConversation
import app.wingtipmaps.android.api.AssistantLine
import app.wingtipmaps.android.api.AssistantSource
import app.wingtipmaps.android.api.AssistantTurn
import app.wingtipmaps.android.api.Gateway
import app.wingtipmaps.android.api.Planner
import java.io.IOException
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The assistant's stream decoded line by line and folded into the
 *  conversation, as AskScreen shows it (api/Assistant.kt); the same
 *  sample as the iOS app's AssistantTests. */
class AssistantTest {
    private val stream = listOf(
        """{"type":"tool","name":"weather_at","label":"Checking the weather at KMSN"}""",
        """{"type":"text","text":"KMSN is "}""",
        """{"type":"text","text":"VFR: wind 270 at 12, "}""",
        """{"type":"text","text":"visibility 10, clear below 12,000."}""",
        """{"type":"sources","sources":[{"id":"metar:KMSN","label":"KMSN METAR 1852Z","text":"KMSN 031852Z 27012KT 10SM CLR 18/07 A3012"}]}""",
        """{"type":"done"}""",
    )

    @Test
    fun eachKindOfLineIsRead() {
        val lines = stream.map { Assistant.decode(it) }
        assertEquals(AssistantLine.Tool("weather_at", "Checking the weather at KMSN"), lines[0])
        assertEquals(AssistantLine.Text("KMSN is "), lines[1])
        assertEquals(
            AssistantLine.Sources(listOf(AssistantSource("metar:KMSN", "KMSN METAR 1852Z", "KMSN 031852Z 27012KT 10SM CLR 18/07 A3012"))),
            lines[4],
        )
        assertEquals(AssistantLine.Done, lines[5])
        assertEquals(AssistantLine.Problem("The model is not reachable."), Assistant.decode("""{"type":"error","words":"The model is not reachable."}"""))
        assertNull(Assistant.decode("""{"type":"thinking","text":"…"}"""))
    }

    @Test
    fun theStreamBecomesOneAnswerWithItsSources() {
        var conversation = AssistantConversation().ask("What's the weather at KMSN?")
        assertTrue(conversation.answering)
        assertEquals(2, conversation.turns.size)
        for (line in stream) {
            val decoded = Assistant.decode(line) ?: continue
            conversation = conversation.take(decoded)
            // The tool's words stand only until the answer's text starts.
            if (decoded is AssistantLine.Tool) assertEquals("Checking the weather at KMSN", conversation.status)
            if (decoded is AssistantLine.Text) assertNull(conversation.status)
        }
        assertFalse(conversation.answering)
        val answer = conversation.turns[1]
        assertEquals(AssistantTurn.Role.ASSISTANT, answer.role)
        assertEquals("KMSN is VFR: wind 270 at 12, visibility 10, clear below 12,000.", answer.content)
        assertEquals(listOf("metar:KMSN"), answer.sources.map { it.id })
        assertNull(answer.problem)
        // The whole conversation goes back with the next question.
        val next = conversation.ask("And the crosswind?")
        assertEquals(listOf("What's the weather at KMSN?", answer.content, "And the crosswind?"), next.messages.map { it.content })
        assertEquals(listOf("user", "assistant", "user"), next.messages.map { it.role })
    }

    @Test
    fun anErrorLineIsSaidUnderTheAnswer() {
        val conversation = AssistantConversation().ask("Brief me")
            .take(Assistant.decode("""{"type":"text","text":"Winds aloft "}""")!!)
            .take(Assistant.decode("""{"type":"error","words":"The winds aloft could not be fetched."}""")!!)
        assertFalse(conversation.answering)
        assertEquals("Winds aloft ", conversation.turns.last().content)
        assertEquals("The winds aloft could not be fetched.", conversation.turns.last().problem)
        // An answer cut off before a word is not resent: the planner refuses an empty turn.
        val empty = AssistantConversation().ask("Brief me").broke(Assistant.NOT_HERE)
        assertEquals("The assistant isn't on this planner yet.", empty.turns.last().problem)
        assertEquals(listOf("Brief me"), empty.messages.map { it.content })
    }

    @Test
    fun aPlannerWithoutTheAssistantIsSaidSo() {
        assertEquals(Assistant.NOT_HERE, Assistant.words(Planner.Failure(404, "Not Found")))
        assertEquals("The model is busy.", Assistant.words(Planner.Failure(503, "The model is busy.")))
        assertEquals("The assistant could not be reached: timeout", Assistant.words(IOException("timeout")))
    }

    @Test
    fun theContextIsThePlannersSnakeCase() {
        val context = AssistantContext(
            dep = "C81", dest = "KMSN", aircraft = "c172", altitudeFt = 4500.0,
            ownShip = AssistantContext.OwnShipFix(42.3, -88.1, 4480.0, 300.0, 105.0),
            pilot = AssistantContext.PilotRecord(personalMinimums = mapOf("crosswind_kt" to 12.0), homeBase = "C81"),
        )
        val body = Gateway.json.encodeToString(Assistant.Ask(listOf(Assistant.Message("user", "Brief me")), context))
        assertTrue(body, body.contains(""""altitude_ft":4500.0"""))
        assertTrue(body, body.contains(""""own_ship":{"lat":42.3,"lon":-88.1,"altitude_ft":4480.0,"track_deg":300.0,"groundspeed_kt":105.0}"""))
        assertTrue(body, body.contains(""""personal_minimums":{"crosswind_kt":12.0}"""))
        assertTrue(body, body.contains(""""home_base":"C81""""))
        assertTrue(body, body.contains(""""messages":[{"role":"user","content":"Brief me"}]"""))
        // A null is left out, not sent as null (Gateway.json's explicitNulls).
        assertFalse(body, body.contains("depart"))
    }
}
