// To parse the JSON, install kotlin's serialization plugin and do:
//
// val json                = Json { allowStructuredMapKeys = true }
// val trafficMarksAnswer  = json.parse(TrafficMarksAnswer.serializer(), jsonString)
// val alertFiresAnswer    = json.parse(AlertFiresAnswer.serializer(), jsonString)
// val altitudeLinesAnswer = json.parse(AltitudeLinesAnswer.serializer(), jsonString)

package app.wingtipmaps.android.engine

import kotlinx.serialization.*
import kotlinx.serialization.json.*
import kotlinx.serialization.descriptors.*
import kotlinx.serialization.encoding.*


@Serializable
data class TrafficMarksAnswerElement (
    val label: String,
    val near: Boolean
)

@Serializable
data class AlertFiresAnswer (
    /**
     * True bearing from the place to the airplane.
     */
    @SerialName("bearing_deg")
    val bearingDeg: Double? = null,

    val fires: Boolean,

    /**
     * Near something: whether it is that near now; null for the others.
     */
    val inside: Boolean? = null,

    val nm: Double? = null
)

@Serializable
data class AltitudeLinesAnswer (
    val crossing: Crossing? = null,
    val lines: List<Line>
)

@Serializable
enum class Crossing(val value: String) {
    @SerialName("at") At("at"),
    @SerialName("at_or_above") AtOrAbove("at_or_above"),
    @SerialName("at_or_below") AtOrBelow("at_or_below"),
    @SerialName("between") Between("between");
}

@Serializable
data class Line (
    val ft: Double,
    val over: Boolean,
    val under: Boolean
)
