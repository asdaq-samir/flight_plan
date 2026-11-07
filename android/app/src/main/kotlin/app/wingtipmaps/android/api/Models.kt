package app.wingtipmaps.android.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The planner's answers the app reads (planning-service/openapi.json,
// app.schemas), as the iOS app's Models.swift has them. Most are generated
// from the document into api/generated/PlannerModels.kt
// (scripts/api-models-apps.sh), as the web's types are, so a field the
// planner renames fails the build rather than a screen; the names the app
// has always used are typealiases of them here. The document's snake-case
// names are carried by @SerialName, and a field the document marks
// nullable or leaves out is optional. Every figure in them is the
// planner's; the app shows it.
//
// Still by hand: the pilot (the gateway's PilotDto, every field optional
// so a screen can show a pilot from what it has), AirportPin (the engine
// writes it from the cycle packs too), and the nav log's lines (NavLog.kt
// reads the stream's kinds by hand).

/** The pilot, as the gateway knows them (PilotDto); the gateway's JSON is
 *  camel case already. */
@Serializable
data class Pilot(
    val id: Long? = null,
    val email: String? = null,
    val displayName: String? = null,
    val fullName: String? = null,
    val homeBase: String? = null,
    val phone: String? = null,
    val developer: Boolean? = null,
)

/** Which chart the map draws and where its tiles are, and each kind of
 *  FAA chart with the zooms it has tiles for. */
typealias ChartInfo = app.wingtipmaps.android.api.generated.ChartInfo
typealias ChartLayer = app.wingtipmaps.android.api.generated.ChartLayer

/** A field in the map's view (AirportPin). */
@Serializable
data class AirportPin(
    val ident: String,
    val name: String,
    val lat: Double,
    val lon: Double,
    val kind: String,
    @SerialName("flight_category") val flightCategory: String? = null,
    @SerialName("airspace_class") val airspaceClass: String? = null,
    val military: String? = null,
    @SerialName("private") val isPrivate: Boolean? = false,
)



/** A field found by ident or name. */
typealias AirportSuggestion = app.wingtipmaps.android.api.generated.AirportSuggestion

/** A METAR as the planner reads it, with the report as sent. */
typealias Metar = app.wingtipmaps.android.api.generated.Metar

/** A field's card: its weather, runways, frequencies and pattern. */
typealias AirportPlace = app.wingtipmaps.android.api.generated.AirportPlace

/** A route's two ends and its stops, as /api/course gives them
 *  (AirportEnd), and the route as entered with the great-circle line
 *  between them as pairs of latitude and longitude (Course). */
typealias CourseEnd = app.wingtipmaps.android.api.generated.AirportEnd
typealias Course = app.wingtipmaps.android.api.generated.Course

/** One of the planner's airplane types and the handbook figures it flies
 *  on (AircraftProfile, the JSON files under data/aircraft). */
typealias AircraftProfile = app.wingtipmaps.android.api.generated.AircraftProfile

/** One leg of the nav log, with the figures its row shows (Leg). */
@Serializable
data class Leg(
    val from: String,
    val to: String,
    @SerialName("distance_nm") val distanceNm: Double,
    @SerialName("altitude_ft") val altitudeFt: Double,
    @SerialName("true_course_deg") val trueCourseDeg: Double,
    @SerialName("magnetic_heading_deg") val magneticHeadingDeg: Double,
    @SerialName("wca_deg") val wcaDeg: Double = 0.0,
    @SerialName("true_heading_deg") val trueHeadingDeg: Double = 0.0,
    @SerialName("magnetic_variation_deg") val magneticVariationDeg: Double = 0.0,
    @SerialName("climb_min") val climbMin: Double? = null,
    @SerialName("groundspeed_kt") val groundspeedKt: Double? = null,
    @SerialName("ete_min") val eteMin: Double? = null,
    @SerialName("fuel_gal") val fuelGal: Double? = null,
    @SerialName("tas_kt") val tasKt: Double,
    val wind: Wind? = null,
    /** Into a stop landed at: the minutes on the ground there before the
     *  next leg (Leg.ground_min). */
    @SerialName("ground_min") val groundMin: Double? = null,
) {
    @Serializable
    data class Wind(
        @SerialName("direction_deg") val directionDeg: Double? = null,
        @SerialName("speed_kt") val speedKt: Double? = null,
    )
}

/** The flight's totals and its fuel check (navlog.totals, fuel_plan): the
 *  reserve it is held to is the planner's (14 CFR 91.151, in the planner). */
@Serializable
data class NavLogTotals(
    @SerialName("distance_nm") val distanceNm: Double? = null,
    @SerialName("ete_min") val eteMin: Double? = null,
    @SerialName("fuel_gal") val fuelGal: Double? = null,
    @SerialName("fuel_required_gal") val fuelRequiredGal: Double? = null,
    @SerialName("fuel_margin_gal") val fuelMarginGal: Double? = null,
    @SerialName("usable_fuel_gal") val usableFuelGal: Double? = null,
    val night: Boolean? = null,
)

/** Why no route can be flown, in the planner's words (the "error" line). */
@Serializable
data class NavLogError(
    val detail: String,
    val brief: String? = null,
    val reasons: List<String>? = null,
    val advice: String? = null,
    @SerialName("class_b") val classB: Boolean? = false,
)
