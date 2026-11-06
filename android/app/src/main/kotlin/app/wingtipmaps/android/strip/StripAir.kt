package app.wingtipmaps.android.strip

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.wingtipmaps.android.Plan
import app.wingtipmaps.android.ui.FiguresStrip

/**
 * The strip in the air, the sheet's first rows at every size: the ribbon
 * with the airplane on it, the flown part grey and the way ahead magenta
 * (RibbonLine), the next checkpoint large under it -- its name, the leg's
 * heading, miles and minutes, the planner's own -- and the flight's
 * figures (FiguresStrip, the tabs layout's own). The field under them is
 * the radio (FieldRow with `flying`). Everything here is read at arm's
 * length: one large thing, the figures at 26 points and more.
 */
@Composable
fun StripAir(state: Plan.State, rows: List<StripRow>, position: Position?, modifier: Modifier = Modifier) {
    val points = StripData.ribbonPoints(rows)
    // The next point: the end of the leg the airplane is on; the first
    // leg's with no fix yet.
    val next = rows.drop(1).getOrNull(position?.leg ?: 0)
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        RibbonLine(points = points, position = position)
        if (next != null) {
            val (name, leg) = when (next) {
                is StripRow.Checkpoint -> next.name to next.leg
                is StripRow.Stop -> next.ident to next.leg
                is StripRow.Destination -> next.ident to next.leg
                is StripRow.Departure -> next.ident to null
            }
            Column(Modifier.semantics { contentDescription = "Next: $name" }) {
                Text("NEXT", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (leg != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Bottom) {
                        Text(StripData.legFigures(leg), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        leg.eteMin?.let { Text(StripData.duration(it), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
        FiguresStrip(state)
    }
}
