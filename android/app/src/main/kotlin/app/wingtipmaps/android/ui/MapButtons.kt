package app.wingtipmaps.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * How the location button reads: off (the arrow grey, as the web app's is
 * with own ship off), reading but the map let go of it (black), or
 * following the airplane (the blue tint). Denied is drawn as off; the
 * tap asks the system again where it can.
 */
enum class OwnShipMode { OFF, READING, FOLLOWING }

/**
 * The buttons over the map, under the status bar at the right, as the
 * iOS app's MapButtons: the location arrow, and under it the sparkle
 * that opens Ask (AskScreen), a question about the flight put to the
 * assistant. A tonal icon button is Material's own 40-dp control with
 * its 48-dp touch target, so nothing is grown to be tappable.
 */
@Composable
fun MapButtons(ownShip: OwnShipMode, onOwnShip: () -> Unit, onAsk: () -> Unit, modifier: Modifier = Modifier) {
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    Column(modifier.padding(top = top + 8.dp, end = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val tint = when (ownShip) {
            OwnShipMode.OFF -> Color.Gray
            OwnShipMode.READING -> MaterialTheme.colorScheme.onSurface
            OwnShipMode.FOLLOWING -> MaterialTheme.colorScheme.primary
        }
        FilledTonalIconButton(
            onClick = onOwnShip,
            colors = IconButtonDefaults.filledTonalIconButtonColors(contentColor = tint),
        ) {
            Icon(
                Icons.Filled.LocationOn,
                contentDescription = when (ownShip) {
                    OwnShipMode.OFF -> "Show my airplane"
                    OwnShipMode.READING -> "Follow my airplane"
                    OwnShipMode.FOLLOWING -> "Stop following"
                },
            )
        }
        FilledTonalIconButton(
            onClick = onAsk,
            colors = IconButtonDefaults.filledTonalIconButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        ) {
            Icon(Icons.Filled.AutoAwesome, contentDescription = "Ask about this flight")
        }
    }
}
