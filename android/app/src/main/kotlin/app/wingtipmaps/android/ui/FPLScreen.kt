package app.wingtipmaps.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.wingtipmaps.android.Plan
import app.wingtipmaps.android.api.Leg
import app.wingtipmaps.android.api.NavLogTotals

/**
 * The flight plan: the route typed, planned, and the nav log's legs as
 * the planner streams them, with the totals and its fuel check. Every
 * figure on it is the planner's.
 */
@Composable
fun FPLScreen(plan: Plan) {
    val state by plan.state.collectAsStateWithLifecycle()
    // The fields hold what is typed; the plan's own route comes back into
    // them when it changes from elsewhere (a link, the kept plan).
    var dep by rememberSaveable(state.dep) { mutableStateOf(state.dep) }
    var dest by rememberSaveable(state.dest) { mutableStateOf(state.dest) }
    var stops by rememberSaveable(state.stops) { mutableStateOf(state.stops.joinToString(", ")) }
    val idents = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Next)

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = dep, onValueChange = { dep = it }, modifier = Modifier.weight(1f),
                label = { Text("Departure") }, singleLine = true, keyboardOptions = idents,
            )
            OutlinedTextField(
                value = dest, onValueChange = { dest = it }, modifier = Modifier.weight(1f),
                label = { Text("Destination") }, singleLine = true, keyboardOptions = idents,
            )
        }
        OutlinedTextField(
            value = stops, onValueChange = { stops = it }, modifier = Modifier.fillMaxWidth(),
            label = { Text("Stops, comma-separated") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Done),
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = { plan.plan(dep, dest, stops.split(",")) },
                enabled = dep.isNotBlank() && dest.isNotBlank() && !state.planning,
            ) { Text("Plan") }
            if (state.planning) CircularProgressIndicator(Modifier.size(20.dp))
            state.stage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        ProblemLine(state.problem)
        LazyColumn(Modifier.weight(1f)) {
            items(state.legs) { leg ->
                LegRow(leg)
                HorizontalDivider()
            }
            state.totals?.let { totals ->
                item {
                    Spacer(Modifier.height(8.dp))
                    TotalsRows(totals)
                }
            }
        }
    }
}

/** One leg's row: to where, how far, the magnetic heading, the time. */
@Composable
private fun LegRow(leg: Leg) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1.4f)) {
            Text(leg.to, style = MaterialTheme.typography.titleMedium)
            Text(ft(leg.altitudeFt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Figure("DIST", nm(leg.distanceNm))
        Figure("MH", degrees(leg.magneticHeadingDeg))
        Figure("ETE", leg.eteMin?.let(::hoursMinutes) ?: "—")
    }
}

/** The flight's totals, and the fuel the planner holds it to. */
@Composable
private fun TotalsRows(totals: NavLogTotals) {
    val warn = (totals.fuelMarginGal ?: 0.0) < 0
    Row(Modifier.fillMaxWidth()) {
        Figure("DIST", totals.distanceNm?.let(::nm) ?: "—")
        Figure("ETE", totals.eteMin?.let(::hoursMinutes) ?: "—")
        Figure("FUEL", totals.fuelGal?.let(::gal) ?: "—", warn = warn)
        Figure("REQUIRED", totals.fuelRequiredGal?.let(::gal) ?: "—", warn = warn)
    }
    if (warn) {
        Text(
            "Under the reserve the planner holds the flight to. Fly it with a fuel stop.",
            color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
