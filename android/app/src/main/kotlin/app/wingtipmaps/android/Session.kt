package app.wingtipmaps.android

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.wingtipmaps.android.api.Gateway
import app.wingtipmaps.android.api.Pilot
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Who is signed in, and the way in: the emailed link, which opens the
 * app (docs/NATIVE-ANDROID.md: Google refuses to sign in inside an app's web
 * view, and Sign in with Apple's sheet is iOS's). The gateway's session
 * cookie, kept by CookieStore, is the sign-in itself. The twin of the iOS
 * app's Session.swift, as a ViewModel with its state in flows.
 */
class Session : ViewModel() {
    private val _pilot = MutableStateFlow<Pilot?>(null)
    val pilot: StateFlow<Pilot?> = _pilot.asStateFlow()

    /** Whether the gateway has been asked once since launch. */
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    private val _problem = MutableStateFlow<String?>(null)
    val problem: StateFlow<String?> = _problem.asStateFlow()

    /** A sign-in link has been asked for and the gateway took the ask. */
    private val _linkSent = MutableStateFlow(false)
    val linkSent: StateFlow<Boolean> = _linkSent.asStateFlow()

    init {
        refresh()
    }

    /** Asks the gateway who is signed in: at launch, and after any sign-in. */
    fun refresh() {
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        try {
            _pilot.value = Gateway.me()
            _problem.value = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Offline, or the gateway down: the last answer stands, and the
            // chart is still the pilot's from its cache.
            _problem.value = e.message ?: "The gateway could not be reached."
        }
        _loaded.value = true
    }

    fun requestMagicLink(email: String) {
        viewModelScope.launch {
            try {
                Gateway.requestMagicLink(email.trim())
                _problem.value = null
                _linkSent.value = true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _problem.value = "The link could not be sent: ${e.message}"
                _linkSent.value = false
            }
        }
    }

    /** An App Link opened in the app: the sign-in link's token is verified
     *  here; any other link is the screens' (Links, MainActivity). */
    fun open(uri: Uri) {
        val link = Links.parse(uri.toString()) as? Links.SignIn ?: return
        viewModelScope.launch {
            try {
                Gateway.verifyMagicLink(link.token)
                _linkSent.value = false
                load()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _problem.value = "The sign-in link did not work: ${e.message}"
            }
        }
    }

    /** Signing out ends the session on the gateway (the owner's pick:
     *  sign-out clears, as the web app's useLogout does). */
    fun signOut() {
        viewModelScope.launch {
            runCatching { Gateway.signOut() }
            _pilot.value = null
            _linkSent.value = false
        }
    }
}
