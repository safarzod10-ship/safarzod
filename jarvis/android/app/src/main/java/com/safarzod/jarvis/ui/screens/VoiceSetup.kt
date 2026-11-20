package com.safarzod.jarvis.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.safarzod.jarvis.JarvisApp
import com.safarzod.jarvis.core.VoiceCalibration
import com.safarzod.jarvis.service.JarvisService
import com.safarzod.jarvis.ui.components.GhostButton
import com.safarzod.jarvis.ui.components.GlassCard
import com.safarzod.jarvis.ui.components.PrimaryButton
import com.safarzod.jarvis.ui.components.SubTopBar
import com.safarzod.jarvis.ui.theme.J
import com.safarzod.jarvis.voice.SpeechEngine
import kotlinx.coroutines.launch

/**
 * Настройка голоса: человек читает 5 фраз, Джарвис подстраивается под его речь.
 * [embedded] — как шаг онбординга (без верхней панели).
 */
@Composable
fun VoiceSetupScreen(app: JarvisApp, embedded: Boolean, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val speech = app.engine.speech
    val cal = remember { VoiceCalibration(app.settings) }
    val scope = rememberCoroutineScope()
    val results = remember { mutableStateListOf<Pair<String, SpeechEngine.Enrollment>>() }
    var index by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf("ready") } // ready | loading | recording | heard | missed | done
    var heard by remember { mutableStateOf<SpeechEngine.Enrollment?>(null) }
    var summary by remember { mutableStateOf<VoiceCalibration.Summary?>(null) }
    val level by speech.level.collectAsState()
    val micGranted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    // микрофон нужен этому экрану: если служба ещё не запущена (онбординг) — поднимаем распознавание сами
    DisposableEffect(Unit) {
        app.engine.beginVoiceSetup()
        onDispose {
            if (!JarvisService.running) speech.stop()
            app.engine.endVoiceSetup()
        }
    }

    var recordJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    fun record() {
        recordJob?.cancel()
        heard = null
        recordJob = scope.launch {
            state = "loading"
            if (!speech.load()) { state = "missed"; return@launch }
            speech.start()
            state = "recording"
            val r = speech.enroll()
            heard = r
            if (r == null) { state = "missed"; return@launch }
            state = "heard"
        }
    }

    fun next() {
        heard?.let { results += cal.phrases[index] to it }
        heard = null
        if (index + 1 < cal.phrases.size) { index++; record() }
        else {
            summary = cal.finish(results)
            state = "done"
        }
    }

    LaunchedEffect(micGranted) { if (micGranted && state == "ready") record() }

    Column(Modifier.fillMaxSize().then(if (embedded) Modifier else Modifier.background(J.c.bg))) {
        if (!embedded) SubTopBar("Настройка голоса", onBack = onDone)
        Column(
            Modifier.fillMaxSize().navigationBarsPadding().padding(horizontal = 22.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (embedded) {
                Spacer(Modifier.weight(0.38f))
                Text("ГОЛОС", style = J.t.mono, color = J.c.accent, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(10.dp))
                Text("Познакомимся", style = J.t.hero.copy(fontSize = J.t.title.fontSize * 1.25f), color = J.c.text, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
            } else Spacer(Modifier.height(8.dp))
            Text(
                "Прочитайте вслух 5 коротких фраз — так я привыкну к вашему голосу и произношению. Дословно не обязательно.",
                style = J.t.body, color = J.c.text2, modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(18.dp))

            if (!micGranted) {
                GlassCard(Modifier.fillMaxWidth()) {
                    Text("Сначала разрешите микрофон на предыдущем шаге.", style = J.t.bodyL, color = J.c.text)
                }
                Spacer(Modifier.weight(1f))
                PrimaryButton("Пропустить", Modifier.fillMaxWidth(), onClick = onDone)
                return@Column
            }

            AnimatedContent(state == "done", transitionSpec = { fadeIn(tween(300)) togetherWith fadeOut(tween(150)) }, label = "vs") { done ->
                if (done) Summary(summary, app, onDone)
                else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    // прогресс
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        cal.phrases.indices.forEach { i ->
                            Box(
                                Modifier.size(width = if (i == index) 26.dp else 8.dp, height = 8.dp)
                                    .background(if (i < index) J.c.success else if (i == index) J.c.accent else Color.White.copy(alpha = 0.15f), CircleShape)
                            )
                        }
                    }
                    Spacer(Modifier.height(22.dp))
                    GlassCard(Modifier.fillMaxWidth()) {
                        Text("ПРОЧИТАЙТЕ ВСЛУХ · ${index + 1} ИЗ ${cal.phrases.size}", style = J.t.mono, color = J.c.text3)
                        Spacer(Modifier.height(12.dp))
                        Text("«${cal.phrases[index]}»", style = J.t.title, color = J.c.text)
                    }
                    Spacer(Modifier.height(26.dp))
                    MicLevel(level, state == "recording")
                    Spacer(Modifier.height(16.dp))
                    val h = heard
                    Text(
                        when (state) {
                            "loading" -> "Готовлю распознавание…"
                            "recording" -> "Говорите…"
                            "heard" -> "Услышал: «${h?.text?.ifBlank { "…" }}»"
                            "missed" -> "Не расслышал. Попробуйте ещё раз, чуть громче."
                            else -> ""
                        },
                        style = J.t.bodyL, color = if (state == "missed") J.c.warn else J.c.text2, textAlign = TextAlign.Center,
                    )
                    if (state == "heard" && h != null) {
                        val sc = (cal.score(cal.phrases[index], h.text) * 100).toInt()
                        Spacer(Modifier.height(6.dp))
                        Text(
                            if (sc >= 70) "Отлично — понял $sc%" else "Понял $sc% — ничего, подстроюсь",
                            style = J.t.bodyS, color = if (sc >= 70) J.c.success else J.c.warn,
                        )
                    }
                    Spacer(Modifier.height(24.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        GhostButton("Повторить", Modifier.weight(1f), Icons.Rounded.Refresh) { if (state == "heard" || state == "missed") record() }
                        PrimaryButton(
                            if (index + 1 < cal.phrases.size) "Дальше" else "Готово", Modifier.weight(1f),
                            enabled = state == "heard",
                        ) { next() }
                    }
                    Spacer(Modifier.height(10.dp))
                    GhostButton("Пропустить настройку", Modifier.fillMaxWidth(), tint = J.c.text3, onClick = onDone)
                }
            }
        }
    }
}

@Composable
private fun MicLevel(level: Float, active: Boolean) {
    val a = J.c.accent
    val lv by animateFloatAsState(if (active) level else 0f, spring(stiffness = 300f), label = "lv")
    Box(contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(120.dp)) {
            val r = size.minDimension / 2
            for (i in 0 until 3) {
                val k = i / 3f
                drawCircle(a.copy(alpha = (if (active) 0.25f else 0.08f) * (1 - k)), radius = r * (0.55f + 0.2f * k + lv * 0.35f * (1 - k * 0.4f)), style = Stroke(1.5.dp.toPx()))
            }
            drawCircle(a.copy(alpha = if (active) 0.9f else 0.35f), radius = r * 0.42f)
        }
        Icon(Icons.Rounded.Mic, null, tint = J.c.onAccent, modifier = Modifier.size(34.dp))
    }
}

@Composable
private fun Summary(s: VoiceCalibration.Summary?, app: JarvisApp, onDone: () -> Unit) {
    val owner by app.settings.ownerOnly.flow.collectAsState()
    Column {
        GlassCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).background(J.c.success.copy(alpha = 0.18f), CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Check, null, tint = J.c.success)
                }
                Spacer(Modifier.width(12.dp))
                Text("Голос настроен", style = J.t.title, color = J.c.text)
            }
            if (s != null) {
                Spacer(Modifier.height(14.dp))
                Text("Понимаю вас на ${s.accuracy}%", style = J.t.bodyL, color = J.c.text)
                Text("Слово «Джарвис» узнал в ${s.wakeOk} из ${s.total} фраз", style = J.t.body, color = J.c.text2)
                if (s.variants.isNotEmpty()) Text("Запомнил, как звучит ваше «Джарвис»: ${s.variants.joinToString { "«$it»" }}", style = J.t.body, color = J.c.text2)
                Text(if (s.hasVoiceprint) "Отпечаток голоса сохранён" else "Отпечаток голоса не получился — фразы слишком короткие", style = J.t.body, color = J.c.text2)
            }
        }
        Spacer(Modifier.height(12.dp))
        if (s?.hasVoiceprint == true) {
            GlassCard(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Отвечать только на мой голос", style = J.t.label, color = J.c.text)
                        Text("Чужие команды Джарвис будет игнорировать", style = J.t.bodyS, color = J.c.text3)
                    }
                    Switch(
                        owner, { app.settings.ownerOnly.value = it },
                        colors = SwitchDefaults.colors(checkedThumbColor = J.c.onAccent, checkedTrackColor = J.c.accent, uncheckedTrackColor = Color.White.copy(alpha = 0.08f)),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
        }
        PrimaryButton("Готово", Modifier.fillMaxWidth(), onClick = onDone)
    }
}
