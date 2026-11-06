package app.wingtipmaps.android.api

import android.content.SharedPreferences
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * The cookies the gateway sets, kept on the phone: the session cookie is
 * the sign-in itself, and the XSRF-TOKEN cookie is echoed on every write
 * (Gateway). OkHttp keeps no cookies on its own, so this jar does, in the
 * app's preferences, as iOS's HTTPCookieStorage keeps the iOS app's. A
 * cookie with no expiry is kept too: a phone's app is never "closed" the
 * way a browser window is, and the pilot expects to stay signed in. Only
 * cookies, no secret of the app's own.
 */
class CookieStore(private val prefs: SharedPreferences) : CookieJar {
    @Serializable
    private data class Kept(
        val name: String,
        val value: String,
        val domain: String,
        val path: String,
        val expiresAt: Long,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean,
    ) {
        constructor(cookie: Cookie) : this(
            cookie.name, cookie.value, cookie.domain, cookie.path, cookie.expiresAt,
            cookie.secure, cookie.httpOnly, cookie.hostOnly,
        )

        fun cookie(): Cookie {
            val builder = Cookie.Builder().name(name).value(value).expiresAt(expiresAt).path(path)
            if (hostOnly) builder.hostOnlyDomain(domain) else builder.domain(domain)
            if (secure) builder.secure()
            if (httpOnly) builder.httpOnly()
            return builder.build()
        }
    }

    private val kept = HashMap<String, Cookie>()

    init {
        val saved = prefs.getString(KEY, null)
        if (saved != null) {
            runCatching { Gateway.json.decodeFromString<List<Kept>>(saved) }.getOrNull()?.forEach { k ->
                runCatching { k.cookie() }.getOrNull()?.let { kept[key(it)] = it }
            }
        }
    }

    /** One slot per name, domain and path, as a browser keeps them. */
    private fun key(cookie: Cookie) = "${cookie.name}|${cookie.domain}|${cookie.path}"

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        for (cookie in cookies) {
            // A cookie set in the past is the server deleting it (a sign-out).
            if (cookie.expiresAt <= now) kept.remove(key(cookie)) else kept[key(cookie)] = cookie
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        kept.values.removeAll { it.expiresAt <= now }
        return kept.values.filter { it.matches(url) }
    }

    /** Everything forgotten: the account deleted, in a later phase. */
    @Synchronized
    fun clear() {
        kept.clear()
        persist()
    }

    private fun persist() {
        val text = Gateway.json.encodeToString(kept.values.map { Kept(it) })
        prefs.edit().putString(KEY, text).apply()
    }

    private companion object {
        const val KEY = "cookies"
    }
}
