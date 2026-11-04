package app.wingtipmaps.android.strip

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The Chart ink look (the owner's canvas, 2026-11-04: "I like chart ink
 * and glass cockpit only"), as a Material 3 colour scheme: the app in the
 * FAA sectional's own ink. By day a paper ground (#f7f2e7) under white
 * cards; the chart's magenta for the route and an ident at the head, its
 * brown for a checkpoint's mark, its green for a field; one tint for
 * everything tappable (#0a84ff), amber for a caution, green for go. At
 * night the canvas's charcoal ground and cards, a light teal for what can
 * be tapped (white words on it would read 1.9:1, so its own dark words
 * sit on it), a lighter magenta. The same values as the web app's
 * index.css `[data-brand="ink"]` tokens; the phone's own Material You
 * colours are left aside here, since the ink is the identity.
 */
object ChartInk {
    val paper = Color(0xFFF7F2E7)
    val paperDeep = Color(0xFFEFE8DA)
    val paperEdge = Color(0xFFE2D8C4)
    val inkText = Color(0xFF1F1A14)
    val inkMuted = Color(0xFF5A5048)
    val tint = Color(0xFF0A84FF)
    val magenta = Color(0xFFB3338C)
    val brown = Color(0xFF8A5A2B)
    val field = Color(0xFF1D7A46)
    val caution = Color(0xFFFF9F0A)
    val go = Color(0xFF34C759)
    /** The web's caution and go as words, dark enough to read on paper. */
    val cautionInk = Color(0xFF8A4B00)
    val goInk = Color(0xFF1D7A46)
    val stopInk = Color(0xFFC0392B)

    val nightGround = Color(0xFF14161C)
    val nightCard = Color(0xFF1D2027)
    val nightRaised = Color(0xFF262A33)
    val nightText = Color(0xFFEEF1F5)
    val nightMuted = Color(0xFFA9AEB8)
    val nightTint = Color(0xFF5AC8FA)
    val nightMagenta = Color(0xFFFF5AC8)
    val nightGo = Color(0xFF35D07F)
    val nightCaution = Color(0xFFF9CD8C)
    val nightStop = Color(0xFFFF6B6B)

    val light: ColorScheme = lightColorScheme(
        primary = tint,
        onPrimary = Color.White,
        primaryContainer = Color(0xFFDCEBFF),
        onPrimaryContainer = Color(0xFF003A75),
        secondary = inkMuted,
        onSecondary = Color.White,
        secondaryContainer = paperDeep,
        onSecondaryContainer = inkText,
        tertiary = magenta,
        onTertiary = Color.White,
        background = paper,
        onBackground = inkText,
        surface = paper,
        onSurface = inkText,
        surfaceVariant = paperDeep,
        onSurfaceVariant = inkMuted,
        surfaceContainerLowest = Color.White,
        surfaceContainerLow = Color.White,
        surfaceContainer = Color.White,
        surfaceContainerHigh = paperDeep,
        surfaceContainerHighest = paperDeep,
        outline = paperEdge,
        outlineVariant = paperEdge,
        error = stopInk,
        onError = Color.White,
    )

    val dark: ColorScheme = darkColorScheme(
        primary = nightTint,
        onPrimary = nightGround,
        primaryContainer = Color(0xFF0F3A52),
        onPrimaryContainer = nightTint,
        secondary = nightMuted,
        onSecondary = nightGround,
        secondaryContainer = nightRaised,
        onSecondaryContainer = nightText,
        tertiary = nightMagenta,
        onTertiary = nightGround,
        background = nightGround,
        onBackground = nightText,
        surface = nightGround,
        onSurface = nightText,
        surfaceVariant = nightRaised,
        onSurfaceVariant = nightMuted,
        surfaceContainerLowest = nightCard,
        surfaceContainerLow = nightCard,
        surfaceContainer = nightCard,
        surfaceContainerHigh = nightRaised,
        surfaceContainerHighest = nightRaised,
        outline = Color(0xFF3A3F4A),
        outlineVariant = Color(0xFF2E323B),
        error = nightStop,
        onError = nightGround,
    )
}

/** The inks beyond Material's roles: the course's magenta, a checkpoint's
 *  brown, a field's green, a caution and a go as marks and as words. */
@Immutable
data class InkColors(
    val magenta: Color,
    val brown: Color,
    val field: Color,
    val caution: Color,
    val cautionInk: Color,
    val go: Color,
    val goInk: Color,
    val stopInk: Color,
    val flown: Color,
) {
    /** A finding's colour as words, 4.5:1 and more on a card. */
    fun words(finding: Finding, muted: Color): Color = when (finding) {
        Finding.OK -> goInk
        Finding.CAUTION -> cautionInk
        Finding.STOP -> stopInk
        Finding.UNKNOWN, Finding.PENDING -> muted
    }
}

val LocalInk = staticCompositionLocalOf {
    InkColors(
        magenta = ChartInk.magenta, brown = ChartInk.brown, field = ChartInk.field,
        caution = ChartInk.caution, cautionInk = ChartInk.cautionInk, go = ChartInk.go, goInk = ChartInk.goInk,
        stopInk = ChartInk.stopInk, flown = Color(0xFF8E8E93),
    )
}

/** The strip's shapes: 18-point corners on a card, as the canvas draws
 *  them; a chip stays Material's own capsule. */
val StripShapes = Shapes(
    extraSmall = RoundedCornerShape(7.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(18.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/**
 * The type roles the canvas names, in Material's scale: text at 17/15/13
 * (body large, body medium, body small), figures bold and tabular, and a
 * figure's label, an ident or a word button in letterspaced capitals --
 * the canvas's Barlow Condensed, here the system face with tracking,
 * since the app bundles no font.
 */
val StripTypography = Typography(
    headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 32.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 17.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 15.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.8.sp),
    labelMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.8.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 16.sp, letterSpacing = 0.8.sp),
)

/** The strip layout's theme: the ink scheme by day or night with the
 *  system, over whatever theme the app's root set. */
@Composable
fun StripTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val ink = if (dark) {
        InkColors(
            magenta = ChartInk.nightMagenta, brown = ChartInk.brown, field = ChartInk.field,
            caution = ChartInk.nightCaution, cautionInk = ChartInk.nightCaution, go = ChartInk.nightGo, goInk = ChartInk.nightGo,
            stopInk = ChartInk.nightStop, flown = ChartInk.nightMuted,
        )
    } else {
        LocalInk.current
    }
    CompositionLocalProvider(LocalInk provides ink) {
        MaterialTheme(
            colorScheme = if (dark) ChartInk.dark else ChartInk.light,
            shapes = StripShapes,
            typography = StripTypography,
            content = content,
        )
    }
}
