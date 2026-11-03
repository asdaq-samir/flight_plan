package app.wingtipmaps.android.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.wingtipmaps.android.Charts
import app.wingtipmaps.android.Links
import app.wingtipmaps.android.Plan
import app.wingtipmaps.android.Session
import app.wingtipmaps.android.flight.OwnShip
import app.wingtipmaps.android.flight.OwnTrail
import app.wingtipmaps.android.map.ChartMap
import app.wingtipmaps.android.notify.Notifications
import kotlinx.coroutines.flow.StateFlow

/** The sheet's four tabs, as the web app and the iOS app have them. */
enum class Tabs(val title: String) {
    FPL("FPL"), AIRPORT("Airport"), AIRCRAFT("Aircraft"), SETUP("Setup")
}

/**
 * The map under a sheet holding the four tabs, as Apple Maps has it and
 * the web app imitates it: Material's own bottom sheet, dragged between
 * the pill -- the figures' line and the tabs' names -- and the page.
 *
 * @param pending a link opened in the app, for the tab it is for
 *   (MainActivity); `onHandled` once it has been taken.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RootScreen(pending: StateFlow<Links.Link?>, onHandled: () -> Unit) {
    val charts: Charts = viewModel()
    val plan: Plan = viewModel()
    val session: Session = viewModel()
    val info by charts.info.collectAsStateWithLifecycle()
    val state by plan.state.collectAsStateWithLifecycle()
    val template = remember(info) { Charts.template(info) }
    val base = remember(info) { Charts.base(info) }

    var tab by rememberSaveable { mutableIntStateOf(0) }
    var airport by rememberSaveable { mutableStateOf("") }

    // The airplane on the chart (OwnShip, OwnTrail), on at the location
    // button: the system's permission dialog needs an Activity, so the
    // asks for location and for notifications are made from here, the
    // one screen, and answered back to the pieces that wanted them.
    val context = LocalContext.current
    val ownShip = remember { OwnShip.of(context) }
    val trail = remember { OwnTrail.of(context) }
    val fix by ownShip.fix.collectAsStateWithLifecycle()
    val flown by trail.points.collectAsStateWithLifecycle()
    var ownShipOn by rememberSaveable { mutableStateOf(false) }
    var following by rememberSaveable { mutableStateOf(false) }
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true && ownShipOn) {
            ownShip.start()
            following = true
        }
        if (granted.containsKey(Manifest.permission.POST_NOTIFICATIONS)) Notifications.answered()
    }
    // Back after a rotation with own ship on: the reading goes on (start
    // is idempotent), and the dot is drawn again.
    LaunchedEffect(ownShipOn) { if (ownShipOn && ownShip.permitted) ownShip.start() }
    // A watch set or traffic near asked for notifications (Notifications
    // .allow): the system's dialog on Android 13 and later, nothing to ask
    // before it.
    val notificationsWanted by Notifications.wanted.collectAsStateWithLifecycle()
    LaunchedEffect(notificationsWanted) {
        if (!notificationsWanted) return@LaunchedEffect
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !Notifications.allowed(context)) {
            permissions.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        } else {
            Notifications.answered()
        }
    }
    // The location button as Apple Maps' is: off, then following, then
    // let go; a drag of the map lets go too.
    val ownShipMode = when {
        !ownShipOn -> OwnShipMode.OFF
        following -> OwnShipMode.FOLLOWING
        else -> OwnShipMode.READING
    }
    val onOwnShip = {
        when {
            !ownShipOn -> {
                ownShipOn = true
                if (ownShip.permitted) {
                    ownShip.start()
                    following = true
                } else {
                    permissions.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION))
                }
            }
            !following -> following = true
            else -> {
                following = false
                ownShipOn = false
                ownShip.stop()
            }
        }
    }

    val link by pending.collectAsStateWithLifecycle()
    LaunchedEffect(link) {
        when (val opened = link) {
            null -> return@LaunchedEffect
            is Links.Place -> {
                airport = opened.ident
                tab = Tabs.AIRPORT.ordinal
            }
            is Links.Route -> {
                plan.plan(opened.dep, opened.dest, opened.stops)
                tab = Tabs.FPL.ordinal
            }
            is Links.SignIn -> {}
        }
        onHandled()
    }

    // The sheet sits over the navigation bar (edge to edge): its pill is
    // the strip and the tabs above the bar, and its content ends above it.
    val navigationBar = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    BottomSheetScaffold(
        scaffoldState = rememberBottomSheetScaffoldState(),
        sheetPeekHeight = 120.dp + navigationBar,
        sheetContent = {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f)) {
                FiguresStrip(state)
                TabRow(selectedTabIndex = tab) {
                    Tabs.entries.forEachIndexed { i, t ->
                        Tab(selected = tab == i, onClick = { tab = i }, text = { Text(t.title) })
                    }
                }
                Box(Modifier.weight(1f)) {
                    when (Tabs.entries[tab]) {
                        Tabs.FPL -> FPLScreen(plan)
                        Tabs.AIRPORT -> AirportScreen(airport)
                        Tabs.AIRCRAFT -> AircraftScreen(plan)
                        Tabs.SETUP -> SetupScreen(session)
                    }
                }
                Spacer(Modifier.height(navigationBar))
            }
        },
    ) {
        Box(Modifier.fillMaxSize()) {
            ChartMap(
                template = template,
                minZoom = base?.minZoom ?: 5,
                maxZoom = base?.maxZoom ?: 12,
                line = state.course?.courseLine.orEmpty(),
                modifier = Modifier.fillMaxSize(),
                ownShip = if (ownShipOn) fix else null,
                trail = flown,
                follow = following,
                onDragged = { following = false },
            )
            MapButtons(ownShip = ownShipMode, onOwnShip = onOwnShip, modifier = Modifier.align(Alignment.TopEnd))
        }
    }
}
