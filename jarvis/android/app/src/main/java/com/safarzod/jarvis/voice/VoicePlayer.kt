package com.safarzod.jarvis.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/**
 * Проигрывает голос Джарвиса и звуки интерфейса.
 * Пока звучит голос, [level] повторяет огибающую записи — по ней «дышит» 3D-ядро.
 */
class VoicePlayer(private val context: Context) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
        .setWillPauseWhenDucked(false)
        .build()

    private val pool = SoundPool.Builder()
        .setMaxStreams(3)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        ).build()
    private val sfxIds = HashMap<Sfx, Int>()

    private val _level = MutableStateFlow(0f)
    val level: StateFlow<Float> = _level
    private val _speaking = MutableStateFlow(false)
    val speaking: StateFlow<Boolean> = _speaking

    var volume: Float = 1f
    var uiSounds: Boolean = true

    private var player: MediaPlayer? = null
    private var ticker: Job? = null
    private var finish: (() -> Unit)? = null

    init {
        for (s in Sfx.entries) {
            val f = s.file ?: continue
            runCatching { context.assets.openFd(f).use { sfxIds[s] = pool.load(it, 1) } }
        }
    }

    fun sfx(s: Sfx, gain: Float = 0.8f) {
        if (!uiSounds || s == Sfx.NONE) return
        val id = sfxIds[s] ?: return
        val v = (gain * volume).coerceIn(0f, 1f)
        pool.play(id, v, v, 1, 0, 1f)
    }

    /** Проиграть запись и дождаться окончания. */
    suspend fun play(clip: Clip) = withContext(Dispatchers.Main.immediate) {
        stop()
        val mp = MediaPlayer()
        player = mp
        var myFinish: (() -> Unit)? = null
        try {
            mp.setAudioAttributes(attrs)
            if (clip.builtin) {
                context.assets.openFd(clip.path).use { mp.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            } else {
                mp.setDataSource(clip.path)
            }
            mp.setVolume(volume, volume)
            suspendCancellableCoroutine { cont ->
                myFinish = { if (cont.isActive) cont.resume(Unit) }
                finish = myFinish
                mp.setOnPreparedListener {
                    audio.requestAudioFocus(focus)
                    _speaking.value = true
                    it.start()
                    val started = SystemClock.uptimeMillis()
                    ticker?.cancel()
                    ticker = scope.launch {
                        while (isActive) {
                            val pos = runCatching { mp.currentPosition.toLong() }.getOrElse { SystemClock.uptimeMillis() - started }
                            _level.value = clip.levelAt(pos + 40) // небольшое опережение — визуал не отстаёт от звука
                            delay(16)
                        }
                    }
                }
                mp.setOnCompletionListener { if (cont.isActive) cont.resume(Unit) }
                mp.setOnErrorListener { _, _, _ -> if (cont.isActive) cont.resume(Unit); true }
                cont.invokeOnCancellation { runCatching { mp.stop() } }
                mp.prepareAsync()
            }
        } catch (_: Exception) {
            // повреждённый файл не должен ломать диалог
        } finally {
            // следующая фраза могла уже начаться — трогаем общее состояние, только если оно ещё наше
            val mine = player === mp || player == null
            if (finish === myFinish) finish = null
            if (mine) {
                ticker?.cancel()
                _level.value = 0f
                _speaking.value = false
            }
            runCatching { mp.release() }
            if (player === mp) player = null
            if (mine) audio.abandonAudioFocusRequest(focus)
        }
    }

    /** Оборвать текущую фразу (ожидающий [play] сразу завершится). */
    fun stop() {
        player?.let { runCatching { it.stop() } }
        finish?.invoke()
    }

    fun release() {
        stop()
        pool.release()
    }
}
