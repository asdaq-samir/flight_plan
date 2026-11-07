package app.wingtipmaps.android.tiles

import app.wingtipmaps.android.Config

/**
 * Where a chart kind's tiles come from, as the web app has it
 * (web/src/lib/map/tiles.ts) and the iOS app's TileTemplate.swift:
 * published to a CDN they come straight from there with the cycle a path
 * segment; served by the planner itself, through the gateway, the cycle
 * is a cache-busting query. The revision rides along either way: tiles
 * rendered again within an edition keep their {z}/{x}/{y} and cycle.
 *
 * [scale] 2 is the pyramid's 512-pixel tile of the same z/x/y, named
 * {y}@2x.png: drawn from the FAA's sheet at twice the pixels for a phone's
 * 2x and 3x screens, where MapLibre stretched the 256-pixel tile to the
 * screen's density. The raster source keeps tileSize 256, so each tile
 * still covers 256 dp, now with two pixels or more to each. Only where the
 * kind was drawn at it (its layer's `scales`).
 */
data class TileTemplate(
    val cycle: String,
    val revision: Int,
    val tilesBase: String?,
    val kind: String,
    val scale: Int = 1,
) {
    fun url(z: Int, x: Int, y: Int): String = at(z.toString(), x.toString(), y.toString())

    /** The address with the map's own placeholders in it, for MapLibre's
     *  raster source, which fills them in per tile. */
    fun pattern(): String = at("{z}", "{x}", "{y}")

    private fun at(z: String, x: String, y: String): String {
        val density = if (scale == 1) "" else "@${scale}x"
        val base = tilesBase
        if (!base.isNullOrEmpty()) return "$base/$cycle/$kind/$z/$x/$y$density.png?r=$revision"
        return "${Config.gateway}/api/planner/chart-tile/$kind/$z/$x/$y$density.png?c=$cycle&r=$revision"
    }
}
