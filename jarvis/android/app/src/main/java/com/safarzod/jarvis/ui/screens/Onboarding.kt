package com.safarzod.jarvis.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.BatterySaver
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.Contacts
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Sms
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.safarzod.jarvis.JarvisApp
import com.safarzod.jarvis.core.Need
import com.safarzod.jarvis.gl.CoreParams
import com.safarzod.jarvis.ui.Perms
import com.safarzod.jarvis.ui.components.GhostButton
import com.safarzod.jarvis.ui.components.GlassCard
import com.safarzod.jarvis.ui.components.PrimaryButton
import com.safarzod.jarvis.ui.theme.J

/** Первый запуск: знакомство, разрешения по шагам, выбор облика. */
@Composable
fun OnboardingScreen(params: CoreParams, request: (Need) -> Unit, onDone: () -> Unit) {
    var page by rememberSaveable { mutableIntStateOf(0) }
    var tick by rememberSaveable { mutableIntStateOf(0) }
    val ctx = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) tick++ }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(page) {
        params.centerY = if (page == 0) 0.36f else 0.20f
        params.radius = if (page == 0) 0.20f else 0.11f
        params.energy = if (page == 0) 0.35f else 0.2f
    }
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(listOf(Color.Transparent, Color.Transparent, J.c.bg.copy(alpha = 0.92f), J.c.bg))
            )
        )
        AnimatedContent(
            page,
            transitionSpec = {
                val dir = if (targetState > initialState) 1 else -1
                (slideInHorizontally(tween(420)) { it / 5 * dir } + fadeIn(tween(420))) togetherWith
                    (slideOutHorizontally(tween(300)) { -it / 6 * dir } + fadeOut(tween(220)))
            },
            label = "onb",
        ) { p ->
            when (p) {
                0 -> Welcome { page = 1 }
                1 -> PermsPage(
                    tick, "Голос", "Чтобы я слышал вас",
                    "Распознавание работает прямо на телефоне. Звук никуда не отправляется.",
                    listOf(
                        Row3(Icons.Rounded.Mic, "Микрофон", "Слышать слово «Джарвис» и команды", Need.MIC, true),
                        Row3(Icons.Rounded.Notifications, "Уведомления", "Работа в фоне и напоминания", Need.NOTIFICATIONS, false),
                        Row3(Icons.Rounded.Cloud, "Местоположение", "Погода там, где вы (примерно, без GPS)", Need.LOCATION, false),
                    ),
                    request, canNext = Perms.granted(ctx, Need.MIC),
                    onNext = { page = 2 },
                )
                2 -> VoiceSetupScreen(LocalContext.current.applicationContext as JarvisApp, embedded = true) { page = 3 }
                3 -> PermsPage(
                    tick, "Связь", "Звонки и сообщения",
                    "Найду «маму», даже если она записана как «Mom». SMS отправляю только после вашего «да».",
                    listOf(
                        Row3(Icons.Rounded.Contacts, "Контакты", "Звонить и писать по имени", Need.CONTACTS, false),
                        Row3(Icons.Rounded.Call, "Звонки", "Набирать номер, принимать и сбрасывать", Need.CALLS, false),
                        Row3(Icons.Rounded.Sms, "SMS", "Отправлять сообщения голосом", Need.SMS, false),
                    ),
                    request, canNext = true,
                    onNext = { page = 4 },
                )
                4 -> PermsPage(
                    tick, "Фон", "Работа без экрана",
                    "Чтобы я открывал приложения и звонил, пока вы в другом приложении или экран погашен.",
                    listOf(
                        Row3(Icons.Rounded.Layers, "Поверх других окон", "Открывать приложения из фона", Need.OVERLAY, false),
                        Row3(Icons.Rounded.BatterySaver, "Без ограничений батареи", "Чтобы система меня не усыпляла", null, false),
                        Row3(Icons.Rounded.NotificationsActive, "Доступ к уведомлениям", "Читать входящие сообщения (по желанию)", Need.LISTENER, false),
                        Row3(Icons.Rounded.TouchApp, "Спец. возможности", "Скриншоты и блокировка экрана (по желанию)", Need.ACCESSIBILITY, false),
                    ),
                    request, canNext = true,
                    onNext = { page = 5 },
                )
                5 -> BrainPage { page = 6 }
                else -> StylePage(onDone)
            }
        }
    }
}

private data class Row3(val icon: ImageVector, val title: String, val body: String, val need: Need?, val required: Boolean)

@Composable
private fun Welcome(onNext: () -> Unit) {
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 28.dp, vertical = 20.dp),
    ) {
        Text("ДЖАРВИС", style = J.t.wordmark, color = J.c.text2)
        Spacer(Modifier.weight(1f))
        Text("ПЕРСОНАЛЬНЫЙ ПОМОЩНИК", style = J.t.mono, color = J.c.accent)
        Spacer(Modifier.height(14.dp))
        Text("Здравствуйте, сэр.", style = J.t.hero, color = J.c.text)
        Spacer(Modifier.height(14.dp))
        Text(
            "Я звоню, пишу, открываю приложения, ищу в интернете, ставлю будильники и запоминаю, кто есть кто. " +
                "Всё работает на телефоне — без серверов и подписок.",
            style = J.t.bodyL, color = J.c.text2,
        )
        Spacer(Modifier.height(28.dp))
        PrimaryButton("Начать", Modifier.fillMaxWidth(), Icons.AutoMirrored.Rounded.ArrowForward, onClick = onNext)
    }
}

@Composable
private fun PermsPage(
    tick: Int,
    step: String,
    title: String,
    body: String,
    rows: List<Row3>,
    request: (Need) -> Unit,
    canNext: Boolean,
    onNext: () -> Unit,
) {
    val ctx = LocalContext.current
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 22.dp, vertical = 16.dp),
    ) {
        Spacer(Modifier.weight(0.42f))
        Text(step.uppercase(), style = J.t.mono, color = J.c.accent)
        Spacer(Modifier.height(10.dp))
        Text(title, style = J.t.hero.copy(fontSize = J.t.title.fontSize * 1.25f), color = J.c.text)
        Spacer(Modifier.height(10.dp))
        Text(body, style = J.t.body, color = J.c.text2)
        Spacer(Modifier.height(20.dp))
        Column(Modifier.weight(0.58f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            rows.forEach { r ->
                val granted = if (r.need == null) Perms.batteryUnrestricted(ctx) else Perms.granted(ctx, r.need)
                PermissionRow(r.icon, r.title, r.body, granted, r.required) {
                    if (r.need == null) runCatching { ctx.startActivity(Perms.batteryIntent(ctx)) } else request(r.need)
                }
            }
        }
        Spacer(Modifier.height(18.dp))
        val allGranted = rows.all { r -> if (r.need == null) Perms.batteryUnrestricted(ctx) else Perms.granted(ctx, r.need) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!allGranted) {
                GhostButton("Разрешить всё", Modifier.weight(1f)) {
                    rows.firstOrNull { r -> !(if (r.need == null) Perms.batteryUnrestricted(ctx) else Perms.granted(ctx, r.need)) }?.let { r ->
                        if (r.need == null) runCatching { ctx.startActivity(Perms.batteryIntent(ctx)) } else request(r.need)
                    }
                }
            }
            PrimaryButton(if (allGranted) "Далее" else if (canNext) "Позже" else "Далее", Modifier.weight(1f), enabled = canNext, onClick = onNext)
        }
    }
}

@Composable
fun PermissionRow(icon: ImageVector, title: String, body: String, granted: Boolean, required: Boolean, onClick: () -> Unit) {
    com.safarzod.jarvis.ui.components.GlassCard(
        Modifier.fillMaxWidth(),
        padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 14.dp),
        onClick = if (granted) null else onClick,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            com.safarzod.jarvis.ui.components.IconBadge(icon, if (granted) J.c.success else J.c.accent, 40.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = J.t.label, color = J.c.text)
                Text(body, style = J.t.bodyS, color = J.c.text3)
            }
            Spacer(Modifier.width(10.dp))
            Box(
                Modifier
                    .background(if (granted) J.c.success.copy(alpha = 0.14f) else J.c.accent.copy(alpha = 0.14f), RoundedCornerShape(10.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            ) {
                Text(
                    if (granted) "ГОТОВО" else if (required) "НУЖНО" else "ВКЛЮЧИТЬ",
                    style = J.t.mono, color = if (granted) J.c.success else J.c.accent,
                )
            }
        }
    }
}

/** Шаг «Мозг»: локальная нейросеть для свободного разговора (по желанию, скачивается один раз). */
@Composable
private fun BrainPage(onNext: () -> Unit) {
    val app = LocalContext.current.applicationContext as JarvisApp
    val llm = app.llm
    val st by llm.status.collectAsState()
    val ramGb = remember {
        val mi = android.app.ActivityManager.MemoryInfo()
        (app.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager).getMemoryInfo(mi)
        mi.totalMem / 1_000_000_000.0
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 22.dp, vertical = 16.dp)) {
        Spacer(Modifier.weight(0.38f))
        Text("МОЗГ", style = J.t.mono, color = J.c.accent)
        Spacer(Modifier.height(10.dp))
        Text("Поговорим?", style = J.t.hero.copy(fontSize = J.t.title.fontSize * 1.25f), color = J.c.text)
        Spacer(Modifier.height(8.dp))
        Text(
            "Чтобы со мной можно было просто разговаривать и задавать вопросы, скачайте нейросеть. Она работает на телефоне, без интернета. Команды работают и без неё.",
            style = J.t.body, color = J.c.text2,
        )
        Spacer(Modifier.height(16.dp))
        if (!llm.supported) {
            GlassCard(Modifier.fillMaxWidth()) { Text("На этом процессоре нейросеть не запустится — но всё остальное работает.", style = J.t.body, color = J.c.text2) }
        } else {
            val installed = llm.installedSpec()
            llm.models.forEach { spec ->
                val recommended = if (ramGb >= 5.5) spec.id.contains("15b") else spec.id.contains("05b")
                GlassCard(Modifier.fillMaxWidth().padding(bottom = 10.dp), padding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(spec.title + if (recommended) " · рекомендую" else "", style = J.t.label, color = if (recommended) J.c.accent else J.c.text)
                            Text(spec.description, style = J.t.bodyS, color = J.c.text3)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    when {
                        installed?.id == spec.id -> Text("Установлена", style = J.t.label, color = J.c.success)
                        st is com.safarzod.jarvis.llm.LocalLlm.Status.Downloading -> Text(
                            "Загрузка ${((st as com.safarzod.jarvis.llm.LocalLlm.Status.Downloading).progress * 100).toInt()}% — продолжится в фоне",
                            style = J.t.bodyS, color = J.c.text2,
                        )
                        else -> GhostButton("Скачать · ${"%.1f".format(spec.bytes / 1e9).replace('.', ',')} ГБ", Modifier.fillMaxWidth()) { llm.download(spec) }
                    }
                }
            }
        }
        Spacer(Modifier.weight(0.62f))
        PrimaryButton(if (llm.installedSpec() != null || st is com.safarzod.jarvis.llm.LocalLlm.Status.Downloading) "Дальше" else "Позже", Modifier.fillMaxWidth(), onClick = onNext)
    }
}

@Composable
private fun StylePage(onDone: () -> Unit) {
    val app = LocalContext.current.applicationContext as JarvisApp
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 22.dp, vertical = 16.dp),
    ) {
        Spacer(Modifier.weight(0.40f))
        Text("ОБЛИК", style = J.t.mono, color = J.c.accent)
        Spacer(Modifier.height(10.dp))
        Text("Выберите ядро", style = J.t.hero.copy(fontSize = J.t.title.fontSize * 1.25f), color = J.c.text)
        Spacer(Modifier.height(8.dp))
        Text("Его можно поменять в настройках. Покрутите пальцем — оно объёмное.", style = J.t.body, color = J.c.text2)
        Spacer(Modifier.height(18.dp))
        CorePicker(app)
        Spacer(Modifier.height(16.dp))
        AccentPicker(app)
        Spacer(Modifier.weight(0.6f))
        PrimaryButton("Запустить Джарвиса", Modifier.fillMaxWidth(), onClick = onDone)
        Spacer(Modifier.height(4.dp))
    }
}
