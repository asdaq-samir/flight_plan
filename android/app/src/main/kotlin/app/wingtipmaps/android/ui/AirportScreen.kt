package app.wingtipmaps.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.wingtipmaps.android.api.AirportPlace
import app.wingtipmaps.android.api.AirportSuggestion
import app.wingtipmaps.android.api.Planner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A field looked for and the one opened: the search's words, what the
 *  planner found for them, and the card of the one picked. */
class AirportModel : ViewModel() {
    data class State(
        val query: String = "",
        val suggestions: List<AirportSuggestion> = emptyList(),
        val place: AirportPlace? = null,
        val problem: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var searching: Job? = null

    /** Fields by ident or name as they are typed, asked a moment after
     *  the typing pauses, so a word is one ask rather than one per letter. */
    fun search(text: String) {
        _state.update { it.copy(query = text) }
        searching?.cancel()
        val q = text.trim()
        if (q.length < 2) {
            _state.update { it.copy(suggestions = emptyList()) }
            return
        }
        searching = viewModelScope.launch {
            delay(250)
            try {
                val found = Planner.search(q)
                _state.update { it.copy(suggestions = found, problem = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(problem = e.message) }
            }
        }
    }

    /** A field's card opened, by its ident. */
    fun open(ident: String) {
        searching?.cancel()
        viewModelScope.launch {
            try {
                val place = Planner.place(ident.trim().uppercase())
                _state.update { it.copy(place = place, suggestions = emptyList(), query = place.ident, problem = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(problem = e.message) }
            }
        }
    }
}

/**
 * The Airport tab: a field found by ident or name, and its card -- the
 * name, where it is, its elevation and its METAR as sent. The planner's
 * words throughout; the raw report stays as the station sent it.
 *
 * @param ident a field to open as the tab is shown (a link's `place`), or
 *   empty.
 */
@Composable
fun AirportScreen(ident: String) {
    val model: AirportModel = viewModel()
    val state by model.state.collectAsStateWithLifecycle()
    LaunchedEffect(ident) { if (ident.isNotEmpty()) model.open(ident) }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = state.query, onValueChange = model::search, modifier = Modifier.fillMaxWidth(),
            label = { Text("Airport") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Search),
        )
        ProblemLine(state.problem)
        LazyColumn(Modifier.weight(1f)) {
            items(state.suggestions) { found ->
                SuggestionRow(found) { model.open(found.ident) }
                HorizontalDivider()
            }
            state.place?.let { place -> item { PlaceCard(place) } }
        }
    }
}

@Composable
private fun SuggestionRow(found: AirportSuggestion, onOpen: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 10.dp)) {
        Text("${found.ident}  ${found.name}", style = MaterialTheme.typography.bodyLarge)
        val where = listOfNotNull(found.municipality, found.region).joinToString(", ")
        if (where.isNotEmpty()) {
            Text(where, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The field's card, the part of it phase 0 shows. */
@Composable
private fun PlaceCard(place: AirportPlace) {
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(place.name, style = MaterialTheme.typography.titleLarge)
        val where = listOfNotNull(place.ident, place.municipality, place.region).joinToString(" · ")
        Text(where, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        place.elevationFt?.let { Text("Elevation ${ft(it)}", style = MaterialTheme.typography.bodyMedium) }
        val metar = place.metar
        if (metar?.raw != null) {
            Text(
                metar.flightCategory?.let { "METAR · $it" } ?: "METAR",
                style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp),
            )
            Text(metar.raw, style = MaterialTheme.typography.bodyMedium)
        } else {
            Text("No weather report at this field.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
