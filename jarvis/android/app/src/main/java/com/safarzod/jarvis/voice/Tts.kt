package com.safarzod.jarvis.voice

import android.content.Context
import android.util.Log
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.log10
import kotlin.math.sqrt

/** Синтезированная фраза: PCM float [-1..1] + огибающая для анимации ядра. */
class Speech(val text: String, val samples: FloatArray, val sampleRate: Int) {
    val durationMs: Int get() = (samples.size * 1000L / sampleRate).toInt()

    /** Огибающая громкости 50 кадров/с, 0..1 — как у записанных фраз. */
    val envelope: ByteArray by lazy {
        val hop = sampleRate / 50
        val n = (samples.size + hop - 1) / hop
        val out = ByteArray(n)
        var s = 0f
        for (i in 0 until n) {
            var sum = 0.0
            val a = i * hop
            val b = minOf(samples.size, a + hop)
            for (k in a until b) sum += samples[k] * samples[k]
            val rms = sqrt(sum / maxOf(1, b - a))
            val db = 20 * log10(rms + 1e-6)
            val v = ((db + 50) / 44).toFloat().coerceIn(0f, 1f)
            s = if (v > s) v else s + (v - s) * 0.35f
            out[i] = (s * 255).toInt().toByte()
        }
        out
    }
}

/**
 * Офлайн-синтез голоса Джарвиса (VITS/Piper, обученный на записях из sounds/incoming) через sherpa-onnx.
 * Говорит любой текст: имена, время, текст напоминаний и сообщений.
 */
class Tts(private val context: Context) {

    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready
    private var tts: OfflineTts? = null
    private val lock = Mutex()
    @Volatile private var failed = false

    val available: Boolean get() = runCatching { context.assets.list("tts")?.contains("jarvis.onnx") == true }.getOrDefault(false)

    /** Загрузить модель (один раз). Данные espeak-ng копируются во внутреннюю память — им нужен настоящий путь. */
    suspend fun load(): Boolean = lock.withLock {
        if (tts != null) return true
        if (failed || !available) return false
        withContext(Dispatchers.IO) {
            try {
                val dataDir = copyEspeakData()
                val vits = OfflineTtsVitsModelConfig(
                    "tts/jarvis.onnx", "", "tts/tokens.txt", dataDir.absolutePath, "",
                    0.5f, 0.8f, 1.0f,
                )
                val model = OfflineTtsModelConfig().apply {
                    this.vits = vits
                    numThreads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
                    debug = false
                    provider = "cpu"
                }
                val config = OfflineTtsConfig().apply {
                    this.model = model
                    maxNumSentences = 2
                }
                tts = OfflineTts(context.assets, config)
                _ready.value = true
                true
            } catch (e: Throwable) {
                Log.e(TAG, "tts load", e)
                failed = true
                false
            }
        }
    }

    /** Синтезировать фразу. null — если синтез недоступен. Не держит главный поток. */
    suspend fun speak(text: String, speed: Float = 1.0f): Speech? {
        if (!load()) return null
        val clean = normalize(text)
        if (clean.isBlank()) return null
        return lock.withLock {
            withContext(Dispatchers.Default) {
                runCatching {
                    val a = tts!!.generate(clean, 0, speed)
                    Speech(text, trim(a.samples, a.sampleRate), a.sampleRate)
                }.onFailure { Log.e(TAG, "generate", it) }.getOrNull()
            }
        }
    }

    fun release() {
        runCatching { tts?.release() }
        tts = null
        _ready.value = false
    }

    private fun copyEspeakData(): File {
        val dst = File(context.filesDir, "tts/espeak-ng-data")
        val marker = File(dst, ".ok")
        if (marker.exists()) return dst
        dst.deleteRecursively()
        copyAssets("tts/espeak-ng-data", dst)
        marker.writeText("1")
        return dst
    }

    private fun copyAssets(path: String, dst: File) {
        val list = context.assets.list(path) ?: emptyArray()
        if (list.isEmpty()) {
            dst.parentFile?.mkdirs()
            context.assets.open(path).use { i -> dst.outputStream().use { i.copyTo(it) } }
            return
        }
        dst.mkdirs()
        for (n in list) copyAssets("$path/$n", File(dst, n))
    }

    /** Срезать тишину по краям (модель любит добавлять паузы) и сделать мягкие края. */
    private fun trim(x: FloatArray, sr: Int): FloatArray {
        val thr = 0.01f
        var a = 0
        while (a < x.size && kotlin.math.abs(x[a]) < thr) a++
        var b = x.size - 1
        while (b > a && kotlin.math.abs(x[b]) < thr) b--
        a = (a - sr / 50).coerceAtLeast(0)
        b = (b + sr / 8).coerceAtMost(x.size - 1)
        if (b <= a) return x
        val y = x.copyOfRange(a, b + 1)
        val fade = minOf(y.size / 4, sr / 100)
        for (i in 0 until fade) { val k = i.toFloat() / fade; y[i] *= k; y[y.size - 1 - i] *= k }
        return y
    }

    /** Текст для синтеза: без кавычек и эмодзи, «сэр» как слово, латиница — как читается. */
    private fun normalize(s: String): String {
        var t = s.replace(Regex("[«»\"“”„]"), "")
            .replace(Regex("[\\p{So}\\p{Cn}]"), "")
            .replace("YouTube", "Ютуб").replace("WhatsApp", "Ватсап").replace("Telegram", "Телеграм")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (t.isNotEmpty() && t.last() !in ".!?…") t += "."
        return t
    }

    companion object { private const val TAG = "Tts" }
}

/** Числа словами для синтеза: время, проценты, даты. */
object RuNum {
    private val ones = arrayOf("ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять",
        "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать")
    private val onesF = arrayOf("ноль", "одна", "две")
    private val tens = arrayOf("", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто")
    private val hundreds = arrayOf("", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот")
    private val ordNeuter = arrayOf("", "первое", "второе", "третье", "четвёртое", "пятое", "шестое", "седьмое", "восьмое", "девятое", "десятое",
        "одиннадцатое", "двенадцатое", "тринадцатое", "четырнадцатое", "пятнадцатое", "шестнадцатое", "семнадцатое", "восемнадцатое", "девятнадцатое", "двадцатое",
        "двадцать первое", "двадцать второе", "двадцать третье", "двадцать четвёртое", "двадцать пятое", "двадцать шестое", "двадцать седьмое", "двадцать восьмое",
        "двадцать девятое", "тридцатое", "тридцать первое")

    fun words(n: Long, feminine: Boolean = false): String {
        if (n < 0) return "минус " + words(-n, feminine)
        if (n < 20) return if (feminine && n < 3) onesF[n.toInt()] else ones[n.toInt()]
        if (n < 100) {
            val t = tens[(n / 10).toInt()]
            return if (n % 10 == 0L) t else t + " " + words(n % 10, feminine)
        }
        if (n < 1000) {
            val h = hundreds[(n / 100).toInt()]
            return if (n % 100 == 0L) h else h + " " + words(n % 100, feminine)
        }
        if (n < 1_000_000) {
            val th = n / 1000
            val rest = n % 1000
            val head = words(th, feminine = true) + " " + plural(th, "тысяча", "тысячи", "тысяч")
            return if (rest == 0L) head else head + " " + words(rest, feminine)
        }
        return n.toString()
    }

    fun plural(n: Long, one: String, few: String, many: String): String {
        val m10 = n % 10; val m100 = n % 100
        return when {
            m10 == 1L && m100 != 11L -> one
            m10 in 2..4 && m100 !in 12..14 -> few
            else -> many
        }
    }

    fun time(h: Int, m: Int): String {
        val hh = words(h.toLong()) + " " + plural(h.toLong(), "час", "часа", "часов")
        if (m == 0) return "$hh ровно"
        return hh + " " + words(m.toLong(), feminine = true) + " " + plural(m.toLong(), "минута", "минуты", "минут")
    }

    fun dayOrdinal(d: Int): String = ordNeuter.getOrElse(d) { d.toString() }
}
