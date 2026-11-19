package com.safarzod.jarvis.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AccessTime
import androidx.compose.material.icons.rounded.Alarm
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.BatteryChargingFull
import androidx.compose.material.icons.rounded.Calculate
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.ChatBubble
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.FlashlightOn
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SmartDisplay
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.safarzod.jarvis.core.CardIcon
import com.safarzod.jarvis.ui.theme.J
import kotlin.math.PI
import kotlin.math.sin

val CardShape = RoundedCornerShape(26.dp)

/** Стеклянная поверхность: мягкий градиент, тонкая светлая кромка сверху. */
fun Modifier.glass(shape: Shape = CardShape, tint: Color = Color.White, strength: Float = 1f): Modifier = this
    .clip(shape)
    .background(
        Brush.verticalGradient(
            listOf(tint.copy(alpha = 0.085f * strength), tint.copy(alpha = 0.035f * strength)),
        )
    )
    .border(
        BorderStroke(
            1.dp,
            Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.20f * strength), Color.White.copy(alpha = 0.04f * strength))),
        ),
        shape,
    )

@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(20.dp),
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.985f else 1f, spring(stiffness = 600f), label = "press")
    Column(
        modifier
            .scale(s)
            .glass()
            .then(if (onClick != null) Modifier.clickable(src, null, role = Role.Button, onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.96f else 1f, spring(stiffness = 700f), label = "btn")
    val haptic = LocalHapticFeedback.current
    val a = J.c.accent
    Row(
        modifier
            .scale(s)
            .height(56.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(
                if (enabled) Brush.linearGradient(listOf(a, Color(0xFFFFFFFF).copy(alpha = 0.92f).compositeOver(a, 0.25f)))
                else Brush.linearGradient(listOf(Color.White.copy(alpha = 0.08f), Color.White.copy(alpha = 0.05f)))
            )
            .clickable(src, null, enabled = enabled, role = Role.Button) { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); onClick() }
            .padding(horizontal = 22.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) { Icon(icon, null, tint = if (enabled) J.c.onAccent else J.c.text3, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)) }
        Text(text, style = J.t.label, color = if (enabled) J.c.onAccent else J.c.text3, maxLines = 1)
    }
}

@Composable
fun GhostButton(text: String, modifier: Modifier = Modifier, icon: ImageVector? = null, tint: Color = J.c.text, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.96f else 1f, spring(stiffness = 700f), label = "ghost")
    Row(
        modifier
            .scale(s)
            .height(48.dp)
            .glass(RoundedCornerShape(16.dp))
            .clickable(src, null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) { Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, style = J.t.label.copy(fontSize = J.t.body.fontSize), color = tint, maxLines = 1)
    }
}

@Composable
fun RoundIconButton(icon: ImageVector, contentDescription: String, modifier: Modifier = Modifier, size: Dp = 44.dp, tint: Color = J.c.text, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.9f else 1f, spring(stiffness = 700f), label = "round")
    Box(
        modifier
            .scale(s)
            .size(size)
            .glass(CircleShape)
            .clickable(src, null, role = Role.Button, onClickLabel = contentDescription, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription, tint = tint, modifier = Modifier.size(size * 0.45f)) }
}

@Composable
fun IconBadge(icon: ImageVector, tint: Color = J.c.accent, size: Dp = 40.dp) {
    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.32f))
            .background(Brush.linearGradient(listOf(tint.copy(alpha = 0.26f), tint.copy(alpha = 0.08f))))
            .border(1.dp, tint.copy(alpha = 0.28f), RoundedCornerShape(size * 0.32f)),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = tint, modifier = Modifier.size(size * 0.5f)) }
}

@Composable
fun Chip(text: String, modifier: Modifier = Modifier, selected: Boolean = false, onClick: () -> Unit) {
    val bg by animateColorAsState(if (selected) J.c.accent.copy(alpha = 0.18f) else Color.Transparent, label = "chip")
    Box(
        modifier
            .height(38.dp)
            .glass(RoundedCornerShape(19.dp), tint = if (selected) J.c.accent else Color.White)
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = J.t.bodyS.copy(fontWeight = J.t.label.fontWeight), color = if (selected) J.c.accent else J.c.text2, maxLines = 1) }
}

@Composable
fun SubTopBar(title: String, onBack: () -> Unit, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RoundIconButton(Icons.AutoMirrored.Rounded.ArrowBack, "Назад", onClick = onBack)
        Spacer(Modifier.width(14.dp))
        Text(title, style = J.t.title, color = J.c.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        actions()
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = J.t.mono, color = J.c.text3, modifier = modifier.padding(start = 6.dp, top = 22.dp, bottom = 10.dp))
}

/** Пульсирующая точка статуса. */
@Composable
fun StatusDot(color: Color, pulsing: Boolean, modifier: Modifier = Modifier) {
    val inf = rememberInfiniteTransition(label = "dot")
    val p by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(1600, easing = LinearEasing)), label = "p")
    Canvas(modifier.size(14.dp)) {
        val r = size.minDimension / 2
        if (pulsing) drawCircle(color.copy(alpha = (1f - p) * 0.5f), radius = r * (0.35f + p * 0.65f))
        drawCircle(color, radius = r * 0.32f)
    }
}

/** Большая кнопка микрофона: кольца дышат от громкости, вращающаяся дуга в режиме ожидания ответа. */
@Composable
fun MicOrb(level: Float, listening: Boolean, busy: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val a = J.c.accent
    val inf = rememberInfiniteTransition(label = "orb")
    val spin by inf.animateFloat(0f, 360f, infiniteRepeatable(tween(2400, easing = LinearEasing)), label = "spin")
    val breathe by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(2600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "breathe")
    val lv by animateFloatAsState(level, spring(stiffness = 300f), label = "lv")
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.92f else 1f, spring(stiffness = 600f, dampingRatio = 0.55f), label = "s")
    val haptic = LocalHapticFeedback.current
    Box(
        modifier
            .size(96.dp)
            .scale(s)
            .clickable(src, null, role = Role.Button, onClickLabel = if (listening) "Остановить" else "Говорить") {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress); onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(96.dp)) {
            val c = center
            val base = size.minDimension * 0.33f
            // внешние волны от голоса
            for (i in 0 until 3) {
                val k = i / 3f
                val rr = base * (1.12f + 0.32f * k + (if (listening) lv * 0.5f else breathe * 0.06f) * (1f - k * 0.3f))
                drawCircle(a.copy(alpha = (if (listening) 0.22f else 0.08f) * (1f - k)), radius = rr, center = c, style = Stroke(1.2.dp.toPx()))
            }
            // вращающаяся дуга
            if (listening || busy) {
                drawArc(
                    brush = Brush.sweepGradient(listOf(Color.Transparent, a, Color.Transparent), center = c),
                    startAngle = spin, sweepAngle = 140f, useCenter = false,
                    topLeft = Offset(c.x - base * 1.08f, c.y - base * 1.08f),
                    size = androidx.compose.ui.geometry.Size(base * 2.16f, base * 2.16f),
                    style = Stroke(2.dp.toPx()),
                )
            }
            // ядро кнопки
            drawCircle(
                Brush.radialGradient(
                    listOf(if (listening) a else a.copy(alpha = 0.9f), a.copy(alpha = 0.55f).compositeOver(Color(0xFF0A1A2A), 1f), Color(0xFF07121E)),
                    center = c.copy(y = c.y - base * 0.25f), radius = base * 1.25f,
                ),
                radius = base, center = c,
            )
            drawCircle(Color.White.copy(alpha = 0.22f), radius = base, center = c, style = Stroke(1.dp.toPx()))
        }
        Icon(Icons.Rounded.Mic, null, tint = J.c.onAccent, modifier = Modifier.size(30.dp))
    }
}

fun Color.compositeOver(bg: Color, amount: Float): Color = Color(
    red = red * amount + bg.red * (1 - amount),
    green = green * amount + bg.green * (1 - amount),
    blue = blue * amount + bg.blue * (1 - amount),
    alpha = 1f,
)

fun iconFor(i: CardIcon): ImageVector = when (i) {
    CardIcon.CLOCK -> Icons.Rounded.AccessTime
    CardIcon.CALENDAR -> Icons.Rounded.CalendarMonth
    CardIcon.BATTERY -> Icons.Rounded.BatteryChargingFull
    CardIcon.CALC -> Icons.Rounded.Calculate
    CardIcon.PHONE -> Icons.Rounded.Call
    CardIcon.MESSAGE -> Icons.Rounded.ChatBubble
    CardIcon.APP -> Icons.Rounded.Apps
    CardIcon.SEARCH -> Icons.Rounded.Search
    CardIcon.WEATHER -> Icons.Rounded.Cloud
    CardIcon.YOUTUBE -> Icons.Rounded.SmartDisplay
    CardIcon.MAP -> Icons.Rounded.Map
    CardIcon.MUSIC -> Icons.Rounded.MusicNote
    CardIcon.VOLUME -> Icons.Rounded.VolumeUp
    CardIcon.FLASH -> Icons.Rounded.FlashlightOn
    CardIcon.SETTINGS -> Icons.Rounded.Tune
    CardIcon.CAMERA -> Icons.Rounded.CameraAlt
    CardIcon.MEMORY -> Icons.Rounded.Memory
    CardIcon.TIMER -> Icons.Rounded.HourglassTop
    CardIcon.ALARM -> Icons.Rounded.Alarm
    CardIcon.REMINDER -> Icons.Rounded.NotificationsActive
    CardIcon.LOCK -> Icons.Rounded.Lock
    CardIcon.INFO -> Icons.Rounded.Info
    CardIcon.ERROR -> Icons.Rounded.ErrorOutline
    CardIcon.MIC -> Icons.Rounded.Mic
    CardIcon.NEURAL -> Icons.Rounded.Psychology
}

/** Анимированный «эквалайзер» из трёх полосок для заголовков статуса. */
@Composable
fun Bars(color: Color, active: Boolean, modifier: Modifier = Modifier) {
    val inf = rememberInfiniteTransition(label = "bars")
    val t by inf.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(900, easing = LinearEasing)), label = "t")
    Canvas(modifier.size(width = 14.dp, height = 12.dp)) {
        val w = size.width / 5
        for (i in 0 until 3) {
            val h = if (active) (0.35f + 0.65f * ((sin(t + i * 1.7f) + 1f) / 2f)) else 0.35f
            val bh = size.height * h
            drawRoundRect(color, topLeft = Offset(i * 2 * w, size.height - bh), size = androidx.compose.ui.geometry.Size(w, bh), cornerRadius = androidx.compose.ui.geometry.CornerRadius(w / 2))
        }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, body: String, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(vertical = 48.dp, horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        IconBadge(icon, size = 64.dp)
        Spacer(Modifier.height(18.dp))
        Text(title, style = J.t.title.copy(fontSize = J.t.bodyL.fontSize), color = J.c.text, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(body, style = J.t.body, color = J.c.text2, textAlign = TextAlign.Center)
    }
}

fun Modifier.accentGlow(color: Color, radius: Float = 0.6f): Modifier = drawBehind {
    drawCircle(Brush.radialGradient(listOf(color.copy(alpha = 0.25f), Color.Transparent), center = center, radius = size.maxDimension * radius))
}
