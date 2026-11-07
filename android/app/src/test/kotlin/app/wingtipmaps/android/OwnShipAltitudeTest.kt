package app.wingtipmaps.android

import app.wingtipmaps.android.flight.OwnShip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Own ship's altitude is height above mean sea level or none: the fix's
 *  ellipsoid height (Location.getAltitude) is never put in its place. */
class OwnShipAltitudeTest {
    @Test
    fun metresAboveSeaLevelInFeet() {
        // 1,000 m is 3,280.84 ft (1 ft = 0.3048 m exactly).
        assertEquals(3280.84, OwnShip.mslFeet(1000.0)!!, 0.01)
    }

    @Test
    fun noSeaLevelAltitudeIsNone() {
        assertNull(OwnShip.mslFeet(null))
    }
}
