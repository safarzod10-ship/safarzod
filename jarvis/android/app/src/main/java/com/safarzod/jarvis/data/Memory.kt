package com.safarzod.jarvis.data

import android.content.Context
import com.safarzod.jarvis.nlu.Names
import com.safarzod.jarvis.nlu.Text
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File

@Serializable
enum class AliasKind { CONTACT, APP }

/**
 * Запись памяти: «мама» → контакт «Mom» (+номер), или «телега» → приложение Telegram.
 * [alias] хранится в начальной форме («мама», а не «маме»).
 */
@Serializable
data class Alias(
    val alias: String,
    val kind: AliasKind,
    val title: String,          // как записано в контактах / название приложения
    val value: String,          // номер телефона / имя пакета
    val createdAt: Long = System.currentTimeMillis(),
    val uses: Int = 0,
)

/** Память Джарвиса. Хранится локально в JSON, никуда не отправляется. */
class Memory(context: Context) {
    private val file = File(context.filesDir, "memory.json")
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val _items = MutableStateFlow(load())
    val items: StateFlow<List<Alias>> = _items

    private fun load(): List<Alias> = runCatching {
        json.decodeFromString(ListSerializer(Alias.serializer()), file.readText())
    }.getOrDefault(emptyList())

    private fun save(list: List<Alias>) {
        _items.value = list.sortedBy { it.alias }
        runCatching {
            val tmp = File(file.parentFile, "memory.json.tmp")
            tmp.writeText(json.encodeToString(ListSerializer(Alias.serializer()), _items.value))
            tmp.renameTo(file)
        }
    }

    /** Нормальная форма обращения: «маме» → «мама», «Саше Иванову» → «саша иванову» (по первому слову). */
    fun key(alias: String): String {
        val ws = Text.normalize(alias).split(' ').filter { it.isNotEmpty() }
        if (ws.isEmpty()) return ""
        return (listOf(Names.lemmas(ws[0]).first()) + ws.drop(1)).joinToString(" ")
    }

    fun put(alias: String, kind: AliasKind, title: String, value: String): Alias {
        val k = key(alias)
        val a = Alias(k, kind, title, value)
        save(_items.value.filterNot { it.alias == k && it.kind == kind } + a)
        return a
    }

    /** Найти запись по фразе в любом падеже. */
    fun find(phrase: String, kind: AliasKind): Alias? {
        val norm = Text.normalize(phrase)
        if (norm.isEmpty()) return null
        val list = _items.value.filter { it.kind == kind }
        list.firstOrNull { it.alias == norm }?.let { return it }
        val ws = norm.split(' ')
        val variants = Names.lemmas(ws[0]).map { (listOf(it) + ws.drop(1)).joinToString(" ") }
        for (v in variants) list.firstOrNull { it.alias == v }?.let { return it }
        // небольшая опечатка распознавания: «мамы» ~ «мама»
        return list.firstOrNull { a -> variants.any { Text.similarity(it, a.alias) >= 0.84 } }
    }

    fun touch(a: Alias) {
        save(_items.value.map { if (it.alias == a.alias && it.kind == a.kind) it.copy(uses = it.uses + 1) else it })
    }

    fun remove(phrase: String): Alias? {
        val a = find(phrase, AliasKind.CONTACT) ?: find(phrase, AliasKind.APP) ?: return null
        save(_items.value.filterNot { it.alias == a.alias && it.kind == a.kind })
        return a
    }

    fun removeExact(a: Alias) = save(_items.value.filterNot { it.alias == a.alias && it.kind == a.kind })
}
