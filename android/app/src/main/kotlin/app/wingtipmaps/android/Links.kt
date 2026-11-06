package app.wingtipmaps.android

import java.net.URI
import java.net.URLDecoder

/**
 * The site's links the app opens in place of Chrome (App Links, the
 * manifest): the sign-in link emailed to the pilot, and the web app's own
 * address for a route or a field (`/app/plan?dep=&dest=&stops=`,
 * `?place=`). Read with the JVM's own URI, not Android's, so a unit test
 * reads them too.
 */
object Links {
    sealed interface Link

    /** The sign-in link's one-time token (Session.open). */
    data class SignIn(val token: String) : Link

    /** A route to plan, its idents as the planner reads them. */
    data class Route(val dep: String, val dest: String, val stops: List<String>) : Link

    /** A field to open in the Airport tab. */
    data class Place(val ident: String) : Link

    fun parse(url: String?): Link? {
        if (url.isNullOrBlank()) return null
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        val path = uri.path ?: return null
        val query = query(uri.rawQuery)
        if (path.endsWith("/api/auth/magic-link/verify")) {
            return query["token"]?.takeIf { it.isNotEmpty() }?.let { SignIn(it) }
        }
        if (path != "/app/plan" && !path.startsWith("/app/plan/")) return null
        val dep = ident(query["dep"])
        val dest = ident(query["dest"])
        // A route is the address's main thing: with both ends it is
        // planned; a field alone opens its card.
        if (dep.isNotEmpty() && dest.isNotEmpty()) {
            val stops = query["stops"].orEmpty().split(",").map { ident(it) }.filter { it.isNotEmpty() }
            return Route(dep, dest, stops)
        }
        val place = ident(query["place"])
        return if (place.isNotEmpty()) Place(place) else null
    }

    private fun ident(text: String?): String = text.orEmpty().trim().uppercase()

    private fun query(raw: String?): Map<String, String> =
        raw.orEmpty().split("&").filter { it.isNotEmpty() }.associate { part ->
            val at = part.indexOf('=')
            val name = if (at < 0) part else part.substring(0, at)
            val value = if (at < 0) "" else part.substring(at + 1)
            URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
        }
}
