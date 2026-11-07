package app.wingtipmaps.android.api

import android.content.Context
import app.wingtipmaps.android.Config
import java.io.File
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Cache
import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * The gateway's calls, by hand, as the iOS app's Gateway.swift has them:
 * its OpenAPI document gives them star-slash-star bodies, which a generated client
 * would hand over raw. One OkHttp client for the whole app, with the
 * session cookie the gateway sets kept by CookieStore, so a call made
 * after signing in is the pilot's, as in Chrome.
 */
object Gateway {
    /** The coder for the servers' JSON: a key not modelled is passed
     *  over, and a null is left out of a body. The planner's snake case
     *  is carried by each model's @SerialName (Models.kt). */
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private lateinit var app: Context

    /** The application, for the preferences and the cache's folder
     *  (WingtipApplication.onCreate); nothing is built until first used. */
    fun attach(context: Context) {
        app = context.applicationContext
    }

    val cookies: CookieStore by lazy { CookieStore(app.getSharedPreferences("cookies", Context.MODE_PRIVATE)) }

    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cookieJar(cookies)
            // A cache of the answers the gateway and the planner say may be
            // kept (Cache-Control: the chart's tiles for a cycle, the fields
            // and airspace of a box, a field's card for minutes), so a view
            // come back to is answered from the phone, and an answer with an
            // ETag is revalidated in one short round trip -- the same reason
            // as the iOS app's URLCache (the owner's ask for speed,
            // 2026-11-03). Sized for a flight's worth of tiles and answers;
            // the protocol's own policy, so an answer marked no-store is
            // never kept.
            .cache(Cache(File(app.cacheDir, "answers"), 256L shl 20))
            .build()
    }

    /** The gateway's own words for a refusal (ErrorResponse), where it
     *  sent any: "Invalid request" with each field's, or the instructor's
     *  rule. */
    class Refusal(val status: Int, val words: String?) : Exception(words ?: "The server answered $status.")

    /** The gateway's CSRF token, from the cookie it sets on every answer. */
    val csrfToken: String?
        get() = cookies.loadForRequest(Config.gateway.toHttpUrl()).firstOrNull { it.name == "XSRF-TOKEN" }?.value

    fun request(method: String, path: String, json: String? = null, form: Map<String, String>? = null): Request {
        val builder = Request.Builder().url(Config.gateway + path).header("Accept", "application/json")
        // Spring Security's CSRF check (SecurityConfig): every POST, PUT and
        // DELETE echoes the XSRF-TOKEN cookie the gateway set in a header,
        // as the web app's client does.
        if (method != "GET") csrfToken?.let { builder.header("X-XSRF-TOKEN", it) }
        val body: RequestBody? = when {
            json != null -> json.toRequestBody("application/json".toMediaType())
            form != null -> FormBody.Builder().apply { form.forEach { (name, value) -> add(name, value) } }.build()
            method == "GET" -> null
            // OkHttp wants a body on a POST, even an empty one (the logout).
            else -> ByteArray(0).toRequestBody(null)
        }
        return builder.method(method, body).build()
    }

    /** One call with the pilot's session: the answer's body and status.
     *  Every gateway call goes through here, and is refused through `send`
     *  or `read` in the gateway's own words. */
    suspend fun call(method: String, path: String, json: String? = null, form: Map<String, String>? = null): Pair<String, Int> =
        client.newCall(request(method, path, json, form)).await().use { response ->
            (response.body?.string() ?: "") to response.code
        }

    /** A call whose answer is read, or nothing where the server sends no
     *  body; refused outside `ok`, with the gateway's own words. */
    suspend fun send(method: String, path: String, json: String? = null, form: Map<String, String>? = null, ok: IntRange = 200..299): String {
        val (body, status) = call(method, path, json, form)
        if (status !in ok) throw Refusal(status, words(body))
        return body
    }

    /** A read that is nobody's when signed out: null for the statuses in
     *  `none` (401, 403 and 204 unless a call says otherwise). */
    suspend inline fun <reified T> read(path: String, none: Set<Int> = setOf(204, 401, 403)): T? {
        val (body, status) = call("GET", path)
        if (status == 200) return json.decodeFromString<T>(body)
        if (status in none) return null
        throw Refusal(status, words(body))
    }

    @Serializable
    private class ErrorBody(val error: String? = null, val details: List<String>? = null)

    fun words(body: String): String? {
        val read = runCatching { json.decodeFromString<ErrorBody>(body) }.getOrNull() ?: return null
        val error = read.error ?: return null
        val details = read.details.orEmpty()
        return if (details.isEmpty()) error else "$error: ${details.joinToString("; ")}"
    }

    /** The pilot signed in, or null (the gateway's 204) when no one is. */
    suspend fun me(): Pilot? = read("/api/me", none = setOf(204, 401))

    @Serializable
    private class MagicLinkRequest(val email: String)

    /** A sign-in link emailed to the pilot; the gateway answers 202
     *  whether or not the address is known. */
    suspend fun requestMagicLink(email: String) {
        send("POST", "/api/auth/magic-link", json = json.encodeToString(MagicLinkRequest(email)))
    }

    /** The link's one-time token, posted as the website's page posts it;
     *  the gateway answers with the session cookie and a redirect, which
     *  the client follows. */
    suspend fun verifyMagicLink(token: String) {
        send("POST", "/api/auth/magic-link/verify", form = mapOf("token" to token), ok = 200..399)
    }

    /** Spring Security's own logout, which answers 204. */
    suspend fun signOut() {
        call("POST", "/logout")
    }
}

/** An OkHttp call as a suspending one: the coroutine's cancellation
 *  cancels the call, so a screen left stops its fetch. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!continuation.isCancelled) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response)
        }
    })
    continuation.invokeOnCancellation { cancel() }
}
