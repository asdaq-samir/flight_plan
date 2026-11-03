package app.wingtipmaps.android.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// The planner's answers the cycle packs give on the phone too (the
// engine's readers answer the planner's own shapes: AirspaceAt,
// AheadAlert, the in-view lists), by hand as Models.kt has the others,
// with the document's snake-case names carried by @SerialName. The
// iOS app's AirportExtras.swift and Models.swift have the same.

/** One region's phone pack (CyclePackRegion, vfr.pack's write_phone):
 *  its bounds in degrees, its size and its CRC-32, for the phone to check
 *  it whole. */
@Serializable
data class CyclePackRegion(
    val name: String,
    val west: Double,
    val south: Double,
    val east: Double,
    val north: Double,
    val bytes: Long,
    val crc32: Long,
)

/** The planner's list of the phones' packs of its FAA cycle
 *  (/api/cycle-packs, the planner's CyclePacks). */
@Serializable
data class CyclePackIndex(
    val cycle: String,
    @SerialName("built_at") val builtAt: Double,
    @SerialName("tolerance_deg") val toleranceDeg: Double,
    @SerialName("worst_nm") val worstNm: Double,
    @SerialName("region_deg") val regionDeg: Int,
    val regions: List<CyclePackRegion>,
)

/** A band of airspace over a point (AirspaceBand): the document's
 *  `class` is A to G. */
@Serializable
data class AirspaceBand(
    @SerialName("class") val airspaceClass: String,
    @SerialName("floor_ft") val floorFt: Double,
    @SerialName("ceiling_ft") val ceilingFt: Double,
    val entry: String,
    val name: String? = null,
    val equipment: String? = null,
    @SerialName("speed_kt") val speedKt: Int? = null,
)

/** A Class B's Mode C veil the point is in (ModeCVeil). */
@Serializable
data class ModeCVeil(
    val ident: String,
    @SerialName("distance_nm") val distanceNm: Double,
    val name: String? = null,
)

/** The point named off its nearest fix, "VPBNG/095/14.2" (PointOffFix). */
@Serializable
data class PointOffFix(
    val ident: String,
    val name: String,
    val base: String,
    @SerialName("course_deg") val courseDeg: Int,
    @SerialName("distance_nm") val distanceNm: Double,
    val radial: Boolean,
)

/** A special-use area over the point (SpecialUse), as the FAA's file has it. */
@Serializable
data class SpecialUse(
    val name: String,
    val kind: String,
    val type: String,
    @SerialName("floor_ft") val floorFt: Double? = null,
    @SerialName("floor_ref") val floorRef: String? = null,
    @SerialName("ceiling_ft") val ceilingFt: Double? = null,
    @SerialName("ceiling_ref") val ceilingRef: String? = null,
    @SerialName("times_of_use") val timesOfUse: String? = null,
    @SerialName("time_zone") val timeZone: String? = null,
    @SerialName("controlling_agency") val controllingAgency: String? = null,
)

/** A TFR over the point now or to come (TfrHere). */
@Serializable
data class TfrHere(
    @SerialName("notam_id") val notamId: String,
    @SerialName("active_now") val activeNow: Boolean,
    val kind: String? = null,
    val title: String? = null,
    val purpose: String? = null,
    val effective: String? = null,
    val expires: String? = null,
)

/** The airspace over a point (AirspaceAt): from the planner, or from the
 *  pack of its region on the phone (CyclePacks.airspaceAt). */
@Serializable
data class AirspaceAt(
    val lat: Double,
    val lon: Double,
    @SerialName("ground_ft") val groundFt: Double? = null,
    val bands: List<AirspaceBand>,
    @SerialName("mode_c_veil") val modeCVeil: ModeCVeil? = null,
    val point: PointOffFix? = null,
    @SerialName("special_use") val specialUse: List<SpecialUse>? = null,
    @SerialName("special_use_unavailable") val specialUseUnavailable: Boolean? = null,
    val tfrs: List<TfrHere>? = null,
    @SerialName("tfrs_unavailable") val tfrsUnavailable: Boolean? = null,
)

/** One thing ahead of the airplane (AheadAlert, vfr.alerts): airspace, a
 *  special-use area or a TFR its track goes into in the next five
 *  minutes, or the ground or an obstacle it comes within 500 ft of in the
 *  next minute. The planner's judgment (or the engine's, from the packs);
 *  the app says it. */
@Serializable
data class AheadAlert(
    val id: String,
    val kind: String,
    val level: String,
    val name: String,
    val need: String,
    val seconds: Double,
    @SerialName("distance_nm") val distanceNm: Double,
    val lat: Double,
    val lon: Double,
    val inside: Boolean? = false,
    @SerialName("class") val airspaceClass: String? = null,
    @SerialName("floor_ft") val floorFt: Double? = null,
    @SerialName("ceiling_ft") val ceilingFt: Double? = null,
    @SerialName("clearance_ft") val clearanceFt: Double? = null,
    @SerialName("notam_id") val notamId: String? = null,
)

/** What is ahead with no network (wt_ahead): the alerts, and the kinds
 *  that could not be judged on the phone (the obstacles are the
 *  planner's alone; the TFRs are not kept here yet), which are said to
 *  be missing, never read as clear. */
@Serializable
data class Ahead(
    val alerts: List<AheadAlert>,
    val unavailable: List<String> = emptyList(),
)
