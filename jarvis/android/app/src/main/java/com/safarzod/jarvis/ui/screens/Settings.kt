package com.safarzod.jarvis.ui.screens

import android.content.Intent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.BatterySaver
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Contacts
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.RecordVoiceOver
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Sms
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.material.icons.rounded.Alarm
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.safarzod.jarvis.BuildConfig
import com.safarzod.jarvis.JarvisApp
import com.safarzod.jarvis.R
import com.safarzod.jarvis.core.Accent
import com.safarzod.jarvis.core.CoreStyle
import com.safarzod.jarvis.core.Need
import com.safarzod.jarvis.core.Quality
import com.safarzod.jarvis.core.SearchEngine
import com.safarzod.jarvis.core.Settings
import com.safarzod.jarvis.llm.LocalLlm
import com.safarzod.jarvis.service.JarvisService
import com.safarzod.jarvis.ui.Perms
import com.safarzod.jarvis.ui.components.Chip
import com.safarzod.jarvis.ui.components.GlassCard
import com.safarzod.jarvis.ui.components.IconBadge
import com.safarzod.jarvis.ui.components.SectionLabel
import com.safarzod.jarvis.ui.components.SubTopBar
import com.safarzod.jarvis.ui.components.glass
import com.safarzod.jarvis.ui.theme.J

@Composable
fun SettingsScreen(app: JarvisApp, onBack: () -> Unit, onOpen: (String) -> Unit, request: (Need) -> Unit) {
    val s = app.settings
    val ctx = LocalContext.current
    var tick by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) tick++ }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    Column(Modifier.fillMaxSize().background(J.c.bg)) {
        SubTopBar("Настройки", onBack)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 32.dp),
        ) {
            SectionLabel("Облик")
            CorePicker(app)
            Spacer(Modifier.height(14.dp))
            AccentPicker(app)
            Spacer(Modifier.height(14.dp))
            val quality by s.quality.flow.collectAsState()
            GlassCard(Modifier.fillMaxWidth(), padding = PaddingValues(16.dp)) {
                Text("Качество графики", style = J.t.label, color = J.c.text)
                Spacer(Modifier.height(4.dp))
                Text("«Экономия» бережёт батарею, «Максимум» — для мощных телефонов.", style = J.t.bodyS, color = J.c.text3)
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Quality.entries.forEach { q -> Chip(q.title, selected = q == quality) { s.quality.value = q } }
                }
            }

            SectionLabel("Голос и звук")
            Group {
                SliderRow(Icons.Rounded.GraphicEq, "Громкость голоса", s.voiceVolume) { "${(it * 100).toInt()}%" }
                SwitchRow(Icons.Rounded.Notifications, "Звуки интерфейса", "Сигналы начала и конца прослушивания", s.uiSounds)
                SwitchRow(Icons.Rounded.TouchApp, "Вибрация", "Лёгкий отклик, когда Джарвис слышит вас", s.haptics)
                SwitchRow(Icons.Rounded.RecordVoiceOver, "Приветствия", "«Доброе утро, сэр» при первом обращении", s.greetings)
                SwitchRow(Icons.Rounded.GraphicEq, "Синтез голоса Джарвиса", "Говорить любые фразы голосом, обученным на записях", s.voiceSynth)
                SwitchRow(Icons.Rounded.Notifications, "Озвучивать детали", "Время, заряд, текст сообщений и напоминаний", s.speakDetails)
                NavRow(Icons.Rounded.RecordVoiceOver, "Библиотека голоса", "Прослушать фразы, добавить свои записи") { onOpen("voice") }
            }

            SectionLabel("Прослушивание")
            Group {
                SwitchRow(Icons.Rounded.Mic, "Слово «Джарвис»", "Отвечать на обращение без нажатий", s.wakeWord)
                SwitchRow(Icons.Rounded.BatterySaver, "Работать в фоне", "Слушать, даже когда приложение закрыто", s.background) { on ->
                    if (on) JarvisService.start(ctx)
                }
                SliderRow(Icons.Rounded.GraphicEq, "Чувствительность", s.sensitivity) { v -> when { v < 0.33f -> "Строго"; v < 0.66f -> "Баланс"; else -> "Чутко" } }
            }

            SectionLabel("Поведение")
            Group {
                SwitchRow(Icons.Rounded.Call, "Подтверждать звонки", "Спрашивать «Подтверждаете, сэр?» перед вызовом", s.confirmCalls)
                SwitchRow(Icons.Rounded.Sms, "Подтверждать SMS", "Показывать текст перед отправкой", s.confirmSms)
                SwitchRow(Icons.Rounded.NotificationsActive, "Объявлять сообщения", "«Сэр, у вас новое сообщение»", s.announceMessages)
                val engine by s.searchEngine.flow.collectAsState()
                Column(Modifier.padding(16.dp)) {
                    Text("Поиск в интернете", style = J.t.label, color = J.c.text)
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SearchEngine.entries.forEach { e -> Chip(e.title, selected = e == engine) { s.searchEngine.value = e } }
                    }
                }
            }

            SectionLabel("Нейросеть")
            val st by app.llm.status.collectAsState()
            Group {
                NavRow(Icons.Rounded.AutoAwesome, "Локальная модель", llmSubtitle(st)) { onOpen("model") }
            }

            SectionLabel("Разрешения")
            Group {
                @Suppress("UNUSED_VARIABLE") val t = tick
                PermRow(Icons.Rounded.Mic, "Микрофон", Need.MIC, request)
                PermRow(Icons.Rounded.Contacts, "Контакты", Need.CONTACTS, request)
                PermRow(Icons.Rounded.Call, "Звонки", Need.CALLS, request)
                PermRow(Icons.Rounded.Sms, "SMS", Need.SMS, request)
                PermRow(Icons.Rounded.Notifications, "Уведомления", Need.NOTIFICATIONS, request)
                PermRow(Icons.Rounded.Layers, "Открытие из фона", Need.OVERLAY, request)
                PermRow(Icons.Rounded.NotificationsActive, "Чтение уведомлений", Need.LISTENER, request)
                PermRow(Icons.Rounded.TouchApp, "Спец. возможности", Need.ACCESSIBILITY, request)
                PermRow(Icons.Rounded.Alarm, "Точные напоминания", Need.EXACT_ALARMS, request)
                val bat = Perms.batteryUnrestricted(ctx)
                StatusRow(Icons.Rounded.BatterySaver, "Без ограничений батареи", bat) { runCatching { ctx.startActivity(Perms.batteryIntent(ctx).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
            }

            SectionLabel("О приложении")
            GlassCard(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(painterResource(R.mipmap.ic_launcher_foreground), null, Modifier.size(56.dp).scale(1.5f))
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Джарвис", style = J.t.title, color = J.c.text)
                        Text("Версия ${BuildConfig.VERSION_NAME}", style = J.t.bodyS, color = J.c.text3)
                    }
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    "Распознавание речи, память и нейросеть работают на телефоне. Голос, контакты и сообщения никуда не отправляются. " +
                        "Интернет нужен только для поиска, погоды, YouTube и загрузки модели.",
                    style = J.t.body, color = J.c.text2,
                )
                Spacer(Modifier.height(10.dp))
                Text("Vosk (Apache 2.0) · MediaPipe (Apache 2.0) · Qwen 2.5 (Apache 2.0) · Unbounded, Manrope, JetBrains Mono (OFL)", style = J.t.bodyS, color = J.c.text3)
            }
        }
    }
}

private fun llmSubtitle(st: LocalLlm.Status): String = when (st) {
    LocalLlm.Status.None -> "Не установлена — Джарвис понимает команды и без неё"
    is LocalLlm.Status.Downloading -> "Загрузка ${(st.progress * 100).toInt()}%"
    is LocalLlm.Status.Copying -> "Копирование ${(st.progress * 100).toInt()}%"
    is LocalLlm.Status.Installed -> "Установлена: ${st.spec?.title ?: "своя модель"}"
    LocalLlm.Status.Loading -> "Загружается в память…"
    is LocalLlm.Status.Ready -> "Работает: ${st.spec?.title ?: "своя модель"}"
    is LocalLlm.Status.Failed -> st.message
    LocalLlm.Status.Unsupported -> "Недоступна на этом процессоре"
}

@Composable
fun Group(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().glass()) { content() }
}

@Composable
private fun SwitchRow(icon: ImageVector, title: String, sub: String, pref: Settings.Pref<Boolean>, onChange: (Boolean) -> Unit = {}) {
    val v by pref.flow.collectAsState()
    Row(
        Modifier.fillMaxWidth().clickable { pref.value = !v; onChange(!v) }.padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBadge(icon, size = 36.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = J.t.label, color = J.c.text)
            Text(sub, style = J.t.bodyS, color = J.c.text3)
        }
        Switch(
            checked = v, onCheckedChange = { pref.value = it; onChange(it) },
            colors = SwitchDefaults.colors(
                checkedThumbColor = J.c.onAccent, checkedTrackColor = J.c.accent,
                uncheckedThumbColor = J.c.text2, uncheckedTrackColor = Color.White.copy(alpha = 0.08f), uncheckedBorderColor = Color.White.copy(alpha = 0.15f),
            ),
        )
    }
}

@Composable
private fun SliderRow(icon: ImageVector, title: String, pref: Settings.Pref<Float>, label: (Float) -> String) {
    val v by pref.flow.collectAsState()
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(icon, size = 36.dp)
            Spacer(Modifier.width(14.dp))
            Text(title, style = J.t.label, color = J.c.text, modifier = Modifier.weight(1f))
            Text(label(v), style = J.t.monoL, color = J.c.accent)
        }
        Slider(
            value = v, onValueChange = { pref.value = it },
            colors = SliderDefaults.colors(thumbColor = J.c.accent, activeTrackColor = J.c.accent, inactiveTrackColor = Color.White.copy(alpha = 0.1f)),
            modifier = Modifier.padding(start = 50.dp),
        )
    }
}

@Composable
fun NavRow(icon: ImageVector, title: String, sub: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBadge(icon, size = 36.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = J.t.label, color = J.c.text)
            Text(sub, style = J.t.bodyS, color = J.c.text3)
        }
        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = J.c.text3)
    }
}

@Composable
private fun PermRow(icon: ImageVector, title: String, need: Need, request: (Need) -> Unit) {
    val ctx = LocalContext.current
    StatusRow(icon, title, Perms.granted(ctx, need)) { request(need) }
}

@Composable
private fun StatusRow(icon: ImageVector, title: String, ok: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = !ok, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBadge(icon, if (ok) J.c.success else J.c.warn, 32.dp)
        Spacer(Modifier.width(14.dp))
        Text(title, style = J.t.body, color = J.c.text, modifier = Modifier.weight(1f))
        Text(if (ok) "ВКЛ" else "ВКЛЮЧИТЬ", style = J.t.mono, color = if (ok) J.c.success else J.c.warn)
    }
}

/** Три ядра с превью. */
@Composable
fun CorePicker(app: JarvisApp) {
    val style by app.settings.coreStyle.flow.collectAsState()
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        CoreStyle.entries.forEach { st ->
            val sel = st == style
            val border by animateColorAsState(if (sel) J.c.accent else Color.White.copy(alpha = 0.10f), label = "b")
            val sc by animateFloatAsState(if (sel) 1f else 0.96f, spring(stiffness = 500f), label = "s")
            Column(
                Modifier.weight(1f).scale(sc).clip(RoundedCornerShape(22.dp)).border(1.5.dp, border, RoundedCornerShape(22.dp))
                    .background(Color.White.copy(alpha = 0.04f)).clickable { app.settings.coreStyle.value = st },
            ) {
                Box(Modifier.fillMaxWidth().aspectRatio(1f)) {
                    Image(
                        painterResource(
                            when (st) { CoreStyle.PLASMA -> R.drawable.core_plasma; CoreStyle.GYRO -> R.drawable.core_gyro; CoreStyle.NEURO -> R.drawable.core_neuro }
                        ),
                        st.title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop,
                    )
                    if (sel) {
                        Box(
                            Modifier.align(Alignment.TopEnd).padding(8.dp).size(22.dp).clip(CircleShape).background(J.c.accent),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Rounded.Check, null, tint = J.c.onAccent, modifier = Modifier.size(14.dp)) }
                    }
                }
                Text(st.title, style = J.t.label.copy(fontSize = J.t.bodyS.fontSize), color = if (sel) J.c.text else J.c.text2, modifier = Modifier.padding(start = 12.dp, top = 8.dp, bottom = 12.dp))
            }
        }
    }
}

@Composable
fun AccentPicker(app: JarvisApp) {
    val acc by app.settings.accent.flow.collectAsState()
    Row(Modifier.fillMaxWidth().glass().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Цвет", style = J.t.label, color = J.c.text)
            Text(acc.title, style = J.t.bodyS, color = J.c.text3)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Accent.entries.forEach { a ->
                val c = Color(a.argb)
                val sel = a == acc
                Box(
                    Modifier.size(30.dp).clip(CircleShape)
                        .background(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.9f).copy(alpha = 0.5f), c, c.copy(alpha = 0.7f))))
                        .border(if (sel) 2.dp else 0.dp, if (sel) Color.White else Color.Transparent, CircleShape)
                        .clickable { app.settings.accent.value = a },
                )
            }
        }
    }
}
