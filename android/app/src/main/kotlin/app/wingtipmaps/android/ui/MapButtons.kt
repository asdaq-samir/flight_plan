package app.wingtipmaps.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
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
fun MapButtons(ownShip: OwnShipMode, onOwnShip: () -> Unit, onAsk: (() -> Unit)?, modifier: Modifier = Modifier) {
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
        // In the strip the field is the way to the assistant, so no sparkle.
        if (onAsk != null) {
            FilledTonalIconButton(
                onClick = onAsk,
                colors = IconButtonDefaults.filledTonalIconButtonColors(contentColor = MaterialTheme.colorScheme.primary),
            ) {
                Icon(Icons.Filled.AutoAwesome, contentDescription = "Ask about this flight")
            }
        }
    }
}

/**
 * Why own ship shows nothing, under the status bar at the left, clear of
 * the buttons: location allowed only approximately (Android 12 and later
 * let the pilot pick it), which Android gives only to within about
 * three square kilometres and so is no position to fly by, or not allowed at all.
 * Ask again shows the system's dialog where it still will (it offers
 * precise over approximate); after a second refusal the system answers
 * at once, and the words say where the switch is.
 */
@Composable
fun OwnShipNote(approximate: Boolean, onAskAgain: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    Surface(
        modifier = modifier.padding(top = top + 8.dp, start = 8.dp, end = 64.dp),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 3.dp,
        shadowElevation = 2.dp,
    ) {
        Column(Modifier.padding(start = 12.dp, top = 10.dp, end = 4.dp)) {
            Text(
                if (approximate) {
                    "Your airplane is not shown: location is allowed only approximately, which can be off by a mile or more. Allow precise location here or in Settings."
                } else {
                    "Your airplane is not shown: location is off for Wingtip Maps. Allow it here or in Settings."
                },
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(end = 8.dp),
            )
            Row(Modifier.align(Alignment.End)) {
                TextButton(onClick = onClose) { Text("Not now") }
                TextButton(onClick = onAskAgain) { Text(if (approximate) "Allow precise" else "Allow") }
            }
        }
    }
}
