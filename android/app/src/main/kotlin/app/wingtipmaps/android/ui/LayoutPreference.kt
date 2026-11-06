package app.wingtipmaps.android.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The screen's layout, the tabs or the strip (StripLayout: one field and
 * the flight as one strip, the owner's pick of 2026-11-04), kept in
 * SharedPreferences under the web app's key "layout" and held in one
 * StateFlow, so the root and Setup's Screen row, which sits inside
 * either layout, see the same value the moment it changes.
 */
object LayoutPreference {
    const val TABS = "tabs"
    const val STRIP = "strip"
    private const val KEY = "layout"

    private val state = MutableStateFlow<String?>(null)

    /** The layout as kept, read once from disk the first time it is asked. */
    fun flow(context: Context): StateFlow<String?> {
        if (state.value == null) {
            state.value = context.getSharedPreferences("wingtip", Context.MODE_PRIVATE).getString(KEY, TABS) ?: TABS
        }
        return state.asStateFlow()
    }

    fun set(context: Context, layout: String) {
        context.getSharedPreferences("wingtip", Context.MODE_PRIVATE).edit().putString(KEY, layout).apply()
        state.value = layout
    }
}

/** The layout as a Compose state, "tabs" until the disk has been read. */
@Composable
fun rememberLayout(): State<String?> {
    val context = LocalContext.current
    return LayoutPreference.flow(context).collectAsState()
}
