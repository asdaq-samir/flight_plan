package app.wingtipmaps.android

import app.wingtipmaps.android.records.Keeping
import app.wingtipmaps.android.records.KeptAirplane
import app.wingtipmaps.android.records.PlannedRoute
import app.wingtipmaps.android.records.WatchKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules of the records' lists (Keeping), held without a database:
 *  the project has no Robolectric, and Room's own tests run on the
 *  emulator. A favourite that is also recent is one row; the Recents are
 *  a dozen, newest first; a row in no list goes; a route planned again
 *  moves to the top. */
class RecordsTest {
    private fun plane(hex: String, favorite: Boolean = false, recent: Boolean = false, addedAt: Long = 0, recentAt: Long? = null) =
        KeptAirplane(hex = hex, name = hex.uppercase(), favorite = favorite, recent = recent, addedAt = addedAt, recentAt = recentAt)

    @Test
    fun favoritesKeepTheirOrderAndRecentsAreNewestFirst() {
        val rows = listOf(
            plane("a", favorite = true, addedAt = 2),
            plane("b", favorite = true, recent = true, addedAt = 1, recentAt = 10),
            plane("c", recent = true, recentAt = 20),
        )
        assertEquals(listOf("b", "a"), Keeping.favorites(rows).map { it.hex })
        assertEquals(listOf("c", "b"), Keeping.recents(rows).map { it.hex })
    }

    @Test
    fun anAirplaneRememberedIsOneRowWithBothFlags() {
        val rows = listOf(plane("a", favorite = true, addedAt = 1))
        val changes = Keeping.remembered(rows, "a", "N1", "C172", nowMs = 50)
        val (before, after) = changes.single()
        assertEquals("a", before.hex)
        assertTrue(after!!.favorite)
        assertTrue(after.recent)
        assertEquals(50L, after.recentAt)
        assertEquals("C172", after.type)
    }

    @Test
    fun theOldestBeyondADozenLeaveTheRecentsAndTheStoreWhereOnlyRecent() {
        val rows = (1..Keeping.RECENTS).map { plane("p$it", recent = true, recentAt = it.toLong()) } +
            plane("fav", favorite = true, recent = true, addedAt = 0, recentAt = 0)
        val changes = Keeping.remembered(rows, "new", "NEW", null, nowMs = 100)
        // The new row, and the two oldest Recents (p1 and the favourite).
        assertEquals(3, changes.size)
        val gone = changes.filter { it.second == null }.map { it.first.hex }
        assertEquals(listOf("p1"), gone)
        val kept = changes.first { it.first.hex == "fav" }.second!!
        assertTrue(kept.favorite)
        assertTrue(!kept.recent)
    }

    @Test
    fun aRowInNoListIsNoRow() {
        assertNull(Keeping.pruned(plane("a")))
        assertEquals("a", Keeping.pruned(plane("a", favorite = true))?.hex)
    }

    @Test
    fun aRoutePlannedAgainMovesToTheTopRatherThanRepeat() {
        val rows = listOf(PlannedRoute(id = 1, dep = "KUGN", dest = "KMSN", stopsLine = "KJVL", altitudeFt = 4500.0, plannedAt = 10))
        val (row, gone) = Keeping.planned(rows, "KUGN", "KMSN", listOf("KJVL"), 4500.0, "own", atMs = 20)
        assertEquals(1L, row.id)
        assertEquals(20L, row.plannedAt)
        assertEquals("own", row.altitudeChoice)
        assertTrue(gone.isEmpty())
        val (other, _) = Keeping.planned(rows, "KUGN", "KMSN", listOf("KJVL"), 5500.0, null, atMs = 30)
        assertEquals(0L, other.id)
    }

    @Test
    fun theRoutesStayAtTheirLimit() {
        val rows = (1..Keeping.ROUTES).map { PlannedRoute(id = it.toLong(), dep = "A$it", dest = "B", stopsLine = "", plannedAt = it.toLong()) }
        val (_, gone) = Keeping.planned(rows, "NEW", "B", emptyList(), null, null, atMs = 1000)
        assertEquals(listOf(1L), gone)
    }

    @Test
    fun aWatchKindANewerBuildWroteIsNotKnown() {
        assertEquals(WatchKind.LAND, WatchKind.of("land"))
        assertNull(WatchKind.of("overfly"))
    }
}
