package app.sshpult.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

const val APP_NAME = "SAFAB"
const val DEVELOPER_TELEGRAM = "bob_proger"
const val DEVELOPER_TELEGRAM_URL = "https://t.me/$DEVELOPER_TELEGRAM"

// ---- The SAFAB mark --------------------------------------------------------------------------
// One smooth ribbon bent into an "S" — an SSH tunnel — and a warm node that has just left it.
// All coordinates are on a 512 grid; the launcher icon and docs/brand files use the same numbers.

private const val GRID = 512f
private const val STROKE = 52f
private const val TURN = 46f           // radius of the two half-turns
private const val NODE_X = 366f
private const val NODE_Y = 164f
private const val NODE_R = 26f
private val Paper = Color(0xFFFAFAF7)
private val PaperShade = Color(0xFFE2DFD6)
private val NodeLight = Color(0xFFFF9A6B)
private val NodeDeep = Color(0xFFF04E23)

/** The ribbon from its head (top right, next to the node) to its tail (bottom left). */
private fun ribbon(scale: Float, ox: Float, oy: Float): Path = Path().apply {
    fun x(v: Float) = ox + v * scale
    fun y(v: Float) = oy + v * scale
    moveTo(x(292f), y(164f))
    lineTo(x(204f), y(164f))
    arcTo(Rect(x(204f - TURN), y(164f), x(204f + TURN), y(256f)), 270f, -180f, false)
    lineTo(x(308f), y(256f))
    arcTo(Rect(x(308f - TURN), y(256f), x(308f + TURN), y(348f)), 270f, 180f, false)
    lineTo(x(160f), y(348f))
}

/**
 * @param drawn how much of the ribbon is visible, growing from the tail towards the node (0..1)
 * @param erased how much is hidden again, starting from the tail (0..1) — for the looping loader
 * @param node scale of the node (0 = hidden, 1 = resting size, >1 = overshoot)
 * @param glow strength of the halo around the node (0..1)
 * @param shaded draw the ribbon with its soft light-to-shade gradient (on the dark tile)
 */
@Composable
fun SafabMark(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
    shaded: Boolean = false,
    drawn: Float = 1f, erased: Float = 0f, node: Float = 1f, glow: Float = 0.5f,
) {
    Canvas(modifier) {
        val side = size.minDimension
        val scale = side / GRID
        val ox = (size.width - side) / 2
        val oy = (size.height - side) / 2
        val full = ribbon(scale, ox, oy)
        val measure = PathMeasure().apply { setPath(full, false) }
        val length = measure.length
        // The path runs head -> tail, the animation grows tail -> head.
        val start = length * (1f - drawn.coerceIn(0f, 1f))
        val stop = length * (1f - erased.coerceIn(0f, 1f))
        if (stop - start > 0.5f) {
            val part = if (start <= 0f && stop >= length) full else Path().also { measure.getSegment(start, stop, it, true) }
            val brush = if (shaded) Brush.linearGradient(listOf(Color.White, PaperShade), Offset(ox, oy), Offset(ox + side, oy + side))
            else SolidColor(color)
            drawPath(part, brush, style = Stroke(STROKE * scale, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        if (node > 0.01f) {
            val center = Offset(ox + NODE_X * scale, oy + NODE_Y * scale)
            val r = NODE_R * scale * node
            if (glow > 0.01f) {
                drawCircle(
                    Brush.radialGradient(listOf(NodeDeep.copy(alpha = 0.55f * glow.coerceIn(0f, 1f)), Color.Transparent), center, r * 2.6f),
                    r * 2.6f, center,
                )
            }
            drawCircle(Brush.linearGradient(listOf(NodeLight, NodeDeep), center - Offset(r, r), center + Offset(r, r)), r, center)
        }
    }
}

/** The mark on its graphite tile — the app's avatar, identical to the launcher icon. */
@Composable
fun SafabAvatar(size: Dp, modifier: Modifier = Modifier, animated: Boolean = false) {
    Box(
        modifier.size(size).clip(RoundedCornerShape(size * 0.28f))
            .background(Brush.verticalGradient(listOf(Color(0xFF242422), Color(0xFF0B0B0A)))),
        contentAlignment = Alignment.Center,
    ) {
        if (animated) SafabLoader(size, shaded = true) else SafabMark(Modifier.size(size), shaded = true)
    }
}

/**
 * The loading indicator: the ribbon retracts into its tail and is drawn again, and when it
 * arrives the node pops with a small overshoot and a pulse of light. The first frame is the
 * complete mark, so it also reads well as a still image.
 */
@Composable
fun SafabLoader(
    size: Dp, modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface, shaded: Boolean = false,
) {
    val transition = rememberInfiniteTransition(label = "safab")
    val t by transition.animateFloat(
        0f, 1f, infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Restart), label = "phase",
    )
    fun span(from: Float, to: Float) = ((t - from) / (to - from)).coerceIn(0f, 1f)
    val ease = FastOutSlowInEasing
    // 0.00–0.12 rest · 0.12–0.42 ribbon leaves (node fades) · 0.42–0.80 ribbon returns · 0.80–1.00 node pops
    val leaving = t < 0.42f
    val erased = if (leaving) ease.transform(span(0.12f, 0.42f)) else 0f
    val drawn = if (leaving) 1f else ease.transform(span(0.42f, 0.80f))
    val pop = span(0.78f, 0.96f)
    val node = when {
        t < 0.12f -> 1f
        leaving -> 1f - ease.transform(span(0.12f, 0.26f))
        else -> if (pop <= 0f) 0f else 1f + 0.28f * kotlin.math.sin(pop * Math.PI).toFloat() * (1f - pop) + (ease.transform(pop) - 1f)
    }
    val glow = when {
        t < 0.12f -> 0.5f
        leaving -> 0.5f * (1f - span(0.12f, 0.26f))
        else -> 0.5f + 0.5f * kotlin.math.sin(span(0.80f, 1f) * Math.PI).toFloat()
    }
    SafabMark(modifier.size(size), color, shaded, drawn = drawn, erased = erased, node = node.coerceAtLeast(0f), glow = glow)
}

/** Draws the mark once (where the logo makes an entrance). */
@Composable
fun SafabMarkIntro(size: Dp, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
    val progress = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(1100, easing = FastOutSlowInEasing))
    }
    val p = progress.value
    SafabMark(modifier.size(size), color, drawn = (p / 0.8f).coerceAtMost(1f), node = ((p - 0.75f) / 0.25f).coerceIn(0f, 1f))
}

/** Wordmark: the avatar and the name in wide-set mono capitals. */
@Composable
fun SafabWordmark(modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        SafabAvatar(34.dp)
        Spacer(Modifier.width(11.dp))
        Text(
            APP_NAME, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 18.sp,
            letterSpacing = 3.sp, color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

// ---- Own building blocks instead of the stock Material ones -----------------------------------

/** Plain screen header: back, title, actions. No tinting, no elevation. */
@Composable
fun ScreenHeader(
    title: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    navigationIcon: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background).statusBarsPadding()
            .heightIn(min = 56.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        navigationIcon()
        Box(Modifier.weight(1f).padding(start = 8.dp, end = 8.dp)) {
            ProvideTextStyle(MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold, fontSize = 20.sp)) { title() }
        }
        Row(verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

/** Square icon button with a hairline frame (or solid ink when [filled]). */
@Composable
fun SquareButton(
    icon: Int, description: String, onClick: () -> Unit,
    modifier: Modifier = Modifier, filled: Boolean = false, enabled: Boolean = true,
) {
    val shape = RoundedCornerShape(12.dp)
    val scheme = MaterialTheme.colorScheme
    Box(
        modifier.size(44.dp).clip(shape)
            .then(if (filled) Modifier.background(scheme.primary) else Modifier.border(1.dp, scheme.outlineVariant, shape))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), description, Modifier.size(20.dp), tint = if (filled) scheme.onPrimary else scheme.onSurface)
    }
}

/**
 * Text field in the app's own style: a small caption above a flat, hairline-framed box that
 * turns ink-coloured when focused. Parameters mirror the Material text field it replaces.
 */
@Composable
fun SafabField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: @Composable (() -> Unit)? = null,
    placeholder: @Composable (() -> Unit)? = null,
    supportingText: @Composable (() -> Unit)? = null,
    trailingIcon: @Composable (() -> Unit)? = null,
    isError: Boolean = false,
    enabled: Boolean = true,
    singleLine: Boolean = false,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    textStyle: TextStyle = LocalTextStyle.current,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val scheme = MaterialTheme.colorScheme
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val frame = when {
        isError -> scheme.error
        focused -> scheme.primary
        else -> scheme.outlineVariant
    }
    val shape = RoundedCornerShape(12.dp)
    // Caption, box and helper text form one unit for accessibility services (and UI tests).
    Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label != null) {
            CompositionLocalProvider(LocalContentColor provides if (isError) scheme.error else scheme.onSurfaceVariant) {
                ProvideTextStyle(MaterialTheme.typography.labelMedium.copy(letterSpacing = 0.4.sp)) {
                    Box(Modifier.padding(start = 2.dp)) { label() }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().clip(shape).background(scheme.surfaceContainerLowest)
                .border(if (focused || isError) 1.5.dp else 1.dp, frame, shape)
                .heightIn(min = 50.dp).padding(start = 14.dp, end = if (trailingIcon != null) 2.dp else 14.dp),
            verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
        ) {
            Box(Modifier.weight(1f).padding(vertical = 13.dp), contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart) {
                if (value.isEmpty() && placeholder != null) {
                    CompositionLocalProvider(LocalContentColor provides scheme.outline) {
                        ProvideTextStyle(textStyle.merge(TextStyle(fontSize = 16.sp))) { placeholder() }
                    }
                }
                BasicTextField(
                    value = value, onValueChange = onValueChange, enabled = enabled, singleLine = singleLine,
                    minLines = minLines, maxLines = maxLines,
                    textStyle = TextStyle(fontSize = 16.sp).merge(textStyle).copy(color = if (enabled) scheme.onSurface else scheme.outline),
                    cursorBrush = SolidColor(accent),
                    keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
                    visualTransformation = visualTransformation, interactionSource = interaction,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (trailingIcon != null) trailingIcon()
        }
        if (supportingText != null) {
            CompositionLocalProvider(LocalContentColor provides if (isError) scheme.error else scheme.onSurfaceVariant) {
                ProvideTextStyle(MaterialTheme.typography.bodySmall) { Box(Modifier.padding(start = 2.dp)) { supportingText() } }
            }
        }
    }
}

/** Section caption in wide-set small capitals. */
@Composable
fun Caption(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(), modifier, style = MaterialTheme.typography.labelSmall, letterSpacing = 1.2.sp,
        fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
