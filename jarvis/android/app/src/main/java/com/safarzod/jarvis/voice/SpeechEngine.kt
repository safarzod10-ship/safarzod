package com.safarzod.jarvis.voice

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import kotlin.math.sqrt

/**
 * Офлайн-распознавание речи на Vosk.
 * Режим WAKE — дешёвый распознаватель с грамматикой ловит слово «Джарвис».
 * Режим COMMAND — полный распознаватель записывает команду. Последние 2 секунды звука
 * всегда в кольцевом буфере, поэтому «Джарвис, позвони маме» на одном дыхании не теряется.
 */
class SpeechEngine(private val context: Context) {

    enum class Mode { OFF, LOADING, WAKE, COMMAND, PAUSED }

    sealed interface Event {
        data object Wake : Event
        data class Partial(val text: String) : Event
        data class Final(val text: String) : Event
        data object Timeout : Event
        data class Failure(val message: String) : Event
    }

    private val _mode = MutableStateFlow(Mode.OFF)
    val mode: StateFlow<Mode> = _mode
    private val _level = MutableStateFlow(0f)
    val level: StateFlow<Float> = _level
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready
    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 32, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val events: SharedFlow<Event> = _events

    /** 0 — строго (меньше ложных срабатываний), 1 — чутко. */
    @Volatile var sensitivity: Float = 0.5f

    private var model: Model? = null
    private var thread: Thread? = null
    @Volatile private var running = false

    // команды от главного потока к аудиопотоку
    @Volatile private var pendingMode: Mode? = null
    @Volatile private var commandTimeoutMs = 7000L
    @Volatile private var skipMs = 0L
    @Volatile private var feedRing = false

    private val json = Json { ignoreUnknownKeys = true }

    /** Распаковать и загрузить модель (один раз). */
    suspend fun load(): Boolean = withContext(Dispatchers.IO) {
        if (model != null) return@withContext true
        _mode.value = Mode.LOADING
        try {
            LibVosk.setLogLevel(LogLevel.WARNINGS)
            val dir = unpackModel()
            model = Model(dir.absolutePath)
            _ready.value = true
            true
        } catch (e: Throwable) {
            Log.e(TAG, "model load failed", e)
            _events.tryEmit(Event.Failure("Не удалось загрузить модель распознавания"))
            _mode.value = Mode.OFF
            false
        }
    }

    private fun unpackModel(): File {
        val target = File(context.filesDir, "vosk/model-ru")
        val assetUuid = context.assets.open("model-ru/uuid").bufferedReader().use { it.readText().trim() }
        val marker = File(target, "uuid")
        if (marker.exists() && marker.readText().trim() == assetUuid) return target
        target.deleteRecursively()
        copyAssetDir("model-ru", target)
        marker.writeText(assetUuid)
        return target
    }

    private fun copyAssetDir(path: String, dst: File) {
        val list = context.assets.list(path) ?: emptyArray()
        if (list.isEmpty()) {
            dst.parentFile?.mkdirs()
            context.assets.open(path).use { input -> dst.outputStream().use { input.copyTo(it, 1 shl 16) } }
            return
        }
        dst.mkdirs()
        for (name in list) copyAssetDir("$path/$name", File(dst, name))
    }

    fun start() {
        if (running || model == null) return
        running = true
        pendingMode = Mode.WAKE
        thread = Thread(::loop, "jarvis-mic").apply { start() }
    }

    fun stop() {
        running = false
        thread?.join(1500)
        thread = null
        _mode.value = Mode.OFF
        _level.value = 0f
    }

    fun release() {
        stop()
        model?.close()
        model = null
        _ready.value = false
    }

    fun listenWake() { pendingMode = Mode.WAKE }

    /** Слушать команду. [withRing] — подать в распознаватель уже записанное (речь сразу после «Джарвис»). */
    fun listenCommand(timeoutMs: Long = 7000, skipFirstMs: Long = 0, withRing: Boolean = false) {
        commandTimeoutMs = timeoutMs
        skipMs = skipFirstMs
        feedRing = withRing
        pendingMode = Mode.COMMAND
    }

    fun pause() { pendingMode = Mode.PAUSED }

    // ---------------------------------------------------------------------------------------------

    @SuppressLint("MissingPermission")
    private fun loop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val rate = 16000
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, rate))
        } catch (e: Throwable) {
            _events.tryEmit(Event.Failure("Микрофон недоступен")); running = false; return
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            _events.tryEmit(Event.Failure("Микрофон занят другим приложением")); running = false; rec.release(); return
        }
        val ns = if (NoiseSuppressor.isAvailable()) runCatching { NoiseSuppressor.create(rec.audioSessionId)?.apply { enabled = true } }.getOrNull() else null
        val agc = if (AutomaticGainControl.isAvailable()) runCatching { AutomaticGainControl.create(rec.audioSessionId)?.apply { enabled = true } }.getOrNull() else null

        val m = model!!
        val wakeGrammar = "[\"джарвис\", \"дарвин\", \"джаз\", \"жарко\", \"чарли\", \"давид\", \"[unk]\"]"
        var wakeRec = Recognizer(m, rate.toFloat(), wakeGrammar).apply { setWords(true) }
        var cmdRec: Recognizer? = null

        val chunk = ShortArray(800) // 50 мс
        val ring = ShortArray(rate * 2)
        var ringPos = 0
        var ringFilled = 0
        var mode = Mode.PAUSED
        var lastPartial = ""
        var partialChangedAt = 0L
        var listenStartedAt = 0L
        var heardSpeechAt = 0L
        var skipSamples = 0
        var wakeHits = 0
        var smoothLevel = 0f
        var noiseFloor = 300f

        try {
            rec.startRecording()
            while (running) {
                pendingMode?.let { nm ->
                    pendingMode = null
                    when (nm) {
                        Mode.WAKE -> { wakeRec.reset(); wakeHits = 0 }
                        Mode.COMMAND -> {
                            cmdRec?.close()
                            cmdRec = Recognizer(m, rate.toFloat()).apply { setWords(false) }
                            lastPartial = ""
                            listenStartedAt = SystemClock.uptimeMillis()
                            partialChangedAt = listenStartedAt
                            heardSpeechAt = 0L
                            skipSamples = (skipMs * rate / 1000).toInt()
                            if (feedRing && ringFilled > 0) {
                                // подать записанное до переключения: окончание «Джарвис …»
                                feedRingInto(cmdRec!!, ring, ringPos, ringFilled)
                                heardSpeechAt = listenStartedAt
                            }
                            feedRing = false
                        }
                        else -> Unit
                    }
                    mode = nm
                    _mode.value = nm
                }

                val n = rec.read(chunk, 0, chunk.size)
                if (n <= 0) { Thread.sleep(10); continue }

                // уровень сигнала для визуала и детекции речи
                var sum = 0.0
                for (k in 0 until n) { val v = chunk[k].toDouble(); sum += v * v }
                val rms = sqrt(sum / n).toFloat()
                if (rms < noiseFloor * 1.5f) noiseFloor = noiseFloor * 0.98f + rms * 0.02f
                val norm = ((rms - noiseFloor) / 3500f).coerceIn(0f, 1f)
                smoothLevel = if (norm > smoothLevel) norm else smoothLevel * 0.85f + norm * 0.15f
                _level.value = if (mode == Mode.COMMAND || mode == Mode.WAKE) smoothLevel else 0f
                val voiced = rms > noiseFloor * 2.2f + 250f

                // кольцевой буфер
                for (k in 0 until n) { ring[ringPos] = chunk[k]; ringPos = (ringPos + 1) % ring.size }
                ringFilled = minOf(ring.size, ringFilled + n)

                when (mode) {
                    Mode.WAKE -> {
                        val isFinal = wakeRec.acceptWaveForm(chunk, n)
                        if (isFinal) {
                            val r = json.parseToJsonElement(wakeRec.result).jsonObject
                            val words = r["result"]?.jsonArray ?: emptyList()
                            val conf = words.firstOrNull { it.jsonObject["word"]?.jsonPrimitive?.contentOrNull == "джарвис" }
                                ?.jsonObject?.get("conf")?.jsonPrimitive?.doubleOrNull
                            if (conf != null && conf >= 0.92 - sensitivity * 0.3) {
                                onWake(); mode = Mode.COMMAND; _mode.value = mode
                                cmdRec?.close()
                                cmdRec = Recognizer(m, rate.toFloat())
                                feedRingInto(cmdRec!!, ring, ringPos, minOf(ringFilled, rate / 2))
                                listenStartedAt = SystemClock.uptimeMillis(); partialChangedAt = listenStartedAt; heardSpeechAt = 0L; lastPartial = ""
                                ringFilled = 0
                            }
                            wakeHits = 0
                        } else {
                            val p = partialText(wakeRec.partialResult)
                            if (p.split(' ').contains("джарвис")) {
                                wakeHits++
                                val need = if (sensitivity > 0.66f) 1 else if (sensitivity > 0.33f) 2 else 4
                                if (wakeHits >= need) {
                                    onWake()
                                    wakeRec.reset(); wakeHits = 0
                                    mode = Mode.COMMAND; _mode.value = mode
                                    cmdRec?.close()
                                    cmdRec = Recognizer(m, rate.toFloat())
                                    // подаём последние 1.2 с: само слово и начало команды, если человек не сделал паузу
                                    feedRingInto(cmdRec!!, ring, ringPos, minOf(ringFilled, rate * 12 / 10))
                                    listenStartedAt = SystemClock.uptimeMillis(); partialChangedAt = listenStartedAt
                                    heardSpeechAt = listenStartedAt; lastPartial = ""
                                    ringFilled = 0
                                }
                            } else wakeHits = 0
                        }
                    }

                    Mode.COMMAND -> {
                        val r = cmdRec ?: continue
                        if (skipSamples > 0) { skipSamples -= n; continue }
                        val now = SystemClock.uptimeMillis()
                        if (voiced) heardSpeechAt = now
                        val isFinal = r.acceptWaveForm(chunk, n)
                        if (isFinal) {
                            val text = resultText(r.result)
                            if (text.isNotBlank()) { finishCommand(text); mode = Mode.PAUSED; _mode.value = mode; continue }
                        } else {
                            val p = partialText(r.partialResult)
                            if (p != lastPartial) {
                                lastPartial = p; partialChangedAt = now
                                if (p.isNotBlank()) _events.tryEmit(Event.Partial(p))
                            }
                        }
                        // своя «точка конца фразы»: текст не меняется и тихо
                        val silentFor = now - maxOf(heardSpeechAt, partialChangedAt)
                        // в шуме «тишины» может не быть — тогда ориентируемся на то, что текст перестал меняться
                        if (lastPartial.isNotBlank() && (silentFor > 900 || now - partialChangedAt > 1700)) {
                            finishCommand(resultText(r.finalResult)); mode = Mode.PAUSED; _mode.value = mode; continue
                        }
                        if (lastPartial.isBlank() && now - listenStartedAt > commandTimeoutMs) {
                            _events.tryEmit(Event.Timeout); mode = Mode.PAUSED; _mode.value = mode; continue
                        }
                        if (now - listenStartedAt > 20_000) {
                            finishCommand(resultText(r.finalResult)); mode = Mode.PAUSED; _mode.value = mode; continue
                        }
                    }

                    else -> Unit
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "audio loop", e)
            _events.tryEmit(Event.Failure("Сбой распознавания речи"))
        } finally {
            runCatching { rec.stop() }
            rec.release()
            ns?.release(); agc?.release()
            wakeRec.close()
            cmdRec?.close()
            _level.value = 0f
        }
    }

    private fun feedRingInto(r: Recognizer, ring: ShortArray, ringPos: Int, count: Int) {
        if (count <= 0) return
        val tmp = ShortArray(count)
        val start = (ringPos - count + ring.size) % ring.size
        for (k in 0 until count) tmp[k] = ring[(start + k) % ring.size]
        r.acceptWaveForm(tmp, count)
    }

    private fun onWake() { _events.tryEmit(Event.Wake) }

    private fun finishCommand(text: String) {
        if (text.isBlank()) _events.tryEmit(Event.Timeout) else _events.tryEmit(Event.Final(text))
    }

    private fun partialText(js: String): String = runCatching {
        json.parseToJsonElement(js).jsonObject["partial"]?.jsonPrimitive?.contentOrNull ?: ""
    }.getOrDefault("").replace("[unk]", "").trim()

    private fun resultText(js: String): String = runCatching {
        json.parseToJsonElement(js).jsonObject["text"]?.jsonPrimitive?.contentOrNull ?: ""
    }.getOrDefault("").replace("[unk]", "").trim()

    companion object { private const val TAG = "SpeechEngine" }
}
