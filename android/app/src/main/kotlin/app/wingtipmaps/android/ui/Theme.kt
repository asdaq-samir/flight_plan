package app.wingtipmaps.android.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/** The blue everything tappable is, where the phone gives no colour of
 *  its own (the web app's and the iOS app's tint). */
val Blue = Color(0xFF007AFF)

/**
 * Material 3: the phone's own colours on Android 12 and later (Material
 * You, from the wallpaper), as Google's guidance asks of an app that
 * belongs on the phone; a blue scheme before that. Light or dark with the
 * system.
 */
@Composable
fun WingtipTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> darkColorScheme(primary = Blue)
        else -> lightColorScheme(primary = Blue)
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
