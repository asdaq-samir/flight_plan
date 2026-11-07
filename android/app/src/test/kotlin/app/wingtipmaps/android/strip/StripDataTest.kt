package app.wingtipmaps.android.strip

import app.wingtipmaps.android.Plan
import app.wingtipmaps.android.api.Leg
import app.wingtipmaps.android.api.Pilot
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The strip's rows and words from the planner's legs (StripData): the
 *  figures are the planner's, the order and the formats the web app's. */
class StripDataTest {
    private fun leg(from: String, to: String, nm: Double, mh: Double, ete: Double?, ground: Double? = null) = Leg(
        from = from, to = to, distanceNm = nm, altitudeFt = 4500.0, trueCourseDeg = mh, magneticHeadingDeg = mh,
        eteMin = ete, tasKt = 110.0, groundMin = ground,
    )

    private val state = Plan.State(
        dep = "C81", dest = "KDLH", stops = listOf("KJVL"), aircraft = "c172",
        legs = listOf(
            leg("C81", "Lake Geneva", 24.0, 318.0, 13.0),
            leg("Lake Geneva", "KJVL", 20.0, 300.0, 11.0, ground = 30.0),
            leg("KJVL", "Wisconsin Dells", 60.0, 330.0, 33.0),
            leg("Wisconsin Dells", "KDLH", 180.0, 335.0, 98.0),
        ),
    )

    @Test
    fun theRowsAreTheDepartureEachLegsEndAndTheDestination() {
        val rows = StripData.rows(state)
        assertEquals(listOf("dep", "cp1", "stop:KJVL:Lake Geneva", "cp2", "dest"), rows.map { it.key })
        val stop = rows[2] as StripRow.Stop
        assertEquals(24.0, stop.minutesFlown!!, 0.01)
        assertEquals(30.0, stop.groundMin!!, 0.01)
        // The ground time at the stop goes into the times after it.
        assertEquals(87.0, (rows[3] as StripRow.Checkpoint).minutesFlown!!, 0.01)
        assertEquals(185.0, (rows[4] as StripRow.Destination).minutesFlown!!, 0.01)
        assertEquals(2, (rows[3] as StripRow.Checkpoint).number)
        // Fields green, checkpoints brown, in order.
        assertEquals(listOf(true, false, true, false, true), StripData.ribbonPoints(rows).map { it.field })
        assertEquals(emptyList<StripRow>(), StripData.rows(Plan.State()))
    }

    @Test
    fun aLegThatCannotBeFlownLeavesTheTimesAfterItBlank() {
        val broken = state.copy(legs = state.legs.mapIndexed { i, l -> if (i == 2) l.copy(eteMin = null) else l })
        val rows = StripData.rows(broken)
        assertEquals(24.0, (rows[2] as StripRow.Stop).minutesFlown!!, 0.01)
        assertNull((rows[3] as StripRow.Checkpoint).minutesFlown)
        assertNull((rows[4] as StripRow.Destination).minutesFlown)
    }

    @Test
    fun theAirplaneIsPlacedAlongTheLegsByTheMilesFlown() {
        // A straight line north of 284 nm in four vertices; the airplane
        // beside the second vertex, 71 nm along: on the third leg (60 nm
        // from 44 nm), about 27 nm into it.
        val line = listOf(listOf(42.0, -88.0), listOf(43.18, -88.0), listOf(44.37, -88.0), listOf(46.73, -88.0))
        val at = StripData.positionAlong(line, state.legs, 43.2, -88.1)!!
        assertEquals(2, at.leg)
        assertEquals(0.45, at.along, 0.05)
        assertNull(StripData.positionAlong(line, state.legs, null, null))
        assertNull(StripData.positionAlong(emptyList(), state.legs, 43.0, -88.0))
    }

    @Test
    fun theWordsAreTheWebAppsFormats() {
        assertEquals("1h 5m", StripData.duration(65.0))
        assertEquals("45m", StripData.duration(45.0))
        assertEquals("3h", StripData.duration(180.0))
        assertEquals("0m", StripData.duration(0.2))
        assertEquals("FL-045", StripData.flightLevel(4500.0))
        assertEquals("FL-___", StripData.flightLevel(null))
        assertEquals("C81 → KJVL → KDLH", StripData.routeName("C81", "KDLH", listOf("KJVL")))
        assertEquals("KDLH local", StripData.routeName("KDLH", "KDLH", emptyList()))
        assertEquals("C81 → KJVL → KDLH · C172 · FL-045 · leaving now", StripData.headLine(state))
        assertNull(StripData.headLine(Plan.State()))
        assertEquals("118.3", StripData.mhzText(118.3))
        assertEquals("121.75", StripData.mhzText(121.75))
        assertEquals("MH 318 · 24 NM", StripData.legFigures(state.legs[0]))
        assertEquals("MH 000 · 24 NM", StripData.legFigures(state.legs[0].copy(magneticHeadingDeg = 359.6)))
        val utc = ZoneId.of("UTC")
        assertEquals("14:10", StripData.clockTime(1_762_265_400_000L, utc))
        assertEquals("15:15", StripData.timeAt(1_762_265_400_000L, 65.0, utc))
        assertNull(StripData.timeAt(0L, null, utc))
    }

    @Test
    fun thePilotsInitialsComeFromTheirNameOrTheirAddress() {
        assertEquals("AS", StripData.initialsOf(Pilot(displayName = "Asdaq Samir")))
        assertEquals("AS", StripData.initialsOf(Pilot(displayName = "asdaq")))
        assertEquals("P", StripData.initialsOf(Pilot(displayName = "pilot@example.com")))
        assertEquals("P", StripData.initialsOf(Pilot(email = "pilot@example.com")))
        assertEquals("", StripData.initialsOf(null))
    }

    @Test
    fun theSuggestionsFollowTheRoute() {
        assertEquals("Weather at KDLH", StripData.suggestions(state)[1])
        assertEquals("Nearest fuel", StripData.suggestions(Plan.State()).first())
    }
}
