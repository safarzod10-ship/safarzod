package com.safarzod.jarvis.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Keyboard
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.safarzod.jarvis.core.Engine
import com.safarzod.jarvis.core.Phase
import com.safarzod.jarvis.core.UiAction
import com.safarzod.jarvis.core.UiState
import com.safarzod.jarvis.gl.CoreParams
import com.safarzod.jarvis.ui.components.Bars
import com.safarzod.jarvis.ui.components.MicOrb
import com.safarzod.jarvis.ui.components.RoundIconButton
import com.safarzod.jarvis.ui.components.StatusDot
import com.safarzod.jarvis.ui.components.Chip
import com.safarzod.jarvis.ui.components.glass
import com.safarzod.jarvis.ui.theme.J
import kotlinx.coroutines.delay

@Composable
fun HomeScreen(
    engine: Engine,
    params: CoreParams,
    onOpen: (String) -> Unit,
) {
    val ui by engine.ui.collectAsState()
    val micLevel by engine.speech.level.collectAsState()
    HomeContent(
        ui = ui, micLevel = micLevel, params = params,
        onMicTap = engine::onMicTap, onSubmit = engine::submitText, onAction = engine::onAction, onOpen = onOpen,
    )
}

/** Главный экран без зависимостей от движка (удобно для превью и скриншот-тестов). */
@Composable
fun HomeContent(
    ui: UiState,
    micLevel: Float,
    params: CoreParams,
    onMicTap: () -> Unit,
    onSubmit: (String) -> Unit,
    onAction: (UiAction) -> Unit,
    onOpen: (String) -> Unit,
    startTyping: Boolean = false,
) {
    var typing by rememberSaveable { mutableStateOf(startTyping) }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val density = LocalDensity.current
        val hPx = with(density) { maxHeight.toPx() }
        val wPx = with(density) { maxWidth.toPx() }
        val hasContent = ui.card != null || ui.reply != null || ui.userText != null || ui.partial.isNotEmpty()

        // Позиция и размер ядра: когда есть карточка или клавиатура — ядро поднимается и уменьшается
        LaunchedEffect(hasContent, typing, ui.card != null, hPx, wPx) {
            val minSide = minOf(wPx, hPx)
            val aspect = hPx / wPx.coerceAtLeast(1f)
            params.centerY = when {
                typing -> 0.20f
                ui.card != null -> 0.205f
                hasContent -> 0.30f
                else -> 0.38f
            }
            val base = if (aspect > 1.9f) 0.205f else 0.18f
            params.radius = (when {
                typing -> base * 0.62f
                ui.card != null -> base * 0.66f
                hasContent -> base * 0.86f
                else -> base
            }) * (wPx / minSide)
        }

        // жесты на области ядра: перетаскивание вращает, нажатие — говорить
        Box(
            Modifier
                .fillMaxWidth()
                .height(maxHeight * (if (ui.card != null || typing) 0.40f else 0.62f))
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { params.dragging = true },
                        onDragEnd = { params.dragging = false },
                        onDragCancel = { params.dragging = false },
                    ) { change, drag ->
                        change.consume()
                        params.dragDx += drag.x
                        params.dragDy += drag.y
                    }
                }
                .pointerInput(Unit) { detectTapGestures(onTap = { onMicTap() }) }
        )

        Column(Modifier.fillMaxSize()) {
            TopBar(ui, onOpen)
            Spacer(Modifier.weight(1f))
            Transcript(ui, typing, Modifier.padding(horizontal = 24.dp))
            Spacer(Modifier.height(14.dp))
            CardHost(ui, onAction, onOpen, Modifier.padding(horizontal = 16.dp))
            Spacer(Modifier.height(14.dp))
            AnimatedVisibility(
                visible = !typing && ui.card == null && ui.phase == Phase.STANDBY && ui.reply == null,
                enter = fadeIn(tween(400)), exit = fadeOut(tween(200)),
            ) { Suggestions { onSubmit(it) } }
            Dock(
                ui = ui, micLevel = micLevel, typing = typing,
                onTyping = { typing = it },
                onMic = onMicTap,
                onSend = onSubmit,
                onHistory = { onOpen("history") },
            )
        }

        Notice(ui.notice, Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 64.dp))
    }
}

@Composable
private fun TopBar(ui: UiState, onOpen: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(start = 22.dp, end = 14.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("ДЖАРВИС", style = J.t.wordmark, color = J.c.text)
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val (label, color, pulse) = when (ui.phase) {
                    Phase.OFF -> Triple("ВЫКЛЮЧЕН", J.c.text3, false)
                    Phase.LOADING -> Triple("ЗАГРУЗКА СИСТЕМ", J.c.warn, true)
                    Phase.STANDBY -> Triple(if (ui.micReady) "НА СВЯЗИ · ОФЛАЙН" else "ГОТОВ", J.c.success, true)
                    Phase.LISTENING -> Triple("СЛУШАЮ", J.c.accent, true)
                    Phase.THINKING -> Triple("ОБРАБОТКА", J.c.violet, true)
                    Phase.SPEAKING -> Triple("ОТВЕТ", J.c.accent, true)
                }
                StatusDot(color, pulse)
                Spacer(Modifier.width(4.dp))
                AnimatedContent(label, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(160)) }, label = "status") {
                    Text(it, style = J.t.mono, color = J.c.text2)
                }
            }
        }
        RoundIconButton(Icons.Rounded.Psychology, "Память") { onOpen("memory") }
        Spacer(Modifier.width(10.dp))
        RoundIconButton(Icons.Rounded.Tune, "Настройки") { onOpen("settings") }
    }
}

/** Что сказал пользователь и что ответил Джарвис. Ответ «печатается» под голос. */
@Composable
private fun Transcript(ui: UiState, typing: Boolean, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        when {
            ui.phase == Phase.LISTENING -> {
                if (ui.awaiting && ui.reply != null) {
                    Text(ui.reply, style = J.t.reply.copy(fontSize = J.t.bodyL.fontSize, lineHeight = J.t.bodyL.lineHeight), color = J.c.text2, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(12.dp))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Bars(J.c.accent, true)
                    Spacer(Modifier.width(8.dp))
                    Text(if (ui.awaiting) "ЖДУ ОТВЕТА" else "ГОВОРИТЕ", style = J.t.mono, color = J.c.accent)
                }
                Spacer(Modifier.height(10.dp))
                LiveText(ui.partial)
            }
            ui.phase == Phase.LOADING -> {
                Text("ИНИЦИАЛИЗАЦИЯ", style = J.t.mono, color = J.c.text3)
                Spacer(Modifier.height(8.dp))
                Text("Загружаю распознавание речи…", style = J.t.bodyL, color = J.c.text2, textAlign = TextAlign.Center)
            }
            else -> {
                AnimatedVisibility(ui.userText != null, enter = fadeIn(tween(250)), exit = fadeOut(tween(150))) {
                    Text(
                        "«${ui.userText ?: ""}»", style = J.t.body, color = J.c.text3, textAlign = TextAlign.Center,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (ui.phase == Phase.THINKING) {
                    Spacer(Modifier.height(12.dp))
                    ThinkingDots()
                } else if (ui.reply != null) {
                    Spacer(Modifier.height(10.dp))
                    TypeOut(ui.reply, ui.phase == Phase.SPEAKING)
                } else if (ui.phase == Phase.STANDBY && ui.userText == null && typing) {
                    Text("Напишите команду", style = J.t.reply.copy(fontWeight = J.t.body.fontWeight), color = J.c.text.copy(alpha = 0.85f))
                    Spacer(Modifier.height(6.dp))
                    Text("так же, как сказали бы вслух", style = J.t.body, color = J.c.text3)
                } else if (ui.phase == Phase.STANDBY && ui.userText == null) {
                    Text("Скажите «Джарвис»", style = J.t.reply.copy(fontWeight = J.t.body.fontWeight), color = J.c.text.copy(alpha = 0.85f))
                    Spacer(Modifier.height(6.dp))
                    Text("или нажмите на ядро", style = J.t.body, color = J.c.text3)
                }
            }
        }
    }
}

@Composable
private fun LiveText(text: String) {
    val inf = rememberInfiniteTransition(label = "caret")
    val caret by inf.animateFloat(1f, 0f, infiniteRepeatable(tween(520, easing = LinearEasing), RepeatMode.Reverse), label = "c")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text.ifEmpty { "" }.replaceFirstChar { it.uppercase() },
            style = J.t.live, color = J.c.text, textAlign = TextAlign.Center,
            maxLines = 3, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        Box(Modifier.padding(start = 3.dp).width(2.dp).height(26.dp).alpha(caret).background(J.c.accent, RoundedCornerShape(1.dp)))
    }
}

@Composable
private fun TypeOut(text: String, speaking: Boolean) {
    var shown by remember(text) { mutableStateOf(if (speaking) 0 else text.length) }
    LaunchedEffect(text) {
        while (shown < text.length) { delay(22); shown++ }
    }
    Text(
        text.take(shown) + if (shown < text.length) "▍" else "",
        style = J.t.reply,
        color = J.c.text,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ThinkingDots() {
    val inf = rememberInfiniteTransition(label = "think")
    val t by inf.animateFloat(0f, 3f, infiniteRepeatable(tween(1200, easing = LinearEasing)), label = "t")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (i in 0 until 3) {
            val a = 0.25f + 0.75f * (1f - ((t - i + 3f) % 3f).coerceAtMost(1f))
            Box(Modifier.size(8.dp).alpha(a).background(J.c.violet, RoundedCornerShape(4.dp)))
        }
    }
}

@Composable
private fun Suggestions(onPick: (String) -> Unit) {
    val items = listOf("Позвони маме", "Включи фонарик", "Какая погода", "Таймер на 5 минут", "Открой YouTube", "Что ты умеешь?")
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items.forEach { Chip(it) { onPick(it) } }
    }
}

@Composable
private fun Dock(
    ui: UiState,
    micLevel: Float,
    typing: Boolean,
    onTyping: (Boolean) -> Unit,
    onMic: () -> Unit,
    onSend: (String) -> Unit,
    onHistory: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, J.c.bg.copy(alpha = 0.85f))))
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 18.dp, vertical = 12.dp),
    ) {
        AnimatedContent(typing, transitionSpec = { (fadeIn(tween(220)) + scaleIn(initialScale = 0.96f)) togetherWith fadeOut(tween(120)) }, label = "dock") { isTyping ->
            if (isTyping) {
                TypeBar(onClose = { onTyping(false) }, onSend = { onSend(it) })
            } else {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    RoundIconButton(Icons.Rounded.Keyboard, "Написать", size = 52.dp) { onTyping(true) }
                    Spacer(Modifier.weight(1f))
                    MicOrb(
                        level = micLevel,
                        listening = ui.phase == Phase.LISTENING,
                        busy = ui.phase == Phase.THINKING || ui.phase == Phase.LOADING,
                        onClick = onMic,
                    )
                    Spacer(Modifier.weight(1f))
                    RoundIconButton(Icons.Rounded.History, "Журнал", size = 52.dp, onClick = onHistory)
                }
            }
        }
    }
}

@Composable
private fun TypeBar(onClose: () -> Unit, onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val kb = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { delay(150); runCatching { focus.requestFocus() } }
    val send = {
        if (text.isNotBlank()) { onSend(text.trim()); text = "" ; kb?.hide() }
    }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).glass(RoundedCornerShape(28.dp)).padding(start = 6.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(44.dp).clickable { kb?.hide(); onClose() }, contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Close, "Закрыть", tint = J.c.text2)
        }
        Box(Modifier.weight(1f).padding(vertical = 14.dp)) {
            if (text.isEmpty()) Text("Например: напиши маме, что я еду", style = J.t.bodyL, color = J.c.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
            BasicTextField(
                value = text, onValueChange = { text = it },
                textStyle = J.t.bodyL.copy(color = J.c.text),
                cursorBrush = SolidColor(J.c.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
                maxLines = 4,
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        }
        Box(
            Modifier.size(44.dp).background(if (text.isBlank()) Color.Transparent else J.c.accent, RoundedCornerShape(22.dp)).clickable { send() },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.AutoMirrored.Rounded.Send, "Отправить", tint = if (text.isBlank()) J.c.text3 else J.c.onAccent, modifier = Modifier.size(20.dp)) }
    }
}

@Composable
private fun Notice(text: String?, modifier: Modifier) {
    AnimatedVisibility(
        text != null, modifier,
        enter = slideInVertically(spring(dampingRatio = 0.7f)) { -it } + fadeIn(),
        exit = slideOutVertically { -it } + fadeOut(),
    ) {
        Text(
            text ?: "", style = J.t.bodyS, color = J.c.text,
            modifier = Modifier.glass(RoundedCornerShape(20.dp)).padding(horizontal = 18.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun CardHost(ui: UiState, onAction: (UiAction) -> Unit, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    AnimatedContent(
        targetState = ui.card,
        transitionSpec = {
            (slideInVertically(spring(dampingRatio = 0.82f, stiffness = 380f)) { it / 3 } + fadeIn(tween(260))) togetherWith
                (fadeOut(tween(160)))
        },
        label = "card",
        modifier = modifier,
    ) { card ->
        if (card != null) {
            Box(Modifier.fillMaxWidth().heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                ResultCard(card, onAction, onOpen)
            }
        } else Spacer(Modifier.height(0.dp))
    }
}
