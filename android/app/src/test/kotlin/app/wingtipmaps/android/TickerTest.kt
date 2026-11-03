package app.wingtipmaps.android

import app.wingtipmaps.android.flight.Ticker
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** The app's one clock (Ticker) on virtual time: work runs at once and
 *  then every interval, twice as slowly with the app put away, catches
 *  up when it comes back, and the loop ends with the last registration. */
@OptIn(ExperimentalCoroutinesApi::class)
class TickerTest {
    @Test
    fun workRunsNowAndThenEveryInterval() = runTest {
        val ticker = Ticker(this) { testScheduler.currentTime }
        var runs = 0
        val item = ticker.every(5_000) { runs += 1 }
        runCurrent()
        assertEquals(1, runs)
        advanceTimeBy(5_001)
        assertEquals(2, runs)
        advanceTimeBy(10_000)
        assertEquals(4, runs)
        item.cancel()
        advanceTimeBy(20_000)
        assertEquals(4, runs)
        assertEquals(0, ticker.count)
    }

    @Test
    fun intervalsDoubleInTheBackgroundAndCatchUpInFront() = runTest {
        val ticker = Ticker(this) { testScheduler.currentTime }
        var runs = 0
        val item = ticker.every(5_000) { runs += 1 }
        runCurrent()
        ticker.background = true
        // The next run was due at 5 s; it runs, and the one after is 10 s on.
        advanceTimeBy(5_001)
        assertEquals(2, runs)
        advanceTimeBy(5_000)
        assertEquals(2, runs)
        advanceTimeBy(5_001)
        assertEquals(3, runs)
        // Back in front at once: nothing waits longer than its interval.
        ticker.background = false
        advanceTimeBy(5_001)
        assertEquals(4, runs)
        item.cancel()
    }

    @Test
    fun twoRegistrationsRunOnTheirOwnIntervals() = runTest {
        val ticker = Ticker(this) { testScheduler.currentTime }
        var fast = 0
        var slow = 0
        val a = ticker.every(1_000) { fast += 1 }
        val b = ticker.every(3_000) { slow += 1 }
        advanceTimeBy(6_001)
        assertEquals(7, fast)
        assertEquals(3, slow)
        a.cancel()
        b.cancel()
    }
}
