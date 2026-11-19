package com.safarzod.jarvis.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.safarzod.jarvis.R

@Immutable
data class Palette(
    val bg: Color = Color(0xFF04060A),
    val bgRaised: Color = Color(0xFF0A0F16),
    val glass: Color = Color(0x12FFFFFF),
    val glassHi: Color = Color(0x1FFFFFFF),
    val stroke: Color = Color(0x22FFFFFF),
    val strokeSoft: Color = Color(0x12FFFFFF),
    val text: Color = Color(0xFFEAF4FF),
    val text2: Color = Color(0xB3C9D8E6),
    val text3: Color = Color(0x80A9BBCB),
    val accent: Color = Color(0xFF5BE3FF),
    val accentDeep: Color = Color(0xFF1C6CFF),
    val onAccent: Color = Color(0xFF021018),
    val danger: Color = Color(0xFFFF6B7A),
    val success: Color = Color(0xFF5CFFB4),
    val warn: Color = Color(0xFFFFC56B),
    val violet: Color = Color(0xFFB69CFF),
)

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, weight: Int) = Font(
    res, weight = FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

val Display = FontFamily(
    variable(R.font.unbounded, 300), variable(R.font.unbounded, 400), variable(R.font.unbounded, 500),
    variable(R.font.unbounded, 600), variable(R.font.unbounded, 700),
)
val Body = FontFamily(
    variable(R.font.manrope, 400), variable(R.font.manrope, 500), variable(R.font.manrope, 600),
    variable(R.font.manrope, 700), variable(R.font.manrope, 800),
)
val Mono = FontFamily(
    variable(R.font.jetbrains_mono, 400), variable(R.font.jetbrains_mono, 500), variable(R.font.jetbrains_mono, 600),
)

private val tight = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

@Immutable
data class Type(
    val hero: TextStyle = TextStyle(fontFamily = Display, fontWeight = FontWeight(500), fontSize = 34.sp, lineHeight = 40.sp, letterSpacing = (-0.02).em),
    val title: TextStyle = TextStyle(fontFamily = Display, fontWeight = FontWeight(500), fontSize = 22.sp, lineHeight = 28.sp, letterSpacing = (-0.01).em),
    val wordmark: TextStyle = TextStyle(fontFamily = Display, fontWeight = FontWeight(600), fontSize = 13.sp, letterSpacing = 0.32.em),
    val big: TextStyle = TextStyle(fontFamily = Display, fontWeight = FontWeight(400), fontSize = 52.sp, lineHeight = 56.sp, letterSpacing = (-0.03).em),
    val reply: TextStyle = TextStyle(fontFamily = Body, fontWeight = FontWeight(600), fontSize = 22.sp, lineHeight = 29.sp, letterSpacing = (-0.005).em, lineHeightStyle = tight),
    val live: TextStyle = TextStyle(fontFamily = Body, fontWeight = FontWeight(500), fontSize = 24.sp, lineHeight = 31.sp),
    val bodyL: TextStyle = TextStyle(fontFamily = Body, fontWeight = FontWeight(500), fontSize = 17.sp, lineHeight = 24.sp),
    val body: TextStyle = TextStyle(fontFamily = Body, fontWeight = FontWeight(500), fontSize = 15.sp, lineHeight = 21.sp),
    val bodyS: TextStyle = TextStyle(fontFamily = Body, fontWeight = FontWeight(500), fontSize = 13.sp, lineHeight = 18.sp),
    val label: TextStyle = TextStyle(fontFamily = Body, fontWeight = FontWeight(700), fontSize = 15.sp, lineHeight = 20.sp),
    val mono: TextStyle = TextStyle(fontFamily = Mono, fontWeight = FontWeight(500), fontSize = 11.sp, letterSpacing = 0.16.em),
    val monoL: TextStyle = TextStyle(fontFamily = Mono, fontWeight = FontWeight(500), fontSize = 13.sp, letterSpacing = 0.08.em),
)

val LocalPalette = staticCompositionLocalOf { Palette() }
val LocalType = staticCompositionLocalOf { Type() }

object J {
    val c: Palette @Composable get() = LocalPalette.current
    val t: Type @Composable get() = LocalType.current
}

@Composable
fun JarvisTheme(accent: Color, content: @Composable () -> Unit) {
    val palette = Palette(accent = accent, accentDeep = accent.deep())
    val scheme = darkColorScheme(
        primary = palette.accent, onPrimary = palette.onAccent, background = palette.bg, surface = palette.bgRaised,
        onBackground = palette.text, onSurface = palette.text, error = palette.danger, surfaceVariant = palette.glass,
        onSurfaceVariant = palette.text2, outline = palette.stroke,
    )
    CompositionLocalProvider(LocalPalette provides palette, LocalType provides Type()) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

/** Более глубокий оттенок акцента для градиентов и второго цвета ядра. */
fun Color.deep(): Color = Color(
    red = (red * 0.35f).coerceIn(0f, 1f),
    green = (green * 0.45f + 0.05f).coerceIn(0f, 1f),
    blue = (blue * 0.9f + 0.1f).coerceIn(0f, 1f),
)
