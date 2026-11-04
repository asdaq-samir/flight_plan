package app.wingtipmaps.android.strip

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Flight
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.wingtipmaps.android.api.Pilot

/**
 * The round profile button beside the field (the strip layout has no
 * tabs): the pilot's initials in a circle, or a person's glyph signed
 * out, and Material's own menu -- My airplane, Settings, Sign in or Sign
 * out -- each opening the existing screen over the strip. The logbook
 * and the instructor are the web's and the iOS app's; on this phone the
 * menu offers what is here. An IconButton is Material's 48-dp control,
 * so the hit area is the platform's and nothing is grown for it.
 */
@Composable
fun ProfileButton(pilot: Pilot?, onOpen: (StripModel.Over) -> Unit, onSignOut: () -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val initials = StripData.initialsOf(pilot)
    Box(modifier) {
        IconButton(
            onClick = { open = true },
            modifier = Modifier.semantics {
                contentDescription = pilot?.displayName?.let { "$it: the pilot's menu" } ?: "The pilot's menu"
            },
        ) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(36.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    if (initials.isNotEmpty()) {
                        Text(initials, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer)
                    } else {
                        Icon(Icons.Filled.Person, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                    }
                }
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            pilot?.displayName?.let { name ->
                Text(
                    name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
                HorizontalDivider()
            }
            DropdownMenuItem(
                text = { Text("My airplane") },
                leadingIcon = { Icon(Icons.Filled.Flight, contentDescription = null) },
                onClick = { open = false; onOpen(StripModel.Over.Airplane) },
            )
            DropdownMenuItem(
                text = { Text("Settings") },
                leadingIcon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                onClick = { open = false; onOpen(StripModel.Over.Settings) },
            )
            HorizontalDivider()
            if (pilot != null) {
                DropdownMenuItem(
                    text = { Text("Sign out") },
                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null) },
                    onClick = { open = false; onSignOut() },
                )
            } else {
                // The sign-in is Setup's own (the emailed link).
                DropdownMenuItem(
                    text = { Text("Sign in") },
                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.Login, contentDescription = null) },
                    onClick = { open = false; onOpen(StripModel.Over.Settings) },
                )
            }
        }
    }
}
