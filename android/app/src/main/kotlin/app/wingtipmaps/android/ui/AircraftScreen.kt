package app.wingtipmaps.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.wingtipmaps.android.Plan
import app.wingtipmaps.android.api.AircraftProfile
import app.wingtipmaps.android.api.Planner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The planner's airplane types (/api/aircraft-profiles), asked once. */
class AircraftModel : ViewModel() {
    private val _profiles = MutableStateFlow<List<AircraftProfile>>(emptyList())
    val profiles: StateFlow<List<AircraftProfile>> = _profiles.asStateFlow()

    private val _problem = MutableStateFlow<String?>(null)
    val problem: StateFlow<String?> = _problem.asStateFlow()

    init {
        viewModelScope.launch {
            try {
                _profiles.value = Planner.aircraftProfiles()
                _problem.value = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _problem.value = "The airplane types could not be fetched: ${e.message}"
            }
        }
    }
}

/**
 * The Aircraft tab: one of the planner's airplane types picked from a
 * menu (a discrete setting is a menu, not a slider), and the handbook
 * figures the planner flies it on. The airplane by N-number, with the
 * pilot's own figures, is a later phase.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AircraftScreen(plan: Plan) {
    val model: AircraftModel = viewModel()
    val profiles by model.profiles.collectAsStateWithLifecycle()
    val problem by model.problem.collectAsStateWithLifecycle()
    val state by plan.state.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf(false) }
    val picked = profiles.firstOrNull { it.name == state.aircraft }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = picked?.let(::label) ?: state.aircraft.uppercase(),
                onValueChange = {},
                readOnly = true,
                label = { Text("Airplane") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                profiles.forEach { profile ->
                    DropdownMenuItem(
                        text = { Text(label(profile)) },
                        onClick = {
                            plan.setAircraft(profile.name)
                            expanded = false
                        },
                    )
                }
            }
        }
        ProblemLine(problem)
        picked?.let { ProfileFigures(it) }
    }
}

/** "Cessna 172 · C172": the type's name and the planner's key for it. */
private fun label(profile: AircraftProfile): String =
    profile.type?.let { "$it · ${profile.name.uppercase()}" } ?: profile.name.uppercase()

/** The handbook figures the planner flies the type on, its own. */
@Composable
private fun ProfileFigures(profile: AircraftProfile) {
    Row(Modifier.fillMaxWidth()) {
        Figure("CRUISE", kt(profile.cruiseTasKt))
        Figure("BURN", String.format(java.util.Locale.US, "%.1f gph", profile.fuelBurnGph))
        Figure("CEILING", ft(profile.serviceCeilingFt))
        Figure("USABLE", profile.usableFuelGal?.let(::gal) ?: "—")
    }
}
