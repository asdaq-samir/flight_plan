package app.wingtipmaps.android

import app.wingtipmaps.android.api.NavLog
import app.wingtipmaps.android.api.NavLogMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The nav log's lines read into the models (NavLog, Models.kt), from
 *  lines shaped as the planner sends them (app.schemas.NavLogMessage). */
class ModelsTest {
    @Test
    fun aLegLineIsReadWithItsFiguresAndItsWind() {
        val line = """{"type":"leg","from":"KUGN","to":"KENW","distance_nm":12.3,"altitude_ft":3500,""" +
            """"true_course_deg":354.2,"magnetic_heading_deg":350,"wca_deg":-2,"true_heading_deg":352.2,""" +
            """"magnetic_variation_deg":-3.1,"groundspeed_kt":105,"ete_min":7.0,"fuel_gal":1.0,"tas_kt":110,""" +
            """"wind":{"direction_deg":270,"speed_kt":10},"toc":{"along_nm":4.2}}"""
        val message = NavLog.decode(line)
        assertTrue(message is NavLogMessage.OneLeg)
        val leg = (message as NavLogMessage.OneLeg).leg
        assertEquals("KUGN", leg.from)
        assertEquals("KENW", leg.to)
        assertEquals(12.3, leg.distanceNm, 1e-9)
        assertEquals(3500.0, leg.altitudeFt, 1e-9)
        assertEquals(350.0, leg.magneticHeadingDeg, 1e-9)
        assertEquals(7.0, leg.eteMin!!, 1e-9)
        assertEquals(270.0, leg.wind?.directionDeg!!, 1e-9)
        assertNull(leg.climbMin)
    }

    @Test
    fun theDoneLineGivesTheTotalsAndTheFuelCheck() {
        val line = """{"type":"done","totals":{"distance_nm":98.4,"ete_min":58.5,"fuel_gal":8.4,""" +
            """"fuel_required_gal":12.6,"fuel_margin_gal":27.4,"usable_fuel_gal":40,"night":false,"fuel_stops":[]}}"""
        val message = NavLog.decode(line)
        assertTrue(message is NavLogMessage.Done)
        val totals = (message as NavLogMessage.Done).totals
        assertEquals(98.4, totals.distanceNm!!, 1e-9)
        assertEquals(58.5, totals.eteMin!!, 1e-9)
        assertEquals(8.4, totals.fuelGal!!, 1e-9)
        assertEquals(27.4, totals.fuelMarginGal!!, 1e-9)
        assertEquals(false, totals.night)
    }

    @Test
    fun anErrorLineIsThePlannersWordsAndAStageLineItsProgress() {
        val error = NavLog.decode("""{"type":"error","detail":"KXXX is not a known airport.","reasons":["No such ident."]}""")
        assertEquals("KXXX is not a known airport.", (error as NavLogMessage.Problem).error.detail)
        assertEquals(listOf("No such ident."), error.error.reasons)
        val stage = NavLog.decode("""{"type":"stage","detail":"Reading the chart…"}""")
        assertEquals(NavLogMessage.Stage("Reading the chart…"), stage)
        // A kind the app has no use for yet is passed over, not refused.
        assertNull(NavLog.decode("""{"type":"checkpoints","selected":[]}"""))
    }
}
