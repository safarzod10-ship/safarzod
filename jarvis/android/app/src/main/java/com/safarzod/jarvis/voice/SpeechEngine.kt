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
import org.vosk.SpeakerModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
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

    enum class Mode { OFF, LOADING, WAKE, COMMAND, PAUSED, ENROLL }

    /** Результат одной фразы настройки голоса. */
    class Enrollment(
        val text: String,            // что распознал полный распознаватель
        val firstWord: String?,      // как распознано обращение («джарвис», «жарвис»…)
        val wakeConf: Double?,       // уверенность грамматики в слове «джарвис»
        val spk: FloatArray?,        // отпечаток голоса (x-vector)
        val speechRms: Float,
        val noiseRms: Float,
    )

    sealed interface Event {
        data object Wake : Event
        data class Partial(val text: String) : Event
        data class Final(val text: String, val spk: FloatArray? = null) : Event
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
    @Volatile private var spkModel: SpeakerModel? = null
    /** Нужен ли отпечаток голоса у команд (режим «только мой голос»). */
    @Volatile var wantSpeaker: Boolean = false
    /** Свои варианты обращения, найденные при настройке голоса. */
    @Volatile var extraWakeWords: Set<String> = emptySet()
    private val enrollWaiter = AtomicReference<CompletableDeferred<Enrollment?>?>(null)
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
                spkModel = runCatching { SpeakerModel(unpackAsset("model-spk").absolutePath) }.getOrNull()
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

    private fun unpackModel(): File = unpackAsset("model-ru")

    private fun unpackAsset(name: String): File {
        val target = File(context.filesDir, "vosk/$name")
        val assetUuid = context.assets.open("$name/uuid").bufferedReader().use { it.readText().trim() }
        val marker = File(target, "uuid")
        if (marker.exists() && marker.readText().trim() == assetUuid) return target
        val tmp = File(context.filesDir, "vosk/$name.tmp")
        tmp.deleteRecursively()
        copyAssetDir(name, tmp)
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
            if ((path == "model-ru" || path == "model-spk") && name == "uuid") continue
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

    /**
     * Записать одну фразу для настройки голоса: ждёт речь, затем паузу; до [timeoutMs].
     * Возвращает распознанный текст, уверенность в слове «джарвис» и отпечаток голоса.
     */
    suspend fun enroll(timeoutMs: Long = 10_000): Enrollment? {
        val d = CompletableDeferred<Enrollment?>()
        enrollWaiter.getAndSet(d)?.complete(null)
        request.set(Request(Mode.ENROLL, timeoutMs))
        return withTimeoutOrNull(timeoutMs + 3000) { d.await() }
    }

    val hasSpeakerModel: Boolean get() = spkModel != null

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
        var enrollFull: Recognizer? = null
        var enrollWake: Recognizer? = null
        var failedSince = 0L
        var reportedFailure = false
        try {
            val decoys = listOf("дарвин", "джаз", "жарко", "чарли", "давид")
            fun grammarFor(extra: Set<String>): String =
                (listOf("джарвис") + extra + decoys.filter { it !in extra } + "[unk]").distinct().joinToString(", ", "[", "]") { "\"$it\"" }
            var grammarExtra = extraWakeWords
            val wakeGrammar = grammarFor(emptySet())
            wakeRec = Recognizer(m, rate.toFloat(), grammarFor(grammarExtra)).apply { setWords(true) }

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
            var enrollStart = 0L
            var enrollHeard = 0L
            var enrollTimeout = 10_000L
            val enrollSpeech = ArrayList<Float>()
            val enrollNoise = ArrayList<Float>()

            fun setMode(nm: Mode) { mode = nm; _mode.value = nm; if (nm == Mode.PAUSED) pausedAt = SystemClock.uptimeMillis() }

            fun startCommand(feed: Int) {
                cmdRec?.close()
                val sm = spkModel
                cmdRec = if (wantSpeaker && sm != null) Recognizer(m, rate.toFloat(), sm) else Recognizer(m, rate.toFloat())
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
                    // другой режим перебил настройку голоса — честно завершаем ожидание и освобождаем распознаватели
                    if (mode == Mode.ENROLL && r.mode != Mode.ENROLL) {
                        enrollWaiter.getAndSet(null)?.complete(null)
                        enrollFull?.close(); enrollWake?.close(); enrollFull = null; enrollWake = null
                    }
                    when (r.mode) {
                        Mode.WAKE -> {
                            // после настройки голоса — свои варианты обращения тоже будят Джарвиса
                            if (extraWakeWords != grammarExtra) {
                                grammarExtra = extraWakeWords
                                wakeRec?.close()
                                wakeRec = Recognizer(m, rate.toFloat(), grammarFor(grammarExtra)).apply { setWords(true) }
                            }
                            wakeRec!!.reset(); wakeHits = 0; setMode(Mode.WAKE)
                        }
                        Mode.COMMAND -> {
                            commandTimeoutMs = r.timeoutMs
                            skipSamples = (r.skipMs * rate / 1000).toInt()
                            startCommand(if (r.feedRing) ringFilled else 0)
                        }
                        Mode.ENROLL -> {
                            enrollFull?.close(); enrollWake?.close()
                            val sm = spkModel
                            enrollFull = (if (sm != null) Recognizer(m, rate.toFloat(), sm) else Recognizer(m, rate.toFloat())).apply { setWords(true) }
                            enrollWake = Recognizer(m, rate.toFloat(), wakeGrammar).apply { setWords(true) }
                            enrollStart = SystemClock.uptimeMillis(); enrollHeard = 0L; enrollTimeout = r.timeoutMs
                            enrollSpeech.clear(); enrollNoise.clear()
                            skipSamples = rate * 2 / 10
                            setMode(Mode.ENROLL)
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
                    // после переоткрытия старый звук в буфере уже не относится к делу
                    ringFilled = 0
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
                _level.value = if (mode == Mode.COMMAND || mode == Mode.WAKE || mode == Mode.ENROLL) smoothLevel else 0f
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
                                    ?.firstOrNull { val w = it.jsonObject["word"]?.jsonPrimitive?.contentOrNull; w == "джарвис" || w in grammarExtra }
                                    ?.jsonObject?.get("conf")?.jsonPrimitive?.doubleOrNull
                            }.getOrNull()
                            wakeHits = 0
                            if (conf != null && conf >= 0.92 - sensitivity * 0.3) {
                                _events.tryEmit(Event.Wake)
                                startCommand(minOf(ringFilled, rate / 2))
                            }
                        } else {
                            val p = partialText(wr.partialResult)
                            if (p.split(' ').any { it == "джарвис" || it in grammarExtra }) {
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
                            val js = r.result
                            val text = resultText(js)
                            if (text.isNotBlank()) { _events.tryEmit(Event.Final(text, speakerVector(js))); setMode(Mode.PAUSED); continue }
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
                            val js = r.finalResult
                            finishCommand(resultText(js), speakerVector(js)); setMode(Mode.PAUSED); continue
                        }
                        if (lastPartial.isBlank() && now - listenStartedAt > commandTimeoutMs) {
                            _events.tryEmit(Event.Timeout); setMode(Mode.PAUSED); continue
                        }
                        if (now - listenStartedAt > 20_000) {
                            val js = r.finalResult
                            finishCommand(resultText(js), speakerVector(js)); setMode(Mode.PAUSED); continue
                        }
                    }

                    Mode.ENROLL -> {
                        val fr = enrollFull ?: continue
                        val wr = enrollWake!!
                        if (skipSamples > 0) { skipSamples -= n; enrollNoise += rms; continue }
                        val now = SystemClock.uptimeMillis()
                        fr.acceptWaveForm(chunk, n)
                        wr.acceptWaveForm(chunk, n)
                        if (voiced) { enrollHeard = now; enrollSpeech += rms } else enrollNoise += rms
                        val done = (enrollHeard > 0 && now - enrollHeard > 1100) || now - enrollStart > enrollTimeout
                        if (done) {
                            val js = fr.finalResult
                            val text = resultText(js)
                            val conf = runCatching {
                                json.parseToJsonElement(wr.finalResult).jsonObject["result"]?.jsonArray
                                    ?.firstOrNull { it.jsonObject["word"]?.jsonPrimitive?.contentOrNull == "джарвис" }
                                    ?.jsonObject?.get("conf")?.jsonPrimitive?.doubleOrNull
                            }.getOrNull()
                            val res = if (enrollHeard == 0L) null else Enrollment(
                                text, text.split(' ').firstOrNull { it.isNotBlank() }, conf, speakerVector(js),
                                enrollSpeech.sorted().getOrElse(enrollSpeech.size / 2) { 0f },
                                enrollNoise.sorted().getOrElse(enrollNoise.size / 2) { 0f },
                            )
                            enrollWaiter.getAndSet(null)?.complete(res)
                            enrollFull?.close(); enrollWake?.close(); enrollFull = null; enrollWake = null
                            setMode(Mode.PAUSED)
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
            enrollWaiter.getAndSet(null)?.complete(null)
            runCatching { enrollFull?.close() }
            runCatching { enrollWake?.close() }
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

    private fun finishCommand(text: String, spk: FloatArray? = null) {
        if (text.isBlank()) _events.tryEmit(Event.Timeout) else _events.tryEmit(Event.Final(text, spk))
    }

    /** Отпечаток голоса из результата Vosk (поле "spk"), если распознаватель его посчитал. */
    private fun speakerVector(js: String): FloatArray? = runCatching {
        val arr = json.parseToJsonElement(js).jsonObject["spk"]?.jsonArray ?: return@runCatching null
        FloatArray(arr.size) { i -> arr[i].jsonPrimitive.doubleOrNull?.toFloat() ?: 0f }
    }.getOrNull()

    private fun partialText(js: String): String = runCatching {
        json.parseToJsonElement(js).jsonObject["partial"]?.jsonPrimitive?.contentOrNull ?: ""
    }.getOrDefault("").replace("[unk]", "").trim()

    private fun resultText(js: String): String = runCatching {
        json.parseToJsonElement(js).jsonObject["text"]?.jsonPrimitive?.contentOrNull ?: ""
    }.getOrDefault("").replace("[unk]", "").trim()

    companion object { private const val TAG = "SpeechEngine" }
}
