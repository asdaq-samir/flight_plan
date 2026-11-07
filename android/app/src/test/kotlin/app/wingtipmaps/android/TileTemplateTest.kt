package app.wingtipmaps.android

import app.wingtipmaps.android.tiles.TileTemplate
import org.junit.Assert.assertEquals
import org.junit.Test

/** The tile address's two shapes, as web/src/lib/map/tiles.ts and the
 *  iOS app's TileTemplate write them. */
class TileTemplateTest {
    @Test
    fun aPublishedChartComesFromItsCdnWithTheCycleInThePath() {
        val template = TileTemplate(cycle = "2025-10-30", revision = 3, tilesBase = "https://tiles.example.com/charts", kind = "sec")
        assertEquals("https://tiles.example.com/charts/2025-10-30/sec/7/32/47.png?r=3", template.url(7, 32, 47))
        assertEquals("https://tiles.example.com/charts/2025-10-30/sec/{z}/{x}/{y}.png?r=3", template.pattern())
    }

    @Test
    fun theSharpTilesAreTheSameAddressWithAt2x() {
        val template = TileTemplate("2025-10-30", 3, "https://tiles.example.com/charts", "sec", scale = 2)
        assertEquals("https://tiles.example.com/charts/2025-10-30/sec/{z}/{x}/{y}@2x.png?r=3", template.pattern())
        assertEquals(
            "${Config.gateway}/api/planner/chart-tile/sec/7/32/47@2x.png?c=2025-10-30&r=3",
            TileTemplate("2025-10-30", 3, null, "sec", scale = 2).url(7, 32, 47),
        )
    }

    @Test
    fun aChartThePlannerServesComesThroughTheGatewayWithTheCycleAsAQuery() {
        val gateway = "${Config.gateway}/api/planner/chart-tile/tac/7/32/47.png?c=2025-10-30&r=3"
        assertEquals(gateway, TileTemplate("2025-10-30", 3, null, "tac").url(7, 32, 47))
        // An empty base is no base, as the planner sends it before a CDN is set.
        assertEquals(gateway, TileTemplate("2025-10-30", 3, "", "tac").url(7, 32, 47))
    }
}
