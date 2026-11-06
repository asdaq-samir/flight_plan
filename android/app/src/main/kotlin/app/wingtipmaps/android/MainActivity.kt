package app.wingtipmaps.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import app.wingtipmaps.android.ui.RootScreen
import app.wingtipmaps.android.ui.WingtipTheme
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The one activity: the map under the sheet (RootScreen), drawn edge to
 * edge under the status and navigation bars as a map app is. A link that
 * opened the app -- at launch, or while it is open (onNewIntent, the
 * manifest's singleTask) -- is read by Links: the sign-in link is the
 * session's; a route or a field is handed to the screens.
 */
class MainActivity : ComponentActivity() {
    private val session: Session by viewModels()

    /** A link for the screens, until RootScreen has taken it. */
    private val pending = MutableStateFlow<Links.Link?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            WingtipTheme {
                RootScreen(pending = pending, onHandled = { pending.value = null })
            }
        }
        // The launch's own link once: a rotation recreates the activity
        // with the same intent, and the route is not planned again for it.
        if (savedInstanceState == null) open(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        open(intent)
    }

    private fun open(intent: Intent?) {
        val data = intent?.data ?: return
        when (val link = Links.parse(data.toString())) {
            is Links.SignIn -> session.open(data)
            is Links.Route, is Links.Place -> pending.value = link
            null -> {}
        }
    }
}
