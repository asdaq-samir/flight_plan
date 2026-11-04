package app.wingtipmaps.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.wingtipmaps.android.Plan
import app.wingtipmaps.android.Session
import app.wingtipmaps.android.api.AssistantClient
import app.wingtipmaps.android.api.AssistantContext
import app.wingtipmaps.android.api.AssistantSource
import app.wingtipmaps.android.api.AssistantTurn
import app.wingtipmaps.android.flight.OwnShip

/** What a pilot asks first, offered while there is nothing to read. */
val askSuggestions = listOf(
    "Is the weather good enough for my minimums?",
    "What's the crosswind at my destination?",
    "Brief me",
)

/**
 * Ask: a question about the flight put to the assistant (AssistantClient),
 * which answers in words with the planner's own figures and the raw
 * reports it read, each a chip under the answer that opens the report as
 * sent. The twin of the iOS app's AskView: the conversation as bubbles,
 * the assistant's on the left, the pilot's on the right in the tint;
 * while the assistant looks something up its own words for that stand
 * under the last bubble, and the answer's text appends as it streams.
 * Phase 0 has no speech path on Android, so a question is typed. Shown
 * full-screen (or in a bottom sheet) from the sparkle button beside the
 * map's buttons, which RootScreen's owner places:
 * `AskScreen(plan, session, ownShip, onClose = { ... })`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AskScreen(plan: Plan, session: Session, ownShip: OwnShip, onClose: () -> Unit, client: AssistantClient = viewModel()) {
    val conversation by client.conversation.collectAsStateWithLifecycle()
    val planState by plan.state.collectAsStateWithLifecycle()
    val pilot by session.pilot.collectAsStateWithLifecycle()
    val fix by ownShip.fix.collectAsStateWithLifecycle()
    var question by rememberSaveable { mutableStateOf("") }
    var source by remember { mutableStateOf<AssistantSource?>(null) }
    val list = rememberLazyListState()

    // The context as the app has it: the plan on the page, the airplane's
    // last fix, and the pilot where one is signed in. The departure time
    // is the planner's own now: the plan has none of its own.
    val context = AssistantContext(
        dep = planState.dep, dest = planState.dest, stops = planState.stops, aircraft = planState.aircraft,
        altitudeFt = planState.legs.firstOrNull()?.altitudeFt,
        ownShip = fix?.let { AssistantContext.OwnShipFix(it.lat, it.lon, it.altitudeFt, it.trackDeg, it.groundspeedKt) },
        pilot = pilot?.let { AssistantContext.PilotRecord(homeBase = it.homeBase) },
    )

    fun send(words: String) {
        if (words.isBlank()) return
        question = ""
        client.ask(words, context)
    }

    // The answer kept in sight as it grows.
    LaunchedEffect(conversation.turns.lastOrNull()?.content, conversation.status) {
        val count = conversation.turns.size + (if (conversation.status != null) 1 else 0)
        if (count > 0) list.animateScrollToItem(count - 1)
    }
    DisposableEffect(Unit) { onDispose { client.cancel() } }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Ask") },
            actions = {
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close") }
            },
        )
        LazyColumn(
            state = list,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (conversation.turns.isEmpty()) {
                item { Suggestions(onAsk = ::send) }
            }
            items(conversation.turns, key = { it.id }) { turn ->
                TurnBubble(turn, onSource = { source = it })
            }
            conversation.status?.let { status ->
                item(key = "status") {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = question, onValueChange = { question = it }, modifier = Modifier.weight(1f),
                placeholder = { Text("Ask about the flight") }, maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send(question) }),
            )
            IconButton(onClick = { send(question) }, enabled = question.isNotBlank()) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = MaterialTheme.colorScheme.primary)
            }
        }
    }

    source?.let { shown ->
        ModalBottomSheet(onDismissRequest = { source = null }) {
            Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(shown.label, style = MaterialTheme.typography.titleMedium)
                // A fixed-width face, so a METAR's groups line up as pilots read them.
                Text(shown.text, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

@Composable
private fun Suggestions(onAsk: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Ask about the flight", style = MaterialTheme.typography.titleMedium)
        Text(
            "The figures are the planner's; the assistant puts them in words and shows what it read.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        askSuggestions.forEach { words ->
            AssistChip(onClick = { onAsk(words) }, label = { Text(words) })
        }
    }
}

/** One turn: the pilot's words in the tint on the right, the assistant's
 *  on the left with its source chips and, where the stream broke, why. */
@Composable
private fun TurnBubble(turn: AssistantTurn, onSource: (AssistantSource) -> Unit) {
    val mine = turn.role == AssistantTurn.Role.USER
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (turn.content.isNotEmpty()) {
            Box(
                Modifier
                    .widthIn(max = 320.dp)
                    .background(
                        if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        RoundedCornerShape(16.dp),
                    )
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .semantics { contentDescription = (if (mine) "You asked: " else "The assistant: ") + turn.content },
            ) {
                Text(
                    turn.content,
                    color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (turn.sources.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                turn.sources.forEach { source ->
                    AssistChip(
                        onClick = { onSource(source) },
                        label = { Text(source.label) },
                        modifier = Modifier.semantics { contentDescription = "Source: ${source.label}" },
                    )
                }
            }
        }
        ProblemLine(turn.problem)
    }
}
