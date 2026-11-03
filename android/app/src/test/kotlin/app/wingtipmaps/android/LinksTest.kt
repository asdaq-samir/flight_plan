package app.wingtipmaps.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The site's links as the app reads them (Links): the web app's own
 *  address for a route or a field, and the sign-in link. */
class LinksTest {
    @Test
    fun aRoutesLinkGivesItsEndsAndStopsAsThePlannerReadsThem() {
        val link = Links.parse("https://wingtipmaps.app/app/plan?dep=kugn&dest=KMSN&stops=kjvl,%20krfd&aircraft=c172")
        assertEquals(Links.Route("KUGN", "KMSN", listOf("KJVL", "KRFD")), link)
    }

    @Test
    fun aRouteWithNoStopsHasNone() {
        assertEquals(Links.Route("KUGN", "KMSN", emptyList()), Links.parse("https://wingtipmaps.app/app/plan?dep=KUGN&dest=KMSN&stops="))
    }

    @Test
    fun aFieldsLinkOpensItsCard() {
        assertEquals(Links.Place("KORD"), Links.parse("https://wingtipmaps.app/app/plan?place=kord"))
    }

    @Test
    fun theSignInLinkGivesItsToken() {
        assertEquals(Links.SignIn("abc123"), Links.parse("https://wingtipmaps.app/api/auth/magic-link/verify?token=abc123"))
    }

    @Test
    fun anythingElseIsNoLink() {
        assertNull(Links.parse(null))
        assertNull(Links.parse(""))
        assertNull(Links.parse("https://wingtipmaps.app/app/plan"))
        assertNull(Links.parse("https://wingtipmaps.app/app/plan?dep=KUGN"))
        assertNull(Links.parse("https://wingtipmaps.app/api/auth/magic-link/verify"))
        assertNull(Links.parse("https://wingtipmaps.app/about"))
    }
}
