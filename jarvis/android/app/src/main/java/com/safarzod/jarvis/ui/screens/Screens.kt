package com.safarzod.jarvis.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.FileOpen
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.safarzod.jarvis.JarvisApp
import com.safarzod.jarvis.core.Engine
import com.safarzod.jarvis.core.Settings
import com.safarzod.jarvis.data.AliasKind
import com.safarzod.jarvis.data.Contact
import com.safarzod.jarvis.data.History
import com.safarzod.jarvis.llm.LocalLlm
import com.safarzod.jarvis.ui.components.EmptyState
import com.safarzod.jarvis.ui.components.GhostButton
import com.safarzod.jarvis.ui.components.GlassCard
import com.safarzod.jarvis.ui.components.IconBadge
import com.safarzod.jarvis.ui.components.PrimaryButton
import com.safarzod.jarvis.ui.components.RoundIconButton
import com.safarzod.jarvis.ui.components.SectionLabel
import com.safarzod.jarvis.ui.components.SubTopBar
import com.safarzod.jarvis.ui.components.glass
import com.safarzod.jarvis.ui.home.Avatar
import com.safarzod.jarvis.ui.theme.J
import com.safarzod.jarvis.voice.Ev
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// =====================================================================================  ПАМЯТЬ

@Composable
fun MemoryScreen(engine: Engine, onBack: () -> Unit) {
    val items by engine.memory.items.collectAsState()
    val reminders by engine.reminders.items.collectAsState()
    var adding by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(J.c.bg)) {
        SubTopBar("Память", onBack) {
            RoundIconButton(Icons.Rounded.Add, "Добавить", tint = J.c.accent) { adding = true }
        }
        LazyColumn(
            Modifier.fillMaxSize().navigationBarsPadding(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    Text("Как это работает", style = J.t.label, color = J.c.text)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Скажите: «Мама — это контакт Mom» или «Телега — это Телеграм». Джарвис запомнит и в следующий раз поймёт сразу. " +
                            "Когда вы выбираете контакт из списка, он тоже запоминает выбор.",
                        style = J.t.body, color = J.c.text2,
                    )
                }
            }
            if (items.isEmpty()) {
                item { EmptyState(Icons.Rounded.Memory, "Пока пусто", "Добавьте первую запись кнопкой «+» или голосом.") }
            } else {
                item { SectionLabel("Обращения · ${items.size}") }
                items(items, key = { it.kind.name + it.alias }) { a ->
                    Row(
                        Modifier.fillMaxWidth().glass(RoundedCornerShape(22.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (a.kind == AliasKind.CONTACT) Avatar(a.title, 40.dp) else IconBadge(Icons.Rounded.Apps, size = 40.dp)
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text("«${a.alias}»", style = J.t.label, color = J.c.text)
                            Text(
                                (if (a.kind == AliasKind.CONTACT) "${a.title} · ${a.value}" else "Приложение ${a.title}") +
                                    if (a.uses > 0) " · использовано ${a.uses}" else "",
                                style = J.t.bodyS, color = J.c.text3, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Box(Modifier.size(40.dp).clip(CircleShape).clickable { engine.memory.removeExact(a) }, contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.DeleteOutline, "Удалить", tint = J.c.text3)
                        }
                    }
                }
            }
            if (reminders.isNotEmpty()) {
                item { SectionLabel("Напоминания · ${reminders.size}") }
                items(reminders, key = { "r" + it.id }) { r ->
                    Row(
                        Modifier.fillMaxWidth().glass(RoundedCornerShape(22.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconBadge(Icons.Rounded.NotificationsActive, J.c.warn, 40.dp)
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(r.text, style = J.t.label, color = J.c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(SimpleDateFormat("d MMMM, HH:mm", Locale.forLanguageTag("ru")).format(Date(r.at)), style = J.t.bodyS, color = J.c.text3)
                        }
                        Box(Modifier.size(40.dp).clip(CircleShape).clickable { engine.reminders.remove(r.id) }, contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.Close, "Отменить", tint = J.c.text3)
                        }
                    }
                }
            }
        }
    }
    if (adding) AddAliasDialog(engine) { adding = false }
}

@Composable
private fun AddAliasDialog(engine: Engine, onClose: () -> Unit) {
    var alias by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var all by remember { mutableStateOf<List<Contact>>(emptyList()) }
    LaunchedEffect(Unit) { all = withContext(Dispatchers.IO) { engine.contacts.all() } }
    val shown = remember(query, all) {
        val q = query.trim().lowercase()
        (if (q.isEmpty()) all else all.filter { it.name.lowercase().contains(q) || it.phone.contains(q) }).distinctBy { it.id }.take(40)
    }
    Dialog(onDismissRequest = onClose) {
        Column(Modifier.fillMaxWidth().heightIn(max = 620.dp).clip(RoundedCornerShape(28.dp)).background(J.c.bgRaised).padding(20.dp)) {
            Text("Новая запись", style = J.t.title, color = J.c.text)
            Spacer(Modifier.height(14.dp))
            Field(alias, { alias = it }, "Как вы говорите: «мама», «брат»…", Icons.Rounded.Person)
            Spacer(Modifier.height(10.dp))
            Field(query, { query = it }, "Найти контакт", Icons.Rounded.Search)
            Spacer(Modifier.height(10.dp))
            if (!engine.contacts.hasPermission()) {
                Text("Нет доступа к контактам. Разрешите его в настройках.", style = J.t.body, color = J.c.warn)
            }
            LazyColumn(Modifier.weight(1f, fill = false)) {
                items(shown, key = { it.id.toString() + it.phone }) { c ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(enabled = alias.isNotBlank()) {
                            engine.memory.put(alias, AliasKind.CONTACT, c.name, c.phone); onClose()
                        }.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(c.name, 36.dp)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(c.name, style = J.t.label, color = J.c.text, maxLines = 1)
                            Text(c.phone, style = J.t.bodyS, color = J.c.text3)
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(if (alias.isBlank()) "Сначала введите обращение, затем выберите контакт." else "Нажмите на контакт, чтобы сохранить.", style = J.t.bodyS, color = J.c.text3)
            Spacer(Modifier.height(12.dp))
            GhostButton("Отмена", Modifier.fillMaxWidth(), onClick = onClose)
        }
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, hint: String, icon: ImageVector) {
    Row(Modifier.fillMaxWidth().height(52.dp).glass(RoundedCornerShape(16.dp)).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = J.c.text3, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(hint, style = J.t.body, color = J.c.text3, maxLines = 1)
            BasicTextField(value, onChange, textStyle = J.t.body.copy(color = J.c.text), cursorBrush = SolidColor(J.c.accent), singleLine = true, modifier = Modifier.fillMaxWidth())
        }
    }
}

// =====================================================================================  ЖУРНАЛ

@Composable
fun HistoryScreen(onBack: () -> Unit) {
    val turns by History.turns.collectAsState()
    val state = rememberLazyListState()
    LaunchedEffect(turns.size) { if (turns.isNotEmpty()) state.scrollToItem(turns.lastIndex) }
    Column(Modifier.fillMaxSize().background(J.c.bg)) {
        SubTopBar("Журнал", onBack) {
            if (turns.isNotEmpty()) RoundIconButton(Icons.Rounded.DeleteOutline, "Очистить") { History.clear() }
        }
        if (turns.isEmpty()) {
            EmptyState(Icons.Rounded.History, "Здесь будет диалог", "Журнал хранится только до закрытия приложения.")
        } else {
            LazyColumn(
                Modifier.fillMaxSize().navigationBarsPadding(), state = state,
                contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(turns) { t ->
                    val mine = t.user != null
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                        Column(
                            Modifier.fillMaxWidth(0.82f)
                                .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = if (mine) 20.dp else 6.dp, bottomEnd = if (mine) 6.dp else 20.dp))
                                .background(if (mine) J.c.accent.copy(alpha = 0.16f) else Color.White.copy(alpha = 0.05f))
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
                        ) {
                            Text(if (mine) "ВЫ" else "ДЖАРВИС", style = J.t.mono, color = if (mine) J.c.accent else J.c.text3)
                            Spacer(Modifier.height(4.dp))
                            Text(t.user ?: t.jarvis ?: "", style = J.t.body, color = J.c.text)
                            Text(SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(t.time)), style = J.t.bodyS, color = J.c.text3)
                        }
                    }
                }
            }
        }
    }
}

// =====================================================================================  ГОЛОС

@Composable
fun VoiceScreen(engine: Engine, onBack: () -> Unit) {
    val userClips by engine.voice.user.collectAsState()
    var target by remember { mutableStateOf<Ev?>(null) }
    var picked by remember { mutableStateOf<Uri?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) picked = uri else target = null }
    val total = Ev.entries.sumOf { engine.voice.clipsFor(it.key).size }
    Column(Modifier.fillMaxSize().background(J.c.bg)) {
        SubTopBar("Библиотека голоса", onBack)
        LazyColumn(
            Modifier.fillMaxSize().navigationBarsPadding(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    Text("$total записей · ${Ev.entries.size} ситуаций", style = J.t.label, color = J.c.text)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Где своей записи нет, Джарвис берёт подходящую по смыслу или показывает текст со звуковым сигналом. " +
                            "Добавляйте свои файлы (mp3, ogg, wav, m4a) кнопкой «+» у нужной ситуации.",
                        style = J.t.body, color = J.c.text2,
                    )
                    error?.let { Spacer(Modifier.height(8.dp)); Text(it, style = J.t.bodyS, color = J.c.danger) }
                }
            }
            items(Ev.entries, key = { it.name }) { ev ->
                val clips = engine.voice.clipsFor(ev.key)
                val own = userClips.filter { it.event == ev.key }
                Column(Modifier.fillMaxWidth().glass(RoundedCornerShape(22.dp)).animateContentSize()) {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(ev.title, style = J.t.label, color = J.c.text)
                            Text(
                                if (clips.isEmpty()) "Нет записи · «${ev.text}»" else "${clips.size} " + plural(clips.size, "запись", "записи", "записей"),
                                style = J.t.bodyS, color = if (clips.isEmpty()) J.c.text3 else J.c.accent, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (clips.isNotEmpty()) {
                            Box(Modifier.size(40.dp).clip(CircleShape).clickable { engine.preview(clips.random()) }, contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.PlayArrow, "Прослушать", tint = J.c.accent)
                            }
                        }
                        Box(Modifier.size(40.dp).clip(CircleShape).clickable { target = ev; launcher.launch(arrayOf("audio/*")) }, contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.Add, "Добавить запись", tint = J.c.text2)
                        }
                    }
                    own.forEach { c ->
                        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Своя: «${c.text}»", style = J.t.bodyS, color = J.c.text2, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Box(Modifier.size(36.dp).clip(CircleShape).clickable { engine.preview(c) }, contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.PlayArrow, "Прослушать", tint = J.c.text2, modifier = Modifier.size(18.dp))
                            }
                            Box(Modifier.size(36.dp).clip(CircleShape).clickable { engine.voice.removeUserClip(c.id) }, contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.DeleteOutline, "Удалить", tint = J.c.text3, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                }
            }
        }
    }
    val ev = target
    val uri = picked
    if (ev != null && uri != null) {
        var text by remember(ev) { mutableStateOf(ev.text) }
        Dialog(onDismissRequest = { target = null; picked = null }) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(J.c.bgRaised).padding(20.dp)) {
                Text("Своя запись", style = J.t.title, color = J.c.text)
                Spacer(Modifier.height(6.dp))
                Text("Ситуация: ${ev.title}. Что говорится в записи? Этот текст появится на экране.", style = J.t.body, color = J.c.text2)
                Spacer(Modifier.height(12.dp))
                Field(text, { text = it }, "Текст фразы", Icons.Rounded.Person)
                Spacer(Modifier.height(16.dp))
                PrimaryButton("Сохранить", Modifier.fillMaxWidth()) {
                    engine.voice.addUserClip(ev.key, uri, text.ifBlank { ev.text })
                        .onFailure { error = it.message ?: "Не удалось добавить файл" }
                        .onSuccess { error = null }
                    target = null; picked = null
                }
                Spacer(Modifier.height(8.dp))
                GhostButton("Отмена", Modifier.fillMaxWidth()) { target = null; picked = null }
            }
        }
    }
}

private fun plural(n: Int, one: String, few: String, many: String): String {
    val m10 = n % 10; val m100 = n % 100
    return when {
        m10 == 1 && m100 != 11 -> one
        m10 in 2..4 && m100 !in 12..14 -> few
        else -> many
    }
}

// =====================================================================================  НЕЙРОСЕТЬ

@Composable
fun ModelScreen(app: JarvisApp, onBack: () -> Unit) {
    val llm = app.llm
    val st by llm.status.collectAsState()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) llm.importFrom(uri) }
    LaunchedEffect(Unit) { llm.refresh() }
    Column(Modifier.fillMaxSize().background(J.c.bg)) {
        SubTopBar("Нейросеть", onBack)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
            GlassCard(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.AutoAwesome, J.c.violet, 48.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Локальная модель", style = J.t.label, color = J.c.text)
                        Text(statusText(st), style = J.t.bodyS, color = J.c.text2)
                    }
                }
                when (val s = st) {
                    is LocalLlm.Status.Downloading -> {
                        Spacer(Modifier.height(14.dp))
                        LinearProgressIndicator(progress = { s.progress }, Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)), color = J.c.violet, trackColor = Color.White.copy(alpha = 0.08f))
                        Spacer(Modifier.height(8.dp))
                        Text("%.0f из %.0f МБ".format(s.bytes / 1e6, s.total / 1e6), style = J.t.bodyS, color = J.c.text3)
                        Spacer(Modifier.height(10.dp))
                        GhostButton("Отменить", Modifier.fillMaxWidth()) { llm.cancelDownload() }
                    }
                    is LocalLlm.Status.Copying -> {
                        Spacer(Modifier.height(14.dp))
                        LinearProgressIndicator(progress = { s.progress }, Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)), color = J.c.violet, trackColor = Color.White.copy(alpha = 0.08f))
                    }
                    else -> Unit
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    "Нейросеть не нужна для обычных команд — их Джарвис понимает сам, мгновенно. Она помогает, когда фраза сказана необычно, " +
                        "и поправляет текст сообщений перед отправкой. Работает на телефоне, без интернета.",
                    style = J.t.body, color = J.c.text2,
                )
            }
            if (st != LocalLlm.Status.Unsupported) {
                SectionLabel("Модели")
                llm.models.forEach { spec ->
                    val installed = llm.installedSpec()?.id == spec.id
                    GlassCard(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(spec.title, style = J.t.title.copy(fontSize = J.t.bodyL.fontSize), color = J.c.text)
                                Spacer(Modifier.height(4.dp))
                                Text(spec.description, style = J.t.bodyS, color = J.c.text2)
                            }
                        }
                        Spacer(Modifier.height(14.dp))
                        if (installed) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                GhostButton("Удалить", Modifier.weight(1f), Icons.Rounded.DeleteOutline, tint = J.c.danger) { llm.delete() }
                            }
                        } else {
                            PrimaryButton(
                                "Скачать · ${"%.1f".format(spec.bytes / 1e9).replace('.', ',')} ГБ", Modifier.fillMaxWidth(), Icons.Rounded.Download,
                                enabled = st !is LocalLlm.Status.Downloading && st !is LocalLlm.Status.Copying,
                            ) { llm.download(spec) }
                        }
                    }
                }
                GhostButton("Установить из файла .task", Modifier.fillMaxWidth(), Icons.Rounded.FileOpen) { launcher.launch(arrayOf("*/*")) }
                SectionLabel("Использование")
                Group {
                    PrefSwitch("Понимать сложные фразы", "Подключать нейросеть, если команда не распознана", app.settings.llmEnabled)
                    PrefSwitch("Поправлять сообщения", "Пунктуация и опечатки распознавания", app.settings.llmPolish)
                }
            }
        }
    }
}

private fun statusText(st: LocalLlm.Status) = when (st) {
    LocalLlm.Status.None -> "Не установлена"
    is LocalLlm.Status.Downloading -> "Загрузка… ${(st.progress * 100).toInt()}%"
    is LocalLlm.Status.Copying -> "Копирование… ${(st.progress * 100).toInt()}%"
    is LocalLlm.Status.Installed -> "Установлена · запустится при первом вопросе"
    LocalLlm.Status.Loading -> "Загружается в память…"
    is LocalLlm.Status.Ready -> "Работает"
    is LocalLlm.Status.Failed -> st.message
    LocalLlm.Status.Unsupported -> "Нужен 64-битный процессор (arm64)"
}

@Composable
private fun PrefSwitch(title: String, sub: String, pref: Settings.Pref<Boolean>) {
    val v by pref.flow.collectAsState()
    Row(Modifier.fillMaxWidth().clickable { pref.value = !v }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = J.t.label, color = J.c.text)
            Text(sub, style = J.t.bodyS, color = J.c.text3)
        }
        Switch(
            v, { pref.value = it },
            colors = SwitchDefaults.colors(checkedThumbColor = J.c.onAccent, checkedTrackColor = J.c.accent, uncheckedTrackColor = Color.White.copy(alpha = 0.08f)),
        )
    }
}

// =====================================================================================  КОМАНДЫ

@Composable
fun CommandsScreen(onBack: () -> Unit, onRun: (String) -> Unit) {
    val groups = listOf(
        "Звонки" to listOf("Позвони маме", "Набери Саше Иванову", "Позвони на номер 8 916 123 45 67", "Ответь", "Сбрось"),
        "Сообщения" to listOf("Напиши маме, что я задержусь", "Напиши брату в ватсап, что буду через час", "Напиши в телеграм Саше", "Прочитай сообщения"),
        "Память" to listOf("Мама — это контакт Mom", "Брат записан как Артём", "Телега — это Телеграм", "Что ты помнишь?", "Забудь про брата"),
        "Приложения" to listOf("Открой Телеграм", "Запусти камеру", "Открой настройки", "Домой", "Сделай скриншот", "Заблокируй телефон"),
        "Интернет" to listOf("Какая погода", "Погода в Москве", "Включи на ютубе котиков", "Найди фильм Интерстеллар", "Найди рецепт борща", "Построй маршрут до аэропорта"),
        "Телефон" to listOf("Включи фонарик", "Выключи фонарик", "Громче", "Тише", "Беззвучный режим", "Включи вайфай", "Включи музыку", "Следующая песня", "Пауза"),
        "Время" to listOf("Разбуди меня в семь тридцать", "Будильник через 20 минут", "Таймер на пять минут", "Напомни через час позвонить маме", "Напомни завтра в 9 сдать отчёт", "Который час", "Какое сегодня число"),
        "Прочее" to listOf("Сколько будет 25 умножить на 4", "15 процентов от 2000", "Сколько заряда", "Как дела?", "Кто ты?", "Расскажи шутку", "Спасибо"),
    )
    Column(Modifier.fillMaxSize().background(J.c.bg)) {
        SubTopBar("Команды", onBack)
        LazyColumn(
            Modifier.fillMaxSize().navigationBarsPadding(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
        ) {
            item {
                Text("Нажмите на фразу — Джарвис выполнит её. Начинать со слова «Джарвис» не обязательно, когда он уже слушает.", style = J.t.body, color = J.c.text2, modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp))
            }
            groups.forEach { (title, list) ->
                item { SectionLabel(title) }
                item {
                    Column(Modifier.fillMaxWidth().glass()) {
                        list.forEachIndexed { i, cmd ->
                            Row(Modifier.fillMaxWidth().clickable { onRun(cmd) }.padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("«$cmd»", style = J.t.body, color = J.c.text, modifier = Modifier.weight(1f))
                                Icon(Icons.Rounded.PlayArrow, null, tint = J.c.accent.copy(alpha = 0.7f), modifier = Modifier.size(18.dp))
                            }
                            if (i < list.lastIndex) Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(1.dp).background(Color.White.copy(alpha = 0.05f)))
                        }
                    }
                }
            }
        }
    }
}
