package app.wingtipmaps.android.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString

/**
 * The nav log as the planner streams it (/api/navlog, newline-delimited
 * JSON, app.schemas.NavLogMessage): a "stage" line before each slow piece
 * of work, one "altitude" line once the altitudes are decided, one "leg"
 * line per leg, then "done" with the totals -- or "error" where no route
 * can be flown. Decoded by hand, as the iOS app's NavLog.swift does: a
 * stream is not an OpenAPI response.
 */
sealed interface NavLogMessage {
    data class Stage(val detail: String) : NavLogMessage

    /** The altitude flown; the four plans and the wheel's figures come
     *  with the altitude wheel, a later phase. */
    data class Altitude(val altitudeFt: Double?) : NavLogMessage

    data class OneLeg(val leg: Leg) : NavLogMessage

    data class Done(val totals: NavLogTotals) : NavLogMessage

    data class Problem(val error: NavLogError) : NavLogMessage
}

object NavLog {
    @Serializable
    private class Kind(val type: String)

    @Serializable
    private class StageLine(val detail: String = "")

    @Serializable
    private class AltitudeLine(@SerialName("altitude_ft") val altitudeFt: Double? = null)

    @Serializable
    private class DoneLine(val totals: NavLogTotals)

    /** One line of the stream, or null for a line of a kind the app has
     *  no use for yet. */
    fun decode(line: String): NavLogMessage? {
        val json = Gateway.json
        return when (json.decodeFromString<Kind>(line).type) {
            "stage" -> NavLogMessage.Stage(json.decodeFromString<StageLine>(line).detail)
            "altitude" -> NavLogMessage.Altitude(json.decodeFromString<AltitudeLine>(line).altitudeFt)
            "leg" -> NavLogMessage.OneLeg(json.decodeFromString<Leg>(line))
            "done" -> NavLogMessage.Done(json.decodeFromString<DoneLine>(line).totals)
            "error" -> NavLogMessage.Problem(json.decodeFromString<NavLogError>(line))
            else -> null
        }
    }
}
