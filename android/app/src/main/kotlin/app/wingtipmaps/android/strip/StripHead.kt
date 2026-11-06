package app.wingtipmaps.android.strip

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** A finding's glyph, as the web's FindingIcon draws it. */
@Composable
fun FindingIcon(finding: Finding, modifier: Modifier = Modifier) {
    val ink = LocalInk.current
    val (icon, tint) = when (finding) {
        Finding.OK -> Icons.Filled.CheckCircle to ink.goInk
        Finding.CAUTION -> Icons.Filled.Warning to ink.cautionInk
        Finding.STOP -> Icons.Filled.Cancel to ink.stopInk
        Finding.UNKNOWN, Finding.PENDING -> Icons.AutoMirrored.Filled.HelpOutline to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Icon(icon, contentDescription = null, tint = tint, modifier = modifier)
}

/** A card of the strip: 18-point corners, white on the paper, a hair of
 *  shadow (the canvas's boards). */
@Composable
fun StripCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest)
    val elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    if (onClick != null) {
        Card(onClick = onClick, modifier = modifier, shape = MaterialTheme.shapes.large, colors = colors, elevation = elevation) { content() }
    } else {
        Card(modifier = modifier, shape = MaterialTheme.shapes.large, colors = colors, elevation = elevation) { content() }
    }
}

/**
 * The strip's head: the verdict -- go, caution or no-go, in the Brief's
 * words -- on a paper card, the route's line under it in letterspaced
 * capitals ("C81 → KJVL → KDLH · C172 · FL-045 · leaving now"), the
 * route's other ways as chips where there are any, and at most three
 * one-line actions from the glance, each a row into the Brief. Until the
 * brief is on this phone the verdict reads "Reading the brief…", as the
 * web's does before its briefing answers.
 */
@Composable
fun StripHead(
    verdict: Verdict?,
    line: String?,
    actions: List<GlanceAction>,
    ways: List<Way>,
    wayKey: String?,
    onWay: (String) -> Unit,
    onAction: (GlanceAction) -> Unit,
    onBrief: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ink = LocalInk.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        StripCard(onClick = onBrief, modifier = Modifier.fillMaxWidth().semantics { contentDescription = "The flight" }) {
            Column(Modifier.padding(16.dp).heightIn(min = 80.dp), verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.Bottom)) {
                if (verdict != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        FindingIcon(verdict.finding, Modifier.size(24.dp))
                        Text(
                            verdict.words, style = MaterialTheme.typography.titleLarge,
                            color = ink.words(verdict.finding, MaterialTheme.colorScheme.onSurfaceVariant),
                        )
                    }
                } else {
                    Text("Reading the brief…", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (line != null) {
                    Text(
                        line.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (ways.size > 1) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ways.forEach { way ->
                    FilterChip(selected = way.key == wayKey, onClick = { onWay(way.key) }, label = { Text(way.label) })
                }
            }
        }
        actions.take(3).forEach { action ->
            StripCard(onClick = { onAction(action) }, modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(action.line, style = MaterialTheme.typography.bodyLarge) },
                    leadingContent = { FindingIcon(action.finding, Modifier.size(20.dp)) },
                    trailingContent = {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                )
            }
        }
    }
}
