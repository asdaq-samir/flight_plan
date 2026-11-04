package app.wingtipmaps.android.strip

import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExpandedFullScreenSearchBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SearchBar
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSearchBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.wingtipmaps.android.api.Pilot
import kotlinx.coroutines.launch

/**
 * The one row the sheet shows at its foot, in every state (the owner's
 * change of 2026-11-04 after Apple Maps: the handle and this row alone
 * when the sheet is down): Material's search bar -- the search glyph
 * leading, "Where to, or ask" as its placeholder, the microphone as its
 * trailing icon -- with the round profile button beside it at the right.
 * What it takes is read by FieldCommands.readField and done by StripModel:
 * idents are a route, a name a place, a screen's word that screen,
 * anything else a question for the assistant. Tapped, the bar opens full
 * screen, as Material's does, with the suggestions as chips while nothing
 * is typed, each one tap; the microphone opens the phone's own speech
 * recognizer and the words come back as if typed. Why a line could not
 * be done is said under the row.
 *
 * In the air the field is the radio: nothing is typed, the microphone is
 * the way in, and the placeholder says so.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FieldRow(
    suggestions: List<String>,
    pilot: Pilot?,
    flying: Boolean,
    problem: String?,
    onLine: (String) -> Unit,
    onOpen: (StripModel.Over) -> Unit,
    onSignOut: () -> Unit,
    onProblem: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val searchBarState = rememberSearchBarState()
    val textFieldState = rememberTextFieldState()
    val scope = rememberCoroutineScope()

    fun submit(words: String) {
        val line = words.trim()
        if (line.isEmpty()) return
        textFieldState.clearText()
        scope.launch { searchBarState.animateToCollapsed() }
        onLine(line)
    }

    // The phone's own speech recognizer, through the system's intent: no
    // permission of the app's own, and the words come back as typed.
    val hear = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val words = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!words.isNullOrBlank()) submit(words)
    }
    val listen = {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, if (flying) "Say it" else "Where to, or ask")
        try {
            hear.launch(intent)
        } catch (e: ActivityNotFoundException) {
            onProblem("This phone has no speech recognizer.")
        }
    }

    val placeholder = if (flying) "Tap the mic and say it" else "Where to, or ask"
    val inputField: @Composable () -> Unit = {
        SearchBarDefaults.InputField(
            searchBarState = searchBarState,
            textFieldState = textFieldState,
            onSearch = ::submit,
            enabled = !flying,
            placeholder = { Text(placeholder) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                IconButton(onClick = listen, enabled = true) {
                    Icon(Icons.Filled.Mic, contentDescription = "Say it", tint = MaterialTheme.colorScheme.primary)
                }
            },
            modifier = Modifier.semantics { contentDescription = if (flying) "The radio" else "Where to, or ask" },
        )
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SearchBar(state = searchBarState, inputField = inputField, modifier = Modifier.weight(1f))
            ProfileButton(pilot = pilot, onOpen = onOpen, onSignOut = onSignOut)
        }
        if (problem != null) {
            Text(
                problem, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }
    }

    // What a pilot asks first, and the planner's other screens, as chips
    // while nothing is typed: how the rest is found without tabs.
    ExpandedFullScreenSearchBar(state = searchBarState, inputField = inputField) {
        if (textFieldState.text.isEmpty() && suggestions.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                suggestions.forEach { words ->
                    SuggestionChip(onClick = { submit(words) }, label = { Text(words) })
                }
            }
        }
    }
}
