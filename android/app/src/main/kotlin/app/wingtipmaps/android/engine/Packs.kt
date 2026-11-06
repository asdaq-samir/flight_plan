package app.wingtipmaps.android.engine

import java.nio.ByteBuffer

/**
 * The engine's readers of the cycle packs (native/ffi's wt_airspace_at,
 * wt_ahead and the in-view functions), through the JNI shim's second
 * part (src/main/cpp/wingtip_jni.c, "The packs kept on the phone"). A
 * pack is a direct ByteBuffer over its memory-mapped file (CyclePacks
 * maps them), read in place for the one call and never copied, as the
 * iPhone passes Data(.alwaysMapped). Every reader answers the planner's
 * own JSON, or null where the bytes are no pack; the decoding is
 * CyclePacks' and InView's, so this object is only the externals, as
 * Engine.kt is for wt_call.
 */
object Packs {
    init {
        // The one shared library Engine loads too; loading it twice is
        // nothing, and this object may be the first to want it.
        System.loadLibrary("wingtip_jni")
    }

    /** wt_pack_verify: 1 every byte as written, 0 not, -1 no pack. */
    @JvmStatic
    external fun verify(pack: ByteBuffer): Int

    /** wt_pack_cycle: the pack's cycle, "YYYY-MM-DD"; null where it is no pack. */
    @JvmStatic
    external fun cycle(pack: ByteBuffer): String?

    /** wt_airspace_at: the airspace over a point (AirspaceAt) from one
     *  pack, or from the rules alone with a null pack; groundFt NaN where
     *  not known. */
    @JvmStatic
    external fun airspaceAt(pack: ByteBuffer?, lat: Double, lon: Double, groundFt: Double): String?

    /** wt_ahead: the alerts ahead from the packs round the airplane (the
     *  planner's /api/airspace/ahead answer); altFt NaN where not known,
     *  tfrs the kept TFRs a tab-separated line each or null, got at
     *  tfrsAt (Long.MIN_VALUE not known). */
    @JvmStatic
    external fun ahead(
        packs: Array<ByteBuffer>, lat: Double, lon: Double, trackDeg: Double, gsKt: Double, altFt: Double, vsFpm: Double,
        now: Long, tfrs: String?, tfrsAt: Long,
    ): String?

    /** wt_airspace_in_view: the Class B, C and D reaching into the box
     *  (AirspaceInView). */
    @JvmStatic
    external fun airspaceInView(packs: Array<ByteBuffer>, south: Double, west: Double, north: Double, east: Double): String?

    /** wt_airports_in_view: the landing fields in the box, biggest first
     *  (AirportsInView). */
    @JvmStatic
    external fun airportsInView(packs: Array<ByteBuffer>, south: Double, west: Double, north: Double, east: Double): String?

    /** wt_navaids_in_view: the VORs in the box by ident (NavaidsInView). */
    @JvmStatic
    external fun navaidsInView(packs: Array<ByteBuffer>, south: Double, west: Double, north: Double, east: Double): String?
}
