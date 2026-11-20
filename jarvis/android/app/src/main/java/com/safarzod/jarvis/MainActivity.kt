package com.safarzod.jarvis

import android.content.Intent
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.safarzod.jarvis.core.Need
import com.safarzod.jarvis.core.Phase
import com.safarzod.jarvis.core.UiEvent
import com.safarzod.jarvis.gl.CoreParams
import com.safarzod.jarvis.gl.CoreView
import com.safarzod.jarvis.service.JarvisService
import com.safarzod.jarvis.ui.Perms
import com.safarzod.jarvis.ui.home.HomeScreen
import com.safarzod.jarvis.ui.screens.CommandsScreen
import com.safarzod.jarvis.ui.screens.HistoryScreen
import com.safarzod.jarvis.ui.screens.MemoryScreen
import com.safarzod.jarvis.ui.screens.ModelScreen
import com.safarzod.jarvis.ui.screens.OnboardingScreen
import com.safarzod.jarvis.ui.screens.SettingsScreen
import com.safarzod.jarvis.ui.screens.VoiceScreen
import com.safarzod.jarvis.ui.theme.JarvisTheme
import com.safarzod.jarvis.ui.theme.deep
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val app get() = application as JarvisApp
    private val params = CoreParams()
    private val listenRequest = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        setContent {
            val accent by app.settings.accent.flow.collectAsState()
            JarvisTheme(Color(accent.argb)) { Root() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        if (i?.getBooleanExtra(EXTRA_LISTEN, false) == true || i?.action == Intent.ACTION_ASSIST || i?.action == Intent.ACTION_VOICE_COMMAND) {
            listenRequest.value = true
        }
    }

    override fun onStart() {
        super.onStart()
        if (app.settings.onboarded.value && !app.settings.muted.value) {
            JarvisService.start(this, greet = !JarvisService.running)
            // разрешения могли выдать в системных настройках — пусть служба перепроверит
            JarvisService.refresh(this)
        }
    }

    override fun onStop() {
        super.onStop()
        // без фонового режима Джарвис слушает только пока приложение открыто
        if (!app.settings.background.value && !isChangingConfigurations) JarvisService.stop(this)
    }

    @Composable
    private fun Root() {
        val engine = app.engine
        val settings = app.settings
        val onboarded by settings.onboarded.flow.collectAsState()
        var screen by rememberSaveable { mutableStateOf("home") }
        val ctx = LocalContext.current

        // ---- 3D-ядро: связываем состояние Джарвиса с шейдерами
        LaunchedEffect(Unit) {
            launch { settings.coreStyle.flow.collect { params.style = it } }
            launch {
                settings.quality.flow.collect {
                    params.renderScale = it.scale; params.plasmaSteps = it.plasmaSteps; params.particles = it.particles
                }
            }
            launch {
                combine(engine.ui, settings.accent.flow) { ui, acc -> Triple(ui.phase, acc, ui.muted) }.collect { (phase, acc, muted) ->
                    val a = Color(acc.argb)
                    val d = a.deep()
                    when (phase) {
                        Phase.THINKING -> { params.colA = floatArrayOf(0.72f, 0.58f, 1f); params.colB = floatArrayOf(0.28f, 0.18f, 0.92f) }
                        Phase.OFF, Phase.LOADING -> { params.colA = floatArrayOf(a.red * 0.6f, a.green * 0.6f, a.blue * 0.6f); params.colB = floatArrayOf(d.red, d.green, d.blue) }
                        else -> { params.colA = floatArrayOf(a.red, a.green, a.blue); params.colB = floatArrayOf(d.red, d.green, d.blue) }
                    }
                    params.energy = when (phase) {
                        Phase.OFF -> 0.04f; Phase.LOADING -> 0.10f; Phase.STANDBY -> 0.18f
                        Phase.LISTENING -> 0.72f; Phase.THINKING -> 0.6f; Phase.SPEAKING -> 1f
                    }
                    params.think = if (phase == Phase.THINKING) 1f else 0f
                    if (muted) {
                        // на паузе ядро гаснет и замирает почти полностью
                        params.colA = floatArrayOf(0.35f, 0.38f, 0.42f); params.colB = floatArrayOf(0.12f, 0.13f, 0.16f)
                        params.energy = 0.02f; params.think = 0f
                    }
                }
            }
            launch {
                combine(engine.player.level, engine.speech.level, engine.ui) { voice, mic, ui ->
                    when (ui.phase) { Phase.SPEAKING -> voice; Phase.LISTENING -> mic * 0.9f; else -> 0f }
                }.collect { params.level = it }
            }
        }

        // ---- запросы разрешений из движка и карточек
        var pendingNeed by remember { mutableStateOf<Need?>(null) }
        val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
            val denied = res.values.any { !it }
            if (denied && pendingNeed != null && Perms.runtime(pendingNeed!!).any { !shouldShowRequestPermissionRationale(it) } && !Perms.granted(ctx, pendingNeed!!)) {
                startActivity(Perms.appDetails(ctx))
            }
            if (res[android.Manifest.permission.RECORD_AUDIO] == true && settings.onboarded.value) JarvisService.start(ctx)
            if (res[android.Manifest.permission.READ_PHONE_STATE] == true) JarvisService.refresh(ctx)
            engine.contacts.invalidate()
            pendingNeed = null
        }
        val request: (Need) -> Unit = { n ->
            val rt = Perms.runtime(n)
            if (rt.isNotEmpty()) { pendingNeed = n; permLauncher.launch(rt) }
            else Perms.settingsIntent(ctx, n)?.let { runCatching { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
        }
        LaunchedEffect(Unit) {
            engine.events.collect { e ->
                when (e) {
                    is UiEvent.Open -> screen = e.screen
                    is UiEvent.RequestNeed -> Unit // карточка с кнопкой «Разрешить» уже показана
                }
            }
        }
        // плитка в шторке / жест ассистента: дождаться готовности и начать слушать
        LaunchedEffect(Unit) {
            snapshotFlow { listenRequest.value }.filter { it }.collect {
                val ready = kotlinx.coroutines.withTimeoutOrNull(10_000) { engine.ui.first { it.phase == Phase.STANDBY } }
                listenRequest.value = false
                if (ready != null) engine.onMicTap()
            }
        }

        val open: (String) -> Unit = { target ->
            if (target.startsWith("need:")) request(Need.valueOf(target.removePrefix("need:")))
            else screen = target
        }

        Box(Modifier.fillMaxSize().background(Color(0xFF04060A))) {
            CoreSurface(screen == "home" || !onboarded)
            if (!onboarded) {
                OnboardingScreen(
                    params = params,
                    request = request,
                    onDone = {
                        settings.onboarded.value = true
                        JarvisService.start(ctx, greet = true)
                    },
                )
            } else {
                BackHandler(screen != "home") { screen = if (screen == "model" || screen == "voice" || screen == "voicesetup") "settings" else "home" }
                AnimatedContent(
                    screen,
                    transitionSpec = {
                        if (targetState == "home") (fadeIn(tween(300)) + scaleIn(tween(300), 1.04f)) togetherWith (fadeOut(tween(200)) + scaleOut(tween(200), 0.98f))
                        else (fadeIn(tween(300)) + scaleIn(tween(300), 0.97f)) togetherWith (fadeOut(tween(180)) + scaleOut(tween(200), 1.02f))
                    },
                    label = "nav",
                ) { s ->
                    when (s) {
                        "settings" -> SettingsScreen(app, onBack = { screen = "home" }, onOpen = open, request = request)
                        "memory" -> MemoryScreen(engine, onBack = { screen = "home" })
                        "history" -> HistoryScreen(onBack = { screen = "home" })
                        "voice" -> VoiceScreen(engine, onBack = { screen = "settings" })
                        "model" -> ModelScreen(app, onBack = { screen = "settings" })
                        "commands" -> CommandsScreen(onBack = { screen = "home" }, onRun = { screen = "home"; engine.submitText(it) })
                        "voicesetup" -> com.safarzod.jarvis.ui.screens.VoiceSetupScreen(app, embedded = false) { screen = "settings" }
                        else -> HomeScreen(engine, params, onOpen = open)
                    }
                }
            }
        }
    }

    /** GL-поверхность ядра за интерфейсом. На других экранах — пауза (экономия батареи). */
    @Composable
    private fun CoreSurface(visible: Boolean) {
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        val view = remember { CoreView(this, params) }
        DisposableEffect(lifecycle, visible) {
            val obs = LifecycleEventObserver { _, e ->
                when (e) {
                    Lifecycle.Event.ON_RESUME -> if (visible) view.onResume()
                    Lifecycle.Event.ON_PAUSE -> view.onPause()
                    else -> Unit
                }
            }
            lifecycle.addObserver(obs)
            if (visible && lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.onResume() else if (!visible) view.onPause()
            onDispose { lifecycle.removeObserver(obs) }
        }
        val phase by app.engine.ui.collectAsState()
        LaunchedEffect(phase.phase) { view.active = phase.phase != Phase.STANDBY && phase.phase != Phase.OFF }
        LaunchedEffect(Unit) {
            params.reducedMotion = AndroidSettings.Global.getFloat(contentResolver, AndroidSettings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }
        AndroidView({ view }, Modifier.fillMaxSize())
    }

    companion object {
        const val EXTRA_LISTEN = "listen"
    }
}
