package com.safarzod.jarvis.voice

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID
import kotlin.math.abs
import kotlin.math.sin
import kotlin.random.Random

/** Одна запись голоса Джарвиса. */
data class Clip(
    val id: String,
    val event: String,
    val text: String,
    val builtin: Boolean,
    val path: String,          // для встроенных — путь в assets, для своих — абсолютный путь файла
    val durationMs: Int,
    val env: ByteArray,        // огибающая громкости 0..255
    val envFps: Int,
) {
    fun levelAt(ms: Long): Float {
        if (env.isEmpty()) return 0f
        val f = ms / 1000f * envFps
        val i = f.toInt().coerceIn(0, env.size - 1)
        val j = (i + 1).coerceAtMost(env.size - 1)
        val t = f - i
        val a = (env[i].toInt() and 0xFF) / 255f
        val b = (env[j].toInt() and 0xFF) / 255f
        return a + (b - a) * t
    }
}

@Serializable
private data class ManifestClip(val id: String, val event: String, val text: String, val file: String, val durationMs: Int, val envFps: Int, val env: String)

@Serializable
private data class Manifest(val clips: List<ManifestClip>)

@Serializable
private data class UserClip(val id: String, val event: String, val text: String, val file: String, val durationMs: Int)

/**
 * Банк голосовых записей: встроенные (assets/voice) + добавленные пользователем.
 * Выбирает случайный вариант, не повторяя предыдущий.
 */
class VoiceBank(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val userDir = File(context.filesDir, "voice_user").apply { mkdirs() }
    private val userIndex = File(userDir, "index.json")

    private var builtin: Map<String, List<Clip>> = emptyMap()
    private val _user = MutableStateFlow<List<Clip>>(emptyList())
    val user: StateFlow<List<Clip>> = _user

    private val lastPlayed = HashMap<String, String>()

    init {
        loadBuiltin()
        loadUser()
    }

    private fun loadBuiltin() {
        val text = context.assets.open("voice/manifest.json").bufferedReader().use { it.readText() }
        val m = json.decodeFromString(Manifest.serializer(), text)
        builtin = m.clips.map {
            Clip(it.id, it.event, it.text, true, it.file, it.durationMs, Base64.decode(it.env, Base64.DEFAULT), it.envFps)
        }.groupBy { it.event }
    }

    private fun loadUser() {
        val list = runCatching {
            json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(UserClip.serializer()), userIndex.readText())
        }.getOrDefault(emptyList())
        _user.value = list.mapNotNull { u ->
            val f = File(userDir, u.file)
            if (!f.exists()) null else Clip(u.id, u.event, u.text, false, f.absolutePath, u.durationMs, syntheticEnvelope(u.durationMs, u.id.hashCode()), 50)
        }
    }

    private fun saveUser() {
        val list = _user.value.map { UserClip(it.id, it.event, it.text, File(it.path).name, it.durationMs) }
        userIndex.writeText(json.encodeToString(kotlinx.serialization.builtins.ListSerializer(UserClip.serializer()), list))
    }

    fun clipsFor(event: String): List<Clip> = _user.value.filter { it.event == event } + (builtin[event] ?: emptyList())

    fun builtinCount(event: String) = builtin[event]?.size ?: 0

    /** Подходящая запись для ситуации (с учётом запасных) или null. */
    fun pick(ev: Ev): Clip? {
        val chain = listOf(ev.key) + ev.fallback
        for (key in chain) {
            val list = clipsFor(key)
            if (list.isEmpty()) continue
            val last = lastPlayed[key]
            val pool = if (list.size > 1) list.filter { it.id != last } else list
            val c = pool[Random.nextInt(pool.size)]
            lastPlayed[key] = c.id
            return c
        }
        return null
    }

    /** Добавить свою запись из выбранного файла. */
    fun addUserClip(event: String, uri: Uri, text: String): Result<Clip> = runCatching {
        val ext = context.contentResolver.getType(uri)?.substringAfter('/')?.let {
            when (it) { "mpeg" -> "mp3"; "x-wav", "wav" -> "wav"; "ogg" -> "ogg"; "mp4", "x-m4a", "m4a", "aac" -> "m4a"; else -> "audio" }
        } ?: "audio"
        val id = "user_" + UUID.randomUUID().toString().take(8)
        val dst = File(userDir, "$id.$ext")
        context.contentResolver.openInputStream(uri)!!.use { input -> dst.outputStream().use { input.copyTo(it) } }
        val dur = MediaMetadataRetriever().run {
            try {
                setDataSource(dst.absolutePath)
                extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toIntOrNull() ?: 0
            } finally { release() }
        }
        require(dur in 150..60_000) { dst.delete(); "Файл не похож на аудиозапись" }
        val clip = Clip(id, event, text, false, dst.absolutePath, dur, syntheticEnvelope(dur, id.hashCode()), 50)
        _user.value = _user.value + clip
        saveUser()
        clip
    }

    fun removeUserClip(id: String) {
        val c = _user.value.firstOrNull { it.id == id } ?: return
        File(c.path).delete()
        _user.value = _user.value.filter { it.id != id }
        saveUser()
    }

    /** Огибающая «речевого» вида для своих записей: слоги с паузами. */
    private fun syntheticEnvelope(durationMs: Int, seed: Int): ByteArray {
        val n = (durationMs / 20).coerceAtLeast(1)
        val r = Random(seed)
        val out = ByteArray(n)
        var phase = r.nextFloat() * 6f
        for (i in 0 until n) {
            val t = i / 50f
            phase += 0.33f + r.nextFloat() * 0.12f
            val syll = abs(sin(phase)).toFloat()
            val edge = (minOf(i, n - 1 - i) / 6f).coerceAtMost(1f)
            val v = (0.35f + 0.65f * syll) * edge * (0.85f + 0.15f * sin(t * 3f))
            out[i] = (v.coerceIn(0f, 1f) * 255).toInt().toByte()
        }
        return out
    }
}
