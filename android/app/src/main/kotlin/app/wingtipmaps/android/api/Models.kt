package app.wingtipmaps.android.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The planner's answers the app reads (planning-service/openapi.json,
// app.schemas), by hand, as the iOS app's Models.swift has them: the
// document's snake-case names carried by @SerialName, a field the document
// marks nullable optional here, and only the properties a screen shows
// listed -- the coder passes over the rest, and a screen adds what it
// needs. Every figure in them is the planner's; the app shows it.

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

/** One kind of FAA chart and the zooms it has tiles for (ChartLayer). */
@Serializable
data class ChartLayer(
    val kind: String,
    val label: String,
    val base: Boolean = false,
    @SerialName("min_zoom") val minZoom: Int,
    @SerialName("max_zoom") val maxZoom: Int,
    val over: List<String> = emptyList(),
)

/** Which chart the map draws and where its tiles are (ChartInfo). */
@Serializable
data class ChartInfo(
    @SerialName("chart_cycle") val chartCycle: String,
    @SerialName("chart_revision") val chartRevision: Int? = 0,
    @SerialName("chart_tiles_base") val chartTilesBase: String? = null,
    @SerialName("chart_layers") val chartLayers: List<ChartLayer>,
    @SerialName("min_zoom") val minZoom: Int,
    @SerialName("max_zoom") val maxZoom: Int,
)

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

/** A field found by ident or name (AirportSuggestion). */
@Serializable
data class AirportSuggestion(
    val ident: String,
    val name: String,
    val kind: String? = null,
    val municipality: String? = null,
    val region: String? = null,
)

/** A METAR as the planner reads it, with the report as sent (Metar). */
@Serializable
data class Metar(
    val raw: String? = null,
    @SerialName("observed_at") val observedAt: String? = null,
    @SerialName("flight_category") val flightCategory: String? = null,
    @SerialName("wind_dir_true_deg") val windDirTrueDeg: Double? = null,
    @SerialName("wind_speed_kt") val windSpeedKt: Double? = null,
    @SerialName("wind_gust_kt") val windGustKt: Double? = null,
    @SerialName("visibility_sm") val visibilitySm: Double? = null,
    @SerialName("ceiling_ft") val ceilingFt: Double? = null,
    @SerialName("temp_c") val tempC: Double? = null,
    @SerialName("dewpoint_c") val dewpointC: Double? = null,
    @SerialName("altimeter_in_hg") val altimeterInHg: Double? = null,
)

/** A field's card (AirportPlace): the part of it the Airport tab shows. */
@Serializable
data class AirportPlace(
    val ident: String,
    val name: String,
    val lat: Double,
    val lon: Double,
    val kind: String,
    val towered: Boolean = false,
    @SerialName("elevation_ft") val elevationFt: Double? = null,
    val municipality: String? = null,
    val region: String? = null,
    @SerialName("airspace_class") val airspaceClass: String? = null,
    val military: String? = null,
    val phone: String? = null,
    val metar: Metar? = null,
)

/** A route's two ends and its stops, as /api/course gives them (AirportEnd). */
@Serializable
data class CourseEnd(
    val ident: String,
    val name: String,
    val lat: Double,
    val lon: Double,
    val kind: String? = null,
    @SerialName("elevation_ft") val elevationFt: Double? = null,
)

/** The route as entered, its ends found and the line between them (Course). */
@Serializable
data class Course(
    val departure: CourseEnd,
    val destination: CourseEnd,
    val stops: List<CourseEnd>? = null,
    @SerialName("distance_nm") val distanceNm: Double,
    @SerialName("bearing_deg") val bearingDeg: Double,
    /** The great-circle line as pairs of latitude and longitude. */
    @SerialName("course_line") val courseLine: List<List<Double>>,
    @SerialName("checkpoints_ready") val checkpointsReady: Boolean? = null,
)

/** One of the planner's airplane types and the handbook figures it flies
 *  on (AircraftProfile, data/aircraft/*.json). */
@Serializable
data class AircraftProfile(
    val name: String,
    val type: String? = null,
    val designator: String? = null,
    @SerialName("cruise_tas_kt") val cruiseTasKt: Double,
    @SerialName("fuel_burn_gph") val fuelBurnGph: Double,
    @SerialName("service_ceiling_ft") val serviceCeilingFt: Double,
    @SerialName("usable_fuel_gal") val usableFuelGal: Double? = null,
    @SerialName("cruise_power_pct") val cruisePowerPct: Double? = null,
    @SerialName("climb_tas_kt") val climbTasKt: Double? = null,
)

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
