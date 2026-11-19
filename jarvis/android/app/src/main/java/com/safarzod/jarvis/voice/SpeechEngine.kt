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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
import java.util.concurrent.atomic.AtomicReference
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
    /** Модель загружена. */
    val ready: StateFlow<Boolean> = _ready
    private val _alive = MutableStateFlow(false)
    /** Поток микрофона работает. */
    val alive: StateFlow<Boolean> = _alive
    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 32, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val events: SharedFlow<Event> = _events

    /** 0 — строго (меньше ложных срабатываний), 1 — чутко. */
    @Volatile var sensitivity: Float = 0.5f

    @Volatile private var model: Model? = null
    private val loadLock = Mutex()
    private var thread: Thread? = null
    /** Номер «поколения» потока: старый поток видит, что номер сменился, и завершается. */
    @Volatile private var generation = 0

    /** Запрос смены режима от главного потока к аудиопотоку (забирается атомарно). */
    private data class Request(val mode: Mode, val timeoutMs: Long = 7000, val skipMs: Long = 0, val feedRing: Boolean = false)
    private val request = AtomicReference<Request?>(null)

    private val json = Json { ignoreUnknownKeys = true }

    /** Распаковать и загрузить модель (один раз; повторные вызовы ждут первый). */
    suspend fun load(): Boolean = loadLock.withLock {
        withContext(Dispatchers.IO) {
            if (model != null) return@withContext true
            _mode.value = Mode.LOADING
            try {
                LibVosk.setLogLevel(LogLevel.WARNINGS)
                val dir = unpackModel()
                model = Model(dir.absolutePath)
                _ready.value = true
                _mode.value = Mode.OFF
                true
            } catch (e: Throwable) {
                Log.e(TAG, "model load failed", e)
                // повреждённая распаковка — удалим, в следующий раз распакуем заново
                File(context.filesDir, "vosk/model-ru/uuid").delete()
                _events.tryEmit(Event.Failure("Не удалось загрузить модель распознавания"))
                _mode.value = Mode.OFF
                false
            }
        }
    }

    private fun unpackModel(): File {
        val target = File(context.filesDir, "vosk/model-ru")
        val assetUuid = context.assets.open("model-ru/uuid").bufferedReader().use { it.readText().trim() }
        val marker = File(target, "uuid")
        if (marker.exists() && marker.readText().trim() == assetUuid) return target
        val tmp = File(context.filesDir, "vosk/model-ru.tmp")
        tmp.deleteRecursively()
        copyAssetDir("model-ru", tmp)
        File(tmp, "uuid").writeText(assetUuid)
        target.deleteRecursively()
        if (!tmp.renameTo(target)) throw IllegalStateException("rename failed")
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
        for (name in list) {
            if (path == "model-ru" && name == "uuid") continue
            copyAssetDir("$path/$name", File(dst, name))
        }
    }

    @Synchronized
    fun start() {
        if (model == null) return
        if (thread?.isAlive == true && _alive.value) return
        thread?.join(1500)
        val g = ++generation
        request.set(Request(Mode.WAKE))
        thread = Thread({ loop(g) }, "jarvis-mic").apply { start() }
    }

    @Synchronized
    fun stop() {
        generation++
        thread?.join(1500)
        thread = null
        _alive.value = false
        _mode.value = Mode.OFF
        _level.value = 0f
    }

    fun release() {
        stop()
        model?.close()
        model = null
        _ready.value = false
    }

    fun listenWake() { request.set(Request(Mode.WAKE)) }

    /** Слушать команду. [withRing] — подать в распознаватель уже записанное (речь сразу после «Джарвис»). */
    fun listenCommand(timeoutMs: Long = 7000, skipFirstMs: Long = 0, withRing: Boolean = false) {
        request.set(Request(Mode.COMMAND, timeoutMs, skipFirstMs, withRing))
    }

    fun pause() { request.set(Request(Mode.PAUSED)) }

    // ---------------------------------------------------------------------------------------------

    private class Mic(val rec: AudioRecord, val ns: NoiseSuppressor?, val agc: AutomaticGainControl?) {
        fun release() {
            runCatching { rec.stop() }
            runCatching { rec.release() }
            runCatching { ns?.release() }
            runCatching { agc?.release() }
        }
    }

    @SuppressLint("MissingPermission")
    private fun openMic(rate: Int): Mic? {
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, rate))
        } catch (e: Throwable) {
            return null
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); return null }
        val ns = if (NoiseSuppressor.isAvailable()) runCatching { NoiseSuppressor.create(rec.audioSessionId)?.apply { enabled = true } }.getOrNull() else null
        val agc = if (AutomaticGainControl.isAvailable()) runCatching { AutomaticGainControl.create(rec.audioSessionId)?.apply { enabled = true } }.getOrNull() else null
        return Mic(rec, ns, agc)
    }

    private fun loop(g: Int) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val rate = 16000
        val m = model ?: return
        _alive.value = true
        var mic: Mic? = null
        var wakeRec: Recognizer? = null
        var cmdRec: Recognizer? = null
        var failedSince = 0L
        var reportedFailure = false
        try {
            val wakeGrammar = "[\"джарвис\", \"дарвин\", \"джаз\", \"жарко\", \"чарли\", \"давид\", \"[unk]\"]"
            wakeRec = Recognizer(m, rate.toFloat(), wakeGrammar).apply { setWords(true) }

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
            var pausedAt = SystemClock.uptimeMillis()
            var recording = false
            var commandTimeoutMs = 7000L

            fun setMode(nm: Mode) { mode = nm; _mode.value = nm; if (nm == Mode.PAUSED) pausedAt = SystemClock.uptimeMillis() }

            fun startCommand(feed: Int) {
                cmdRec?.close()
                cmdRec = Recognizer(m, rate.toFloat())
                if (feed > 0) feedRingInto(cmdRec!!, ring, ringPos, feed)
                lastPartial = ""
                listenStartedAt = SystemClock.uptimeMillis()
                partialChangedAt = listenStartedAt
                heardSpeechAt = if (feed > 0) listenStartedAt else 0L
                ringFilled = 0
                setMode(Mode.COMMAND)
            }

            while (generation == g) {
                request.getAndSet(null)?.let { r ->
                    when (r.mode) {
                        Mode.WAKE -> { wakeRec!!.reset(); wakeHits = 0; setMode(Mode.WAKE) }
                        Mode.COMMAND -> {
                            commandTimeoutMs = r.timeoutMs
                            skipSamples = (r.skipMs * rate / 1000).toInt()
                            startCommand(if (r.feedRing) ringFilled else 0)
                        }
                        else -> setMode(r.mode)
                    }
                }

                // на паузе дольше 1.5 с микрофон отпускаем (индикатор приватности гаснет, другие приложения могут писать звук)
                val wantMic = mode != Mode.PAUSED || SystemClock.uptimeMillis() - pausedAt < 1500
                if (!wantMic) {
                    if (recording) { mic?.release(); mic = null; recording = false; _level.value = 0f }
                    Thread.sleep(30)
                    continue
                }
                if (!recording) {
                    mic = mic ?: openMic(rate)
                    val ok = mic != null && runCatching { mic!!.rec.startRecording(); mic!!.rec.recordingState == AudioRecord.RECORDSTATE_RECORDING }.getOrDefault(false)
                    if (!ok) {
                        mic?.release(); mic = null
                        if (failedSince == 0L) failedSince = SystemClock.uptimeMillis()
                        if (!reportedFailure && SystemClock.uptimeMillis() - failedSince > 4000) {
                            reportedFailure = true
                            _events.tryEmit(Event.Failure("Микрофон занят другим приложением"))
                        }
                        Thread.sleep(500)
                        continue
                    }
                    recording = true
                    failedSince = 0L
                    reportedFailure = false
                }

                val rec = mic!!.rec
                val n = rec.read(chunk, 0, chunk.size)
                if (n < 0) {
                    // ERROR_DEAD_OBJECT (перезапуск аудиосервера) и прочее — пересоздаём микрофон
                    Log.w(TAG, "read error $n — reopening mic")
                    mic?.release(); mic = null; recording = false
                    Thread.sleep(300)
                    continue
                }
                if (n == 0) { Thread.sleep(10); continue }

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
                        val wr = wakeRec!!
                        if (wr.acceptWaveForm(chunk, n)) {
                            val conf = runCatching {
                                json.parseToJsonElement(wr.result).jsonObject["result"]?.jsonArray
                                    ?.firstOrNull { it.jsonObject["word"]?.jsonPrimitive?.contentOrNull == "джарвис" }
                                    ?.jsonObject?.get("conf")?.jsonPrimitive?.doubleOrNull
                            }.getOrNull()
                            wakeHits = 0
                            if (conf != null && conf >= 0.92 - sensitivity * 0.3) {
                                _events.tryEmit(Event.Wake)
                                startCommand(minOf(ringFilled, rate / 2))
                            }
                        } else {
                            val p = partialText(wr.partialResult)
                            if (p.split(' ').contains("джарвис")) {
                                wakeHits++
                                val need = if (sensitivity > 0.66f) 1 else if (sensitivity > 0.33f) 2 else 4
                                if (wakeHits >= need) {
                                    _events.tryEmit(Event.Wake)
                                    wr.reset(); wakeHits = 0
                                    // подаём последние 1.2 с: само слово и начало команды, если человек не сделал паузу
                                    startCommand(minOf(ringFilled, rate * 12 / 10))
                                }
                            } else wakeHits = 0
                        }
                    }

                    Mode.COMMAND -> {
                        val r = cmdRec ?: continue
                        if (skipSamples > 0) { skipSamples -= n; continue }
                        val now = SystemClock.uptimeMillis()
                        if (voiced) heardSpeechAt = now
                        if (r.acceptWaveForm(chunk, n)) {
                            val text = resultText(r.result)
                            if (text.isNotBlank()) { _events.tryEmit(Event.Final(text)); setMode(Mode.PAUSED); continue }
                        } else {
                            val p = partialText(r.partialResult)
                            if (p != lastPartial) {
                                lastPartial = p; partialChangedAt = now
                                if (p.isNotBlank()) _events.tryEmit(Event.Partial(p))
                            }
                        }
                        // своя «точка конца фразы»: тихо 0.9 с, или (в шуме) текст не меняется 1.7 с
                        val silentFor = now - maxOf(heardSpeechAt, partialChangedAt)
                        if (lastPartial.isNotBlank() && (silentFor > 900 || now - partialChangedAt > 1700)) {
                            finishCommand(resultText(r.finalResult)); setMode(Mode.PAUSED); continue
                        }
                        if (lastPartial.isBlank() && now - listenStartedAt > commandTimeoutMs) {
                            _events.tryEmit(Event.Timeout); setMode(Mode.PAUSED); continue
                        }
                        if (now - listenStartedAt > 20_000) {
                            finishCommand(resultText(r.finalResult)); setMode(Mode.PAUSED); continue
                        }
                    }

                    else -> Unit
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "audio loop", e)
            if (generation == g) _events.tryEmit(Event.Failure("Сбой распознавания речи"))
        } finally {
            mic?.release()
            runCatching { wakeRec?.close() }
            runCatching { cmdRec?.close() }
            _level.value = 0f
            // поток упал сам (не по stop()) — сообщаем, что микрофон не работает
            if (generation == g) { _alive.value = false; _mode.value = Mode.OFF }
        }
    }

    private fun feedRingInto(r: Recognizer, ring: ShortArray, ringPos: Int, count: Int) {
        if (count <= 0) return
        val tmp = ShortArray(count)
        val start = (ringPos - count + ring.size) % ring.size
        for (k in 0 until count) tmp[k] = ring[(start + k) % ring.size]
        r.acceptWaveForm(tmp, count)
    }

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
