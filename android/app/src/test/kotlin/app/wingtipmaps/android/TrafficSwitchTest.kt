package app.wingtipmaps.android

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import app.wingtipmaps.android.flight.TrafficSwitch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.io.path.createTempDirectory

/** Setup's Traffic switch (TrafficSwitch) on a real DataStore file: on
 *  until turned off, as the app has always started, and the pilot's
 *  choice kept for the next launch. */
class TrafficSwitchTest {
    private val dir = createTempDirectory("traffic").toFile()
    private val io = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val store = PreferenceDataStoreFactory.create(scope = io) { File(dir, "settings.preferences_pb") }

    @After
    fun tearDown() {
        io.cancel()
        dir.deleteRecursively()
    }

    @Test
    fun onUntilTurnedOff() = runBlocking {
        val switch = TrafficSwitch(store, this)
        switch.loaded.join()
        assertTrue(switch.on.value)
    }

    @Test
    fun theChoiceIsKeptForTheNextLaunch() = runBlocking {
        val first = TrafficSwitch(store, this)
        first.loaded.join()
        first.set(false).join()
        assertFalse(first.on.value)
        assertEquals(false, store.data.first()[TrafficSwitch.KEY])

        val next = TrafficSwitch(store, this)
        next.loaded.join()
        assertFalse(next.on.value)

        next.set(true).join()
        assertTrue(next.on.value)
        assertEquals(true, store.data.first()[TrafficSwitch.KEY])
    }

    @Test
    fun aChoiceMadeBeforeTheReadLandsWins() = runBlocking {
        TrafficSwitch(store, this).set(false).join()
        val switch = TrafficSwitch(store, this)
        // Turned on before the kept "off" is read: the read must not undo it.
        switch.set(true).join()
        switch.loaded.join()
        assertTrue(switch.on.value)
    }
}
