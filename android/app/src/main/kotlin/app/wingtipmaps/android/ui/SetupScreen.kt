package app.wingtipmaps.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.wingtipmaps.android.Config
import app.wingtipmaps.android.Session
import app.wingtipmaps.android.flight.Traffic

/**
 * The Setup tab, phase 0's part of it: the account. Signed in, the
 * pilot's address and Sign Out; signed out, an address and the emailed
 * link, which opens the app and signs it in (Session.open). The server
 * the build talks to is shown, as the iOS app shows it, for a tester
 * with more than one. The Map section holds what is drawn on the map,
 * as the iOS app's Setup has it: Traffic, for now.
 */
@Composable
fun SetupScreen(session: Session) {
    val pilot by session.pilot.collectAsStateWithLifecycle()
    val loaded by session.loaded.collectAsStateWithLifecycle()
    val problem by session.problem.collectAsStateWithLifecycle()
    val linkSent by session.linkSent.collectAsStateWithLifecycle()
    var email by rememberSaveable { mutableStateOf("") }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // The tabs, or the strip (StripLayout), as the web app's Screen row
        // has it: a setting of two is a segmented control.
        val context = LocalContext.current
        val layout by rememberLayout()
        Text("Screen", style = MaterialTheme.typography.titleLarge)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            val choices = listOf(LayoutPreference.TABS to "Tabs", LayoutPreference.STRIP to "Strip")
            choices.forEachIndexed { i, (value, label) ->
                SegmentedButton(
                    selected = layout == value,
                    onClick = { LayoutPreference.set(context, value) },
                    shape = SegmentedButtonDefaults.itemShape(index = i, count = choices.size),
                ) { Text(label) }
            }
        }
        Text("Account", style = MaterialTheme.typography.titleLarge)
        val signedIn = pilot
        when {
            !loaded -> CircularProgressIndicator(Modifier.size(24.dp))
            signedIn != null -> {
                Text(signedIn.email ?: signedIn.displayName ?: "Signed in", style = MaterialTheme.typography.bodyLarge)
                OutlinedButton(onClick = session::signOut) { Text("Sign Out") }
            }
            else -> {
                OutlinedTextField(
                    value = email, onValueChange = { email = it }, modifier = Modifier.fillMaxWidth(),
                    label = { Text("Email") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
                )
                Button(onClick = { session.requestMagicLink(email) }, enabled = email.contains('@')) {
                    Text("Email Me a Sign-In Link")
                }
                if (linkSent) {
                    Text("Check your email: the link opens the app and signs you in.", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        ProblemLine(problem)
        Text("Map", style = MaterialTheme.typography.titleLarge)
        TrafficRow()
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Server", style = MaterialTheme.typography.bodyMedium)
            Text(Config.host, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/**
 * The traffic layer on or off (Traffic.setOn, kept across launches), as
 * the iOS app's Setup and the web app's map settings have it: Material's
 * list item with a switch, the whole row the toggle so its touch target
 * is the row's 56 dp, more than the 48 dp Material asks, and read out as
 * one switch named "Traffic".
 */
@Composable
private fun TrafficRow() {
    val context = LocalContext.current
    val traffic = remember(context) { Traffic.of(context) }
    val on by traffic.on.collectAsStateWithLifecycle()
    ListItem(
        headlineContent = { Text("Traffic") },
        trailingContent = { Switch(checked = on, onCheckedChange = null) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.fillMaxWidth().toggleable(value = on, role = Role.Switch, onValueChange = traffic::setOn),
    )
}
