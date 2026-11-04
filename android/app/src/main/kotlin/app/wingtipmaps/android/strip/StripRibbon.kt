package app.wingtipmaps.android.strip

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Flight
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.wingtipmaps.android.Plan

/** The verdict's tag, as the ribbon wears it. */
private fun tagWords(finding: Finding): String? = when (finding) {
    Finding.OK -> "Go"
    Finding.CAUTION -> "Caution"
    Finding.STOP -> "No-go"
    else -> null
}

/**
 * The route's points on one line, in order: the fields' dots green, the
 * checkpoints' brown, the course's magenta line between them, each leg
 * the same width whatever its miles (a schematic, as a transit map's).
 * In the air (`position`: the leg flown and how far along it) the
 * airplane rides the line, what is flown grey behind it.
 */
@Composable
fun RibbonLine(points: List<RibbonPoint>, position: Position?, modifier: Modifier = Modifier) {
    if (points.size < 2) return
    val ink = LocalInk.current
    val legs = points.size - 1
    val at = position?.let { (it.leg + it.along.coerceIn(0.0, 1.0)).coerceIn(0.0, legs.toDouble()) }
    BoxWithConstraints(modifier.fillMaxWidth().height(16.dp).semantics { contentDescription = "The route: " + points.joinToString(" → ") { it.name } }) {
        val width = maxWidth
        Canvas(Modifier.fillMaxWidth().height(16.dp)) {
            val w = size.width
            val y = size.height / 2
            val step = w / legs
            val stroke = 4.dp.toPx()
            for (i in 0 until legs) {
                val x0 = i * step
                val x1 = (i + 1) * step
                // Flown legs grey, the one under the airplane grey as far as
                // it has come, the rest the course's magenta.
                if (at == null || at <= i) {
                    drawLine(ink.magenta, Offset(x0, y), Offset(x1, y), stroke, StrokeCap.Butt)
                } else if (at >= i + 1) {
                    drawLine(ink.flown, Offset(x0, y), Offset(x1, y), stroke, StrokeCap.Butt)
                } else {
                    val xm = x0 + ((at - i) * step).toFloat()
                    drawLine(ink.flown, Offset(x0, y), Offset(xm, y), stroke, StrokeCap.Butt)
                    drawLine(ink.magenta, Offset(xm, y), Offset(x1, y), stroke, StrokeCap.Butt)
                }
            }
            points.forEachIndexed { i, p ->
                val colour = if (at != null && i < at) ink.flown else if (p.field) ink.field else ink.brown
                drawCircle(colour, radius = (if (p.field) 5.dp else 4.dp).toPx(), center = Offset(i * step, y))
            }
        }
        if (at != null) {
            Icon(
                Icons.Filled.Flight, contentDescription = "The airplane", tint = ink.magenta,
                modifier = Modifier.size(16.dp).offset(x = width * (at / legs).toFloat() - 8.dp).rotate(90f),
            )
        }
    }
}

/**
 * The strip's ribbon, the first row of the sheet above the strip (the
 * field's row stays over it): the verdict's tag, the route's ends, its
 * time and fuel at the right, and under them the route's points on one
 * line (RibbonLine). With no route, the app's name and a word on what the
 * field takes. A screen over the strip (`over`: an airport's card, the
 * airplane, Settings, Ask) is named here with its close, so the way back
 * is where it always is.
 */
@Composable
fun StripRibbon(
    state: Plan.State,
    verdict: Verdict?,
    points: List<RibbonPoint>,
    position: Position?,
    over: StripModel.Over?,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ink = LocalInk.current
    if (over != null) {
        Box(modifier.fillMaxWidth().height(48.dp)) {
            Text(
                over.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.Center).padding(horizontal = 56.dp),
            )
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.CenterEnd)) {
                Icon(Icons.Filled.Close, contentDescription = "Back")
            }
        }
        return
    }
    val figures = StripData.ribbonFigures(state)
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val tag = verdict?.let { tagWords(it.finding) }
            if (verdict != null && tag != null) {
                val wash = when (verdict.finding) {
                    Finding.OK -> ink.field.copy(alpha = 0.14f)
                    Finding.CAUTION -> ink.caution.copy(alpha = 0.18f)
                    else -> MaterialTheme.colorScheme.error.copy(alpha = 0.10f)
                }
                Text(
                    tag.uppercase(), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                    color = ink.words(verdict.finding, MaterialTheme.colorScheme.onSurfaceVariant),
                    modifier = Modifier.background(wash, CircleShape).padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
            Text(
                when {
                    state.dest.isNotEmpty() -> "${state.dep.ifEmpty { "Here" }} → ${state.dest}"
                    state.dep.isNotEmpty() -> state.dep
                    else -> "Wingtip"
                },
                style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            if (figures.isNotEmpty()) {
                Text(figures, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (state.dest.isEmpty()) {
                Text("Where to, or ask", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        RibbonLine(points = points, position = position)
    }
}

/** The colour of a dot on the timeline's line, by what the point is. */
@Composable
fun pointColour(field: Boolean): Color = if (field) LocalInk.current.field else LocalInk.current.brown
