package app.sshpult.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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

// ---- The SAFAB mark: a squared "S" drawn in one stroke, followed by a terminal cursor --------

/** Corner points of the "S", in a 0..1 box. The launcher icon uses the same geometry. */
private val MarkPoints = listOf(0.66f to 0.22f, 0.30f to 0.22f, 0.30f to 0.50f, 0.62f to 0.50f, 0.62f to 0.78f, 0.24f to 0.78f)

/**
 * @param from,to which part of the stroke is drawn (0..1 along its length) — used to animate it
 * @param cursorAlpha opacity of the cursor block
 */
@Composable
fun SafabMark(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
    cursor: Color = accent,
    from: Float = 0f, to: Float = 1f, cursorAlpha: Float = 1f,
) {
    Canvas(modifier) {
        val s = size.minDimension
        val ox = (size.width - s) / 2
        val oy = (size.height - s) / 2
        val full = Path().apply {
            MarkPoints.forEachIndexed { i, (x, y) ->
                if (i == 0) moveTo(ox + x * s, oy + y * s) else lineTo(ox + x * s, oy + y * s)
            }
        }
        val shown = if (from <= 0f && to >= 1f) full else Path().also { part ->
            val measure = PathMeasure().apply { setPath(full, false) }
            measure.getSegment(measure.length * from.coerceIn(0f, 1f), measure.length * to.coerceIn(0f, 1f), part, true)
        }
        if (to > from) {
            drawPath(shown, color, style = Stroke(width = s * 0.11f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        drawRoundRect(
            cursor.copy(alpha = cursor.alpha * cursorAlpha.coerceIn(0f, 1f)),
            topLeft = Offset(ox + s * 0.71f, oy + s * 0.655f), size = Size(s * 0.105f, s * 0.18f),
            cornerRadius = CornerRadius(s * 0.02f),
        )
    }
}

/** The mark on its ink tile — the app's avatar, same as the launcher icon. */
@Composable
fun SafabAvatar(size: Dp, modifier: Modifier = Modifier, animated: Boolean = false) {
    Box(
        modifier.size(size).clip(RoundedCornerShape(size * 0.26f)).background(Color(0xFF161616)),
        contentAlignment = Alignment.Center,
    ) {
        if (animated) SafabLoader(size * 0.86f, color = Color(0xFFFAFAF7), cursor = Color(0xFFFF7A4D))
        else SafabMark(Modifier.size(size * 0.86f), color = Color(0xFFFAFAF7), cursor = Color(0xFFFF7A4D))
    }
}

/**
 * The loading indicator of the app: the "S" is erased and written again in a loop while the
 * cursor blinks. Starts from the complete mark, so it also reads well as a still image.
 */
@Composable
fun SafabLoader(
    size: Dp, modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface, cursor: Color = accent,
) {
    val transition = rememberInfiniteTransition(label = "safab")
    val t by transition.animateFloat(
        0f, 1f, infiniteRepeatable(tween(2200, easing = LinearEasing), RepeatMode.Restart), label = "stroke",
    )
    val blink by transition.animateFloat(
        1f, 1f,
        infiniteRepeatable(keyframes { durationMillis = 900; 1f at 0; 1f at 450; 0.15f at 451; 0.15f at 899 }),
        label = "cursor",
    )
    // 0–0.15 hold · 0.15–0.45 erase from the start · 0.45–0.9 write again · 0.9–1 hold
    val from = if (t in 0.15f..0.45f) FastOutSlowInEasing.transform((t - 0.15f) / 0.30f) else 0f
    val to = when {
        t < 0.45f -> 1f
        t < 0.90f -> FastOutSlowInEasing.transform((t - 0.45f) / 0.45f)
        else -> 1f
    }
    SafabMark(modifier.size(size), color, cursor, from = if (t < 0.45f) from else 0f, to = to, cursorAlpha = blink)
}

/** Draws the mark once (used where the logo makes an entrance, e.g. the About sheet). */
@Composable
fun SafabMarkIntro(size: Dp, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
    val progress = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(900, easing = FastOutSlowInEasing))
    }
    SafabMark(modifier.size(size), color, to = progress.value, cursorAlpha = if (progress.value > 0.85f) 1f else 0f)
}

/** Wordmark: the avatar and the name in wide-set mono capitals. */
@Composable
fun SafabWordmark(modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        SafabAvatar(30.dp)
        Spacer(Modifier.width(10.dp))
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
