package app.wingtipmaps.android.strip

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
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
import app.wingtipmaps.android.ui.AircraftScreen
import app.wingtipmaps.android.ui.AirportScreen
import app.wingtipmaps.android.ui.AskScreen
import app.wingtipmaps.android.ui.SetupScreen

/**
 * The strip layout: the map under Material's bottom sheet, the sheet's
 * one row at its foot the field (FieldRow) with the profile button beside
 * it, and over the field, when the sheet is up, the flight as one strip
 * in time -- the ribbon (StripRibbon), the head with the verdict and at
 * most three actions (StripHead), and the timeline (stripList): the
 * departure, the legs, the stops, the destination. In the air the ribbon
 * carries the airplane and the next checkpoint large (StripAir) and the
 * field is the radio. The screens the field and the profile menu open --
 * an airport's card, the airplane, Settings, Ask -- are the tabs layout's
 * own screens (ui/), each a modal sheet with its title and a close that
 * goes back one level.
 *
 * Mounted by the root beside the tabs layout as a switch: the root owns
 * the map, own ship and the permission asks, and hands them here.
 *
 * @param map the chart and its buttons, as the root draws them for the
 *   tabs layout (ChartMap, MapButtons).
 * @param flying whether the airplane is under way (the root's call, from
 *   own ship's ground speed).
 * @param verdict the Brief's verdict and `actions` its glance, once the
 *   brief is on this phone; null and empty until then.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StripLayout(
    plan: Plan,
    session: Session,
    ownShip: OwnShip,
    flying: Boolean,
    map: @Composable () -> Unit,
    verdict: Verdict? = null,
    actions: List<GlanceAction> = emptyList(),
    ways: List<Way> = emptyList(),
    wayKey: String? = null,
    onWay: (String) -> Unit = {},
    model: StripModel = viewModel(),
    assistant: AssistantClient = viewModel(),
) {
    val state by plan.state.collectAsStateWithLifecycle()
    val strip by model.state.collectAsStateWithLifecycle()
    val pilot by session.pilot.collectAsStateWithLifecycle()
    val fix by ownShip.fix.collectAsStateWithLifecycle()
    val conversation by assistant.conversation.collectAsStateWithLifecycle()
    val rows = remember(state.legs, state.dep, state.dest, state.stops) { StripData.rows(state) }
    val points = remember(rows) { StripData.ribbonPoints(rows) }
    val position = remember(state.course, state.legs, fix) {
        StripData.positionAlong(state.course?.courseLine.orEmpty(), state.legs, fix?.lat, fix?.lon)
    }
    // When the flight leaves: now, as this app's plan has no time of its
    // own; the times down the strip are this plus the planner's minutes.
    val leaveMs = remember(state.legs) { System.currentTimeMillis() }
    var unfolded by rememberSaveable { mutableStateOf(false) }
    var source by remember { mutableStateOf<AssistantSource?>(null) }

    // The fields' cards for the chips, asked once each.
    LaunchedEffect(state.dep, state.dest, state.stops) {
        if (state.routed) model.loadFields(listOf(state.dep) + state.stops + state.dest)
    }

    val context = AssistantContext(
        dep = state.dep, dest = state.dest, stops = state.stops, aircraft = state.aircraft,
        altitudeFt = state.legs.firstOrNull()?.altitudeFt,
        ownShip = fix?.let { AssistantContext.OwnShipFix(it.lat, it.lon, it.altitudeFt, it.trackDeg, it.groundspeedKt) },
        pilot = pilot?.let { AssistantContext.PilotRecord(homeBase = it.homeBase) },
    )
    val scaffoldState = rememberBottomSheetScaffoldState()
    // The sheet up from its foot once a line is done, as the web's sheet
    // comes up from the pill (fieldLine's `up`).
    LaunchedEffect(strip.done) {
        if (strip.done > 0 && scaffoldState.bottomSheetState.currentValue == SheetValue.PartiallyExpanded) {
            scaffoldState.bottomSheetState.expand()
        }
    }

    // A screen's word from the field: what is on this phone opens; the
    // rest is said to be the web's for now, where it was asked.
    val openScreen: (FieldScreen) -> String? = { screen ->
        when (screen) {
            FieldScreen.AIRPLANE -> { model.open(StripModel.Over.Airplane); null }
            FieldScreen.SETTINGS, FieldScreen.MAP -> { model.open(StripModel.Over.Settings); null }
            FieldScreen.NAVLOG -> if (state.routed) null else "Plan a route first."
            FieldScreen.BRIEF -> if (state.routed) {
                // The Brief's own page is the web's for now: the assistant's
                // brief, its answer a card over the strip.
                assistant.ask("Brief me", context)
                model.showAnswer()
                null
            } else {
                "Plan a route first, then say \"Brief me\"."
            }
            FieldScreen.RADIO, FieldScreen.CLEARANCE -> "Tap the mic and say it; the clearance card is the web app's for now."
            else -> "${screen.name.lowercase().replaceFirstChar { it.uppercase() }.replace('_', ' ')} isn't on this phone yet."
        }
    }
    val submit: (String) -> Unit = { line ->
        model.submit(line, plan, pilot, fix, assistant, context, openScreen)
    }
    val ask = conversation.turns.lastOrNull()?.takeIf { it.role == AssistantTurn.Role.ASSISTANT }

    // The sheet sits over the navigation bar (edge to edge): its foot is
    // the handle and the field's row; in the air the ribbon and the next
    // checkpoint too, since they are what is glanced at.
    val navigationBar = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val peek = (if (flying && rows.isNotEmpty()) 268.dp else 116.dp) + navigationBar
    BottomSheetScaffold(
        scaffoldState = scaffoldState,
        sheetPeekHeight = peek,
        sheetContainerColor = MaterialTheme.colorScheme.surface,
        sheetContent = {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.7f)) {
                FieldRow(
                    suggestions = StripData.suggestions(state), pilot = pilot, flying = flying, problem = strip.problem,
                    onLine = submit, onOpen = model::open, onSignOut = session::signOut,
                    onProblem = model::say,
                )
                if (flying && rows.isNotEmpty()) {
                    StripAir(state = state, rows = rows, position = position)
                } else {
                    StripRibbon(state = state, verdict = verdict, points = points, position = position, over = null, onClose = {})
                }
                LazyColumn(
                    Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp + navigationBar),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (ask != null && strip.answerShown) {
                        item(key = "answer") {
                            AnswerCard(
                                turn = ask, answering = conversation.answering, status = conversation.status,
                                onStop = assistant::cancel, onClose = { assistant.clear(); model.dismissAnswer() },
                                onSource = { source = it }, modifier = Modifier.padding(horizontal = 16.dp),
                            )
                        }
                    }
                    if (!state.routed || state.course == null) {
                        item(key = "welcome") { StripWelcome(Modifier.padding(horizontal = 16.dp)) }
                        state.problem?.let { why ->
                            item(key = "problem") {
                                Text(why, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 16.dp))
                            }
                        }
                    } else {
                        item(key = "head") {
                            StripHead(
                                verdict = verdict, line = StripData.headLine(state), actions = actions, ways = ways, wayKey = wayKey, onWay = onWay,
                                // An action's line put to the assistant, as the Brief's
                                // own page is not on this phone yet.
                                onAction = { assistant.ask(it.line, context); model.showAnswer() },
                                onBrief = { submit("Brief me") },
                                modifier = Modifier.padding(horizontal = 16.dp),
                            )
                        }
                        state.stage?.let { stage ->
                            item(key = "stage") {
                                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                    Text(stage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        state.problem?.let { why ->
                            item(key = "problem") {
                                Text(why, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 16.dp))
                            }
                        }
                        stripList(
                            rows = rows, cards = strip.cards, leaveMs = leaveMs,
                            departDetail = emptyList(), arriveDetail = emptyList(),
                            unfolded = unfolded, onUnfold = { unfolded = true },
                            onField = { model.open(StripModel.Over.Airport(it)) },
                            onCheckpoint = {},
                        )
                    }
                }
            }
        },
    ) {
        Box(Modifier.fillMaxSize()) { map() }
    }

    // A screen over the strip: a page with its title and a close that goes
    // back one level, as a modal sheet at the whole height.
    strip.over?.let { over ->
        ModalBottomSheet(
            onDismissRequest = { model.open(null) },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Column(Modifier.fillMaxSize()) {
                if (over !is StripModel.Over.Ask) {
                    StripRibbon(state = state, verdict = null, points = emptyList(), position = null, over = over, onClose = { model.open(null) })
                }
                Box(Modifier.weight(1f)) {
                    when (over) {
                        is StripModel.Over.Airport -> AirportScreen(over.ident)
                        StripModel.Over.Airplane -> AircraftScreen(plan)
                        StripModel.Over.Settings -> SetupScreen(session)
                        StripModel.Over.Ask -> AskScreen(plan = plan, session = session, ownShip = ownShip, onClose = { model.open(null) }, client = assistant)
                    }
                }
                Spacer(Modifier.height(navigationBar))
            }
        }
    }

    // A source chip: the report as sent, in a fixed-width face so a METAR's
    // groups line up as pilots read them (AskScreen's own way).
    source?.let { shown ->
        ModalBottomSheet(onDismissRequest = { source = null }) {
            Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(shown.label, style = MaterialTheme.typography.titleMedium)
                Text(shown.text, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

/**
 * The assistant's last answer, a card over the strip: "Ask" at its head
 * with Stop while it is answering and the close that forgets the
 * conversation; the answer's words as they stream, with the chips of the
 * reports they rest on, and why where the stream broke.
 */
@Composable
private fun AnswerCard(
    turn: AssistantTurn,
    answering: Boolean,
    status: String?,
    onStop: () -> Unit,
    onClose: () -> Unit,
    onSource: (AssistantSource) -> Unit,
    modifier: Modifier = Modifier,
) {
    StripCard(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Ask", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                if (answering) {
                    TextButton(onClick = onStop) {
                        Icon(Icons.Filled.Stop, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text(" Stop")
                    }
                }
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Dismiss the answer") }
            }
            if (status != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (turn.content.isNotEmpty()) {
                Text(turn.content, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(end = 12.dp))
            }
            if (turn.sources.isNotEmpty()) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    turn.sources.forEach { s -> AssistChip(onClick = { onSource(s) }, label = { Text(s.label) }) }
                }
            }
            turn.problem?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
