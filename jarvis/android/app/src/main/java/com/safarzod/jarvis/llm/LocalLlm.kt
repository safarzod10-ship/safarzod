package com.safarzod.jarvis.llm

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.util.Log
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import com.google.mediapipe.tasks.genai.llminference.PromptTemplates
import com.safarzod.jarvis.core.Settings
import com.safarzod.jarvis.nlu.Command
import com.safarzod.jarvis.nlu.MediaAction
import com.safarzod.jarvis.nlu.MessengerApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Локальная языковая модель (без интернета и серверов). Используется только для двух задач:
 * понять фразу, которую не разобрали правила, и привести в порядок текст сообщения.
 */
class LocalLlm(private val context: Context, private val settings: Settings) {

    data class Spec(val id: String, val title: String, val description: String, val bytes: Long, val url: String) {
        val fileName: String get() = url.substringAfterLast('/')
    }

    sealed interface Status {
        data object None : Status
        data class Downloading(val progress: Float, val bytes: Long, val total: Long) : Status
        data class Copying(val progress: Float) : Status
        data class Installed(val spec: Spec?) : Status
        data object Loading : Status
        data class Ready(val spec: Spec?) : Status
        data class Failed(val message: String) : Status
        data object Unsupported : Status
    }

    val models = listOf(
        Spec(
            "qwen25_05b", "Лёгкая", "Qwen 2.5 · 0.5B · 520 МБ. Быстрая, подходит любому телефону.",
            546_660_344L,
            "https://huggingface.co/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        ),
        Spec(
            "qwen25_15b", "Умная", "Qwen 2.5 · 1.5B · 1.5 ГБ. Лучше понимает и пишет, нужно 6+ ГБ ОЗУ.",
            1_597_913_616L,
            "https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        ),
    )

    private val dir: File get() = (context.getExternalFilesDir("models") ?: File(context.filesDir, "models")).apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private var engine: LlmInference? = null
    private var pollJob: Job? = null
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    private val _status = MutableStateFlow<Status>(Status.None)
    val status: StateFlow<Status> = _status

    val supported: Boolean = Build.SUPPORTED_ABIS.contains("arm64-v8a")

    init {
        refresh()
    }

    fun installedFile(): File? = dir.listFiles()?.firstOrNull { it.name.endsWith(".task") && it.length() > 100_000_000L }

    fun installedSpec(): Spec? = installedFile()?.let { f -> models.firstOrNull { it.fileName == f.name } }

    fun refresh() {
        if (!supported) { _status.value = Status.Unsupported; return }
        if (_status.value is Status.Downloading || _status.value is Status.Copying) return
        _status.value = when {
            engine != null -> Status.Ready(installedSpec())
            installedFile() != null -> Status.Installed(installedSpec())
            else -> Status.None
        }
    }

    // ---------------- установка ----------------

    fun download(spec: Spec) {
        if (!supported) return
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        File(dir, spec.fileName + ".part").delete()
        val req = DownloadManager.Request(Uri.parse(spec.url))
            .setTitle("Джарвис: нейросеть «${spec.title}»")
            .setDescription("Загрузка локальной модели")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedOverMetered(true)
            .setDestinationUri(Uri.fromFile(File(dir, spec.fileName + ".part")))
        val id = dm.enqueue(req)
        settings.llmModel.value = spec.id
        _status.value = Status.Downloading(0f, 0, spec.bytes)
        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive) {
                delay(500)
                val q = dm.query(DownloadManager.Query().setFilterById(id)) ?: continue
                q.use { c ->
                    if (!c.moveToFirst()) { _status.value = Status.Failed("Загрузка отменена"); return@launch }
                    val st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    val got = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).takeIf { it > 0 } ?: spec.bytes
                    when (st) {
                        DownloadManager.STATUS_SUCCESSFUL -> {
                            dir.listFiles()?.filter { it.name.endsWith(".task") }?.forEach { it.delete() }
                            File(dir, spec.fileName + ".part").renameTo(File(dir, spec.fileName))
                            unload()
                            _status.value = Status.Installed(spec)
                            return@launch
                        }
                        DownloadManager.STATUS_FAILED -> {
                            _status.value = Status.Failed("Не удалось скачать модель. Проверьте интернет и место на телефоне.")
                            return@launch
                        }
                        else -> _status.value = Status.Downloading(got.toFloat() / total, got, total)
                    }
                }
            }
        }
    }

    fun cancelDownload() {
        pollJob?.cancel()
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        dm.query(DownloadManager.Query().setFilterByStatus(DownloadManager.STATUS_RUNNING or DownloadManager.STATUS_PENDING or DownloadManager.STATUS_PAUSED))?.use { c ->
            while (c.moveToNext()) {
                val uri = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)) ?: continue
                if (uri.contains("/models/")) dm.remove(c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)))
            }
        }
        dir.listFiles()?.filter { it.name.endsWith(".part") }?.forEach { it.delete() }
        _status.value = Status.None
        refresh()
    }

    /** Установить модель из файла .task, скачанного вручную. */
    fun importFrom(uri: Uri) {
        if (!supported) return
        scope.launch {
            try {
                val size = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
                val name = uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.endsWith(".task") } ?: "imported.task"
                val tmp = File(dir, "$name.part")
                _status.value = Status.Copying(0f)
                context.contentResolver.openInputStream(uri)!!.use { input ->
                    tmp.outputStream().use { out ->
                        val buf = ByteArray(1 shl 20)
                        var copied = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            copied += n
                            if (size > 0) _status.value = Status.Copying(copied.toFloat() / size)
                        }
                    }
                }
                require(tmp.length() > 100_000_000L) { "Файл слишком маленький для модели" }
                dir.listFiles()?.filter { it.name.endsWith(".task") }?.forEach { it.delete() }
                tmp.renameTo(File(dir, name))
                unload()
                _status.value = Status.Installed(installedSpec())
            } catch (e: Exception) {
                _status.value = Status.Failed(e.message ?: "Не удалось импортировать файл")
            }
        }
    }

    fun delete() {
        settings.llmModel.value = ""
        _status.value = Status.None
        scope.launch {
            lock.withLock {
                runCatching { engine?.close() }
                engine = null
                dir.listFiles()?.forEach { it.delete() }
            }
            refresh()
        }
    }

    /** Выгрузить модель из памяти. Ждёт окончания текущего ответа — нельзя закрывать модель посреди генерации. */
    fun unload() {
        scope.launch {
            lock.withLock {
                runCatching { engine?.close() }
                engine = null
            }
            if (_status.value is Status.Ready) refresh()
        }
    }

    // ---------------- работа ----------------

    private suspend fun ensureLoaded(): LlmInference? = lock.withLock {
        engine?.let { return it }
        val f = installedFile() ?: return null
        _status.value = Status.Loading
        return try {
            val opts = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(f.absolutePath)
                .setMaxTokens(1024)
                .setMaxTopK(40)
                .build()
            LlmInference.createFromOptions(context, opts).also {
                engine = it
                _status.value = Status.Ready(installedSpec())
            }
        } catch (e: Throwable) {
            Log.e(TAG, "load", e)
            _status.value = Status.Failed("Модель не запускается на этом телефоне")
            null
        }
    }

    val available: Boolean get() = supported && settings.llmEnabled.value && installedFile() != null

    /** Прогреть модель заранее, чтобы первый ответ был быстрым. */
    fun warmUp() { if (available) scope.launch { ensureLoaded() } }

    /**
     * Сгенерировать ответ. Никогда не держит пользователя дольше [timeoutMs]: если модель ещё не загружена,
     * загрузка идёт в фоне, а сейчас возвращается null (команду разберут правила).
     */
    private suspend fun complete(user: String, temperature: Float, timeoutMs: Long): String? = withContext(Dispatchers.Default) {
        if (engine == null) { warmUp(); return@withContext null }
        if (!lock.tryLock()) return@withContext null
        var handOff = false
        try {
            val llm = engine ?: return@withContext null // могли выгрузить, пока ждали
            runCatching {
                    val so = LlmInferenceSession.LlmInferenceSessionOptions.builder()
                        .setTemperature(temperature)
                        .setTopK(20)
                        .setTopP(0.9f)
                        .setPromptTemplates(
                            PromptTemplates.builder()
                                .setUserPrefix("").setUserSuffix("")
                                .setModelPrefix("").setModelSuffix("")
                                .setSystemPrefix("").setSystemSuffix("")
                                .build()
                        )
                        .build()
                    val s = LlmInferenceSession.createFromOptions(llm, so)
                    s.addQueryChunk(user)
                    val future = s.generateResponseAsync()
                    try {
                        future.get(timeoutMs, TimeUnit.MILLISECONDS).also { s.close() }
                    } catch (e: TimeoutException) {
                        runCatching { s.cancelGenerateResponseAsync() }
                        // модель ещё считает: замок и сессию отпустим только когда генерация реально закончится,
                        // иначе выгрузка модели посреди работы уронит нативный код
                        handOff = true
                        scope.launch {
                            runCatching { future.get() }
                            runCatching { s.close() }
                            lock.unlock()
                        }
                        null
                    } catch (e: Exception) {
                        runCatching { s.close() }
                        throw e
                    }
            }.onFailure { Log.e(TAG, "generate", it) }.getOrNull()
        } finally {
            if (!handOff) lock.unlock()
        }
    }

    private fun chat(system: String, user: String) =
        "<|im_start|>system\n$system<|im_end|>\n<|im_start|>user\n$user<|im_end|>\n<|im_start|>assistant\n"

    /**
     * Свободный разговор. Ответ приходит по предложениям в [onSentence] сразу по мере генерации —
     * Джарвис начинает говорить, не дожидаясь конца. Возвращает весь ответ или null.
     */
    suspend fun converse(history: List<Pair<String, String>>, text: String, timeoutMs: Long = 30_000, onSentence: (String) -> Unit): String? =
        withContext(Dispatchers.Default) {
            if (!available) return@withContext null
            // модель ещё не в памяти — подождём загрузку (это первый вопрос), но не дольше 20 с
            if (engine == null) withTimeoutOrNull(20_000) { ensureLoaded() } ?: return@withContext null
            if (!lock.tryLock()) return@withContext null
            var handOff = false
            try {
                val llm = engine ?: return@withContext null // выгрузили, пока ждали замок
                val now = java.text.SimpleDateFormat("EEEE, d MMMM yyyy, HH:mm", java.util.Locale.forLanguageTag("ru")).format(java.util.Date())
                val system = """Ты — Джарвис, личный голосовой помощник владельца телефона. Сейчас $now.
Отвечай по-русски, коротко и по делу: одно-три предложения, разговорно, без списков, markdown и эмодзи — ответ будет озвучен голосом.
Обращайся к пользователю «сэр». Будь вежлив, с лёгкой иронией британского дворецкого.
Пиши только по-русски, кириллицей, без английских и китайских слов.
Не выдумывай факты. Только если вопрос про свежие новости, счёт матча или цены — скажи, что лучше поискать в интернете."""
                val sb = StringBuilder("<|im_start|>system\n$system<|im_end|>\n")
                // примеры задают стиль: коротко, «сэр», без воды
                sb.append("<|im_start|>user\nкак дела?<|im_end|>\n<|im_start|>assistant\nВсе системы в норме, сэр. Чем могу помочь?<|im_end|>\n")
                sb.append("<|im_start|>user\nзачем людям сон?<|im_end|>\n<|im_start|>assistant\nВо сне мозг сортирует воспоминания и восстанавливает силы, сэр. Без него падают внимание и настроение.<|im_end|>\n")
                for ((u, a) in history.takeLast(4)) sb.append("<|im_start|>user\n$u<|im_end|>\n<|im_start|>assistant\n$a<|im_end|>\n")
                sb.append("<|im_start|>user\n$text<|im_end|>\n<|im_start|>assistant\n")
                val so = LlmInferenceSession.LlmInferenceSessionOptions.builder()
                    .setTemperature(0.3f).setTopK(20).setTopP(0.9f)
                    .setPromptTemplates(
                        PromptTemplates.builder().setUserPrefix("").setUserSuffix("").setModelPrefix("").setModelSuffix("")
                            .setSystemPrefix("").setSystemSuffix("").build()
                    ).build()
                val session = LlmInferenceSession.createFromOptions(llm, so)
                session.addQueryChunk(sb.toString())
                val buf = StringBuilder()
                var emitted = 0
                var spoken = 0
                val enough = java.util.concurrent.atomic.AtomicBoolean(false)
                // делим ответ на предложения по «сырому» тексту (позиции не плывут), чистим каждое отдельно;
                // точка в конце ещё не законченного куска — не граница («36.6» придёт следующим токеном)
                fun flush(final: Boolean) {
                    val raw = buf.toString()
                    var i = emitted
                    while (i < raw.length) {
                        val ch = raw[i]
                        val boundary = (ch == '.' || ch == '!' || ch == '?' || ch == '…') &&
                            ((i + 1 < raw.length && (raw[i + 1] == ' ' || raw[i + 1] == '\n')) || (final && i + 1 >= raw.length))
                        if (boundary && i + 1 - emitted >= 12) {
                            val sentence = sanitize(raw.substring(emitted, i + 1)).trim()
                            if (sentence.isNotEmpty() && spoken < 4) { onSentence(sentence); spoken++ }
                            emitted = i + 1
                            if (spoken >= 4) enough.set(true) // для голоса хватит четырёх предложений
                        }
                        i++
                    }
                    if (final && emitted < raw.length) {
                        val rest = sanitize(raw.substring(emitted)).trim()
                        if (rest.isNotEmpty() && spoken < 4) onSentence(rest)
                        emitted = raw.length
                    }
                }
                val future = session.generateResponseAsync { partial, done ->
                    buf.append(partial)
                    flush(done)
                }
                // ждём ответ, но слушаем отмену: пользователь перебил, хватит предложений или вышло время
                val deadline = System.currentTimeMillis() + timeoutMs
                val ctx = coroutineContext
                while (!future.isDone) {
                    if (!ctx.isActive || enough.get() || System.currentTimeMillis() > deadline) break
                    Thread.sleep(40)
                }
                if (!future.isDone) {
                    runCatching { session.cancelGenerateResponseAsync() }
                    val finished = runCatching { future.get(3, TimeUnit.SECONDS); true }.getOrDefault(false)
                    if (finished) session.close()
                    else {
                        // нативная генерация ещё идёт: сессию и замок отпустим, только когда она реально закончится
                        handOff = true
                        scope.launch {
                            runCatching { future.get() }
                            runCatching { session.close() }
                            lock.unlock()
                        }
                    }
                } else {
                    runCatching { future.get() }
                    session.close()
                }
                sanitize(buf.toString()).trim().ifEmpty { null }
            } catch (e: Throwable) {
                Log.e(TAG, "converse", e)
                null
            } finally {
                if (!handOff) lock.unlock()
            }
        }

    /** Убрать служебные токены, разметку, иероглифы и «склеенные» рус-англ слова, которые иногда выдаёт маленькая модель. */
    private fun sanitize(t: String): String {
        val noTokens = t.replace(Regex("<\\|im_[a-z]+\\|>?"), "").replace(Regex("[*#_`]"), "")
            .replace(Regex("[\\u3000-\\u9fff\\uac00-\\ud7af\\uff00-\\uffef]+"), "")
        return noTokens.split(' ').filterNot { w -> w.any { it in 'а'..'я' || it in 'А'..'Я' } && w.any { it in 'a'..'z' || it in 'A'..'Z' } }
            .joinToString(" ").replace(Regex(" {2,}"), " ")
    }

    /** Понять фразу, которую не разобрали правила. Возвращает команду или null. */
    suspend fun interpret(text: String): Command? {
        if (!available) return null
        val system = """Ты — модуль понимания команд голосового помощника на телефоне. Пользователь говорит по-русски.
Определи намерение и верни ТОЛЬКО одну строку JSON без пояснений.
Возможные intent:
call {"who"} — позвонить; sms {"who","text"} — написать SMS; whatsapp {"who","text"}; telegram {"who","text"};
open_app {"app"}; web_search {"query"}; youtube {"query"}; maps {"query"}; music {"action": play|pause|next|prev};
timer {"seconds"}; reminder {"text","minutes"}; flashlight {"on": true|false}; none {} — если это не команда.
Поле who — как человек назвал адресата (например «маме», «Саше»)."""
        val examples = """Примеры:
«звякни-ка брату» → {"intent":"call","who":"брату"}
«черкани жене что я уже еду» → {"intent":"sms","who":"жене","text":"я уже еду"}
«хочу послушать что-нибудь» → {"intent":"music","action":"play"}
«как там дела в мире футбола» → {"intent":"web_search","query":"новости футбола"}
«скучно мне» → {"intent":"none"}
Фраза: «$text»"""
        val out = complete(chat(system, examples), 0.1f, 9_000) ?: return null
        val obj = extractJson(out) ?: return null
        val s = { k: String -> obj[k]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() } }
        return when (s("intent")) {
            "call" -> Command.Call(s("who"))
            "sms" -> Command.Sms(s("who"), s("text"))
            "whatsapp" -> Command.Messenger(MessengerApp.WHATSAPP, s("who"), s("text"))
            "telegram" -> Command.Messenger(MessengerApp.TELEGRAM, s("who"), s("text"))
            "open_app" -> s("app")?.let { Command.OpenApp(it) }
            "web_search" -> s("query")?.let { Command.WebSearch(it) }
            "youtube" -> Command.YouTube(s("query"))
            "maps" -> s("query")?.let { Command.Maps(it, navigate = true) }
            "music" -> when (s("action")) {
                "pause" -> Command.Music(MediaAction.PAUSE); "next" -> Command.Music(MediaAction.NEXT)
                "prev" -> Command.Music(MediaAction.PREV); else -> Command.Music(MediaAction.PLAY)
            }
            "timer" -> obj["seconds"]?.jsonPrimitive?.intOrNull?.takeIf { it > 0 }?.let { Command.Timer(it.toLong()) }
            "reminder" -> s("text")?.let { t ->
                val m = obj["minutes"]?.jsonPrimitive?.intOrNull
                Command.Reminder(t, null, m?.takeIf { it > 0 }?.let { it * 60L })
            }
            "flashlight" -> Command.Flashlight(obj["on"]?.jsonPrimitive?.contentOrNull != "false")
            else -> null
        }
    }

    /** Привести текст сообщения в порядок: пунктуация, заглавные буквы, без изменения смысла. */
    suspend fun polish(text: String, recipient: String?, greet: Boolean): String? {
        if (!available || !settings.llmPolish.value) return null
        val system = """Пользователь надиктовал голосом, что написать человеку. Преврати это в готовое сообщение от его лица прямой речью:
исправь пунктуацию и ошибки распознавания, косвенную речь сделай прямой (он/она → ты), не добавляй новых фактов, подписей и кавычек.""" +
            (if (greet) " Начни с короткого приветствия по имени адресата." else " Без приветствия.") + """
Примеры:
Адресат: мама. Текст: что я не приду → Привет, мама! Я не приду.
Адресат: Саша. Текст: чтобы он купил хлеб → Привет, Саша! Купи, пожалуйста, хлеб.
Адресат: брат. Текст: я буду через час → Привет, брат! Буду через час.
Верни только текст сообщения."""
        val user = "Адресат: ${recipient ?: "друг"}. Текст: $text"
        val out = complete(chat(system, user), 0.2f, 8_000)?.trim()?.trim('"', '«', '»')?.lines()?.firstOrNull { it.isNotBlank() }?.trim()
            ?: return null
        // защита от «фантазий» модели: результат должен быть близок к исходнику по длине
        if (out.length > text.length * 2 + 40 || out.length < text.length / 2) return null
        return out
    }

    private fun extractJson(s: String): JsonObject? {
        val start = s.indexOf('{')
        val end = s.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        return runCatching { json.parseToJsonElement(s.substring(start, end + 1)).jsonObject }.getOrNull()
    }

    companion object { private const val TAG = "LocalLlm" }
}
