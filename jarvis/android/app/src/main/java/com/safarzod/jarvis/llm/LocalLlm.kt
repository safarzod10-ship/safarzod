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
        unload()
        dir.listFiles()?.forEach { it.delete() }
        settings.llmModel.value = ""
        _status.value = Status.None
    }

    fun unload() {
        runCatching { engine?.close() }
        engine = null
        if (_status.value is Status.Ready) refresh()
    }

    // ---------------- работа ----------------

    private suspend fun ensureLoaded(): LlmInference? = lock.withLock {
        engine?.let { return it }
        val f = installedFile() ?: return null
        _status.value = Status.Loading
        return try {
            val opts = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(f.absolutePath)
                .setMaxTokens(640)
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

    private suspend fun complete(user: String, temperature: Float, timeoutMs: Long): String? = withContext(Dispatchers.Default) {
        val llm = ensureLoaded() ?: return@withContext null
        withTimeoutOrNull(timeoutMs) {
            lock.withLock {
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
                    LlmInferenceSession.createFromOptions(llm, so).use { s ->
                        s.addQueryChunk(user)
                        s.generateResponse()
                    }
                }.onFailure { Log.e(TAG, "generate", it) }.getOrNull()
            }
        }
    }

    private fun chat(system: String, user: String) =
        "<|im_start|>system\n$system<|im_end|>\n<|im_start|>user\n$user<|im_end|>\n<|im_start|>assistant\n"

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
    suspend fun polish(text: String, recipient: String?): String? {
        if (!available || !settings.llmPolish.value) return null
        val system = """Ты редактируешь короткое сообщение, надиктованное голосом. Исправь пунктуацию, заглавные буквы и явные ошибки распознавания речи.
Не меняй смысл, не добавляй новых фактов, не добавляй приветствий и подписей, не используй кавычки. Пиши от первого лица, как написал бы сам человек.
Верни только исправленный текст сообщения."""
        val user = (if (recipient != null) "Адресат: $recipient\n" else "") + "Текст: $text"
        val out = complete(chat(system, user), 0.2f, 8_000)?.trim()?.trim('"', '«', '»')?.lines()?.firstOrNull { it.isNotBlank() }?.trim()
            ?: return null
        // защита от «фантазий» модели: результат должен быть близок к исходнику по длине
        if (out.length > text.length * 2 + 20 || out.length < text.length / 2) return null
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
