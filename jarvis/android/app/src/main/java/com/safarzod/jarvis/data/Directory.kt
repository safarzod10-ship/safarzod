package com.safarzod.jarvis.data

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.safarzod.jarvis.nlu.Names
import com.safarzod.jarvis.nlu.Text

data class Contact(val id: Long, val name: String, val phone: String, val phoneLabel: String?, val starred: Boolean, val timesContacted: Int)

data class ContactMatch(val contact: Contact, val score: Double, val viaMemory: Boolean)

/** Поиск контактов «по-человечески»: падежи, родственные обращения, латиница ↔ кириллица, память. */
class Contacts(private val context: Context, private val memory: Memory) {

    private var cache: List<Contact>? = null
    private var cacheAt = 0L

    fun hasPermission() = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    fun all(): List<Contact> {
        if (!hasPermission()) return emptyList()
        val now = System.currentTimeMillis()
        cache?.let { if (now - cacheAt < 60_000) return it }
        val out = ArrayList<Contact>()
        val seen = HashSet<String>()
        val proj = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.TYPE,
            ContactsContract.CommonDataKinds.Phone.LABEL,
            ContactsContract.CommonDataKinds.Phone.STARRED,
            ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY,
        )
        runCatching {
            context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI, proj, null, null,
                "${ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY} DESC",
            )?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getLong(0)
                    val name = c.getString(1) ?: continue
                    val phone = c.getString(2) ?: continue
                    val digits = phone.filter { it.isDigit() }.takeLast(10)
                    if (!seen.add("$id/$digits")) continue
                    val label = ContactsContract.CommonDataKinds.Phone.getTypeLabel(context.resources, c.getInt(3), c.getString(4)).toString()
                    out += Contact(id, name, phone, label, c.getInt(5) == 1, 0)
                }
            }
        }
        cache = out
        cacheAt = now
        return out
    }

    fun invalidate() { cache = null }

    /**
     * Лучшие совпадения для фразы («маме», «саше иванову», «мом»). Сначала память, затем контакты.
     * Несколько номеров одного человека схлопываются в первый (основной).
     */
    fun find(query: String, limit: Int = 5): List<ContactMatch> {
        memory.find(query, AliasKind.CONTACT)?.let { a ->
            val c = all().firstOrNull { it.phone.filter(Char::isDigit).takeLast(10) == a.value.filter(Char::isDigit).takeLast(10) }
            return listOf(ContactMatch(c ?: Contact(-1, a.title, a.value, null, false, 0), 1.0, true))
        }
        val scored = all().map { ContactMatch(it, Names.score(query, it.name) + if (it.starred) 0.01 else 0.0, false) }
            .filter { it.score >= 0.62 }
            .sortedByDescending { it.score }
        // один человек — одна строка
        val byPerson = LinkedHashMap<Long, ContactMatch>()
        for (m in scored) if (!byPerson.containsKey(m.contact.id)) byPerson[m.contact.id] = m
        return byPerson.values.take(limit)
    }

    /** Найти контакт по тому, как он записан (для команды «мама — это Mom»). */
    fun findByName(name: String, limit: Int = 5): List<ContactMatch> {
        val q = Text.normalize(name)
        val scored = all().map { c ->
            val n = Text.normalize(c.name)
            val s = when {
                n == q -> 1.0
                Text.latin(n) == Text.latin(q) -> 0.97
                n.startsWith(q) -> 0.9
                else -> maxOf(Names.score(q, c.name), Text.similarity(Text.latin(n), Text.latin(q)) * 0.9)
            }
            ContactMatch(c, s, false)
        }.filter { it.score >= 0.6 }.sortedByDescending { it.score }
        val byPerson = LinkedHashMap<Long, ContactMatch>()
        for (m in scored) if (!byPerson.containsKey(m.contact.id)) byPerson[m.contact.id] = m
        return byPerson.values.take(limit)
    }
}

data class AppInfo(val label: String, val pkg: String)

/** Установленные приложения и поиск по названию на слух. */
class Apps(private val context: Context, private val memory: Memory) {

    private var cache: List<AppInfo>? = null

    /** Как приложения обычно называют вслух. */
    private val spoken = mapOf(
        "телеграм" to "org.telegram.messenger", "телеграмм" to "org.telegram.messenger", "телега" to "org.telegram.messenger", "телегу" to "org.telegram.messenger", "тг" to "org.telegram.messenger",
        "ватсап" to "com.whatsapp", "вотсап" to "com.whatsapp", "вацап" to "com.whatsapp", "ватцап" to "com.whatsapp",
        "инстаграм" to "com.instagram.android", "инсту" to "com.instagram.android", "инста" to "com.instagram.android", "инстаграмм" to "com.instagram.android",
        "ютуб" to "com.google.android.youtube", "тикток" to "com.zhiliaoapp.musically", "тик ток" to "com.zhiliaoapp.musically",
        "вк" to "com.vkontakte.android", "вконтакте" to "com.vkontakte.android", "в контакте" to "com.vkontakte.android",
        "хром" to "com.android.chrome", "гугл" to "com.google.android.googlequicksearchbox", "карты" to "com.google.android.apps.maps",
        "гугл карты" to "com.google.android.apps.maps", "яндекс карты" to "ru.yandex.yandexmaps", "навигатор" to "ru.yandex.yandexnavi",
        "яндекс" to "com.yandex.browser", "такси" to "ru.yandex.taxi", "яндекс го" to "ru.yandex.taxi", "спотифай" to "com.spotify.music",
        "яндекс музыку" to "ru.yandex.music", "яндекс музыка" to "ru.yandex.music", "вайбер" to "com.viber.voip", "дискорд" to "com.discord",
        "сбер" to "ru.sberbankmobile", "сбербанк" to "ru.sberbankmobile", "тинькофф" to "com.idamob.tinkoff.android", "т банк" to "com.idamob.tinkoff.android",
        "почту" to "com.google.android.gm", "почта" to "com.google.android.gm", "джимейл" to "com.google.android.gm", "гмейл" to "com.google.android.gm",
        "плей маркет" to "com.android.vending", "плеймаркет" to "com.android.vending", "магазин" to "com.android.vending", "гугл плей" to "com.android.vending",
        "нетфликс" to "com.netflix.mediaclient", "твич" to "tv.twitch.android.app", "озон" to "ru.ozon.app.android", "вайлдберриз" to "com.wildberries.ru",
        "авито" to "com.avito.android", "кинопоиск" to "ru.kinopoisk", "переводчик" to "com.google.android.apps.translate",
    )

    /** Категории: «часы/будильник», «калькулятор», «камера» и т.п. — ищем по типичным пакетам и словам. */
    private val category = mapOf(
        "будильник" to listOf("clock", "deskclock", "alarm", "часы"),
        "часы" to listOf("clock", "deskclock", "часы"),
        "калькулятор" to listOf("calculator", "calc", "калькулятор"),
        "камеру" to listOf("camera", "камера"), "камера" to listOf("camera", "камера"),
        "галерею" to listOf("gallery", "photos", "галерея", "фото"), "галерея" to listOf("gallery", "photos", "галерея", "фото"),
        "фото" to listOf("photos", "gallery", "фото"),
        "контакты" to listOf("contacts", "контакты"), "телефон" to listOf("dialer", "phone", "телефон"),
        "сообщения" to listOf("messaging", "mms", "сообщения"), "смс" to listOf("messaging", "mms", "сообщения"),
        "календарь" to listOf("calendar", "календарь"), "заметки" to listOf("notes", "keep", "заметки"),
        "браузер" to listOf("browser", "chrome", "браузер"), "музыку" to listOf("music", "музыка"), "музыка" to listOf("music", "музыка"),
        "файлы" to listOf("files", "documents", "файлы", "проводник"), "проводник" to listOf("files", "проводник"),
        "настройки" to listOf("settings", "настройки"), "погоду" to listOf("weather", "погода"), "погода" to listOf("weather", "погода"),
        "диктофон" to listOf("recorder", "soundrecorder", "диктофон"), "компас" to listOf("compass", "компас"),
    )

    fun all(): List<AppInfo> {
        cache?.let { return it }
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val list = pm.queryIntentActivities(intent, 0).map {
            AppInfo(it.loadLabel(pm).toString(), it.activityInfo.packageName)
        }.distinctBy { it.pkg }.filter { it.pkg != context.packageName }
        cache = list
        return list
    }

    fun invalidate() { cache = null }

    fun find(spokenName: String): AppInfo? {
        val q = Text.normalize(spokenName).removePrefix("приложение ").trim()
        if (q.isEmpty()) return null
        val apps = all()
        memory.find(q, AliasKind.APP)?.let { a -> apps.firstOrNull { it.pkg == a.value }?.let { return it } }
        spoken[q]?.let { pkg -> apps.firstOrNull { it.pkg == pkg }?.let { return it } }
        val norm = apps.map { it to Text.normalize(it.label) }
        norm.firstOrNull { it.second == q }?.let { return it.first }
        category[q]?.let { keys ->
            norm.firstOrNull { (a, l) -> keys.any { k -> a.pkg.contains(k) || l.contains(k) } }?.let { return it.first }
        }
        // фонетика: «спотифай» ~ «Spotify», «нетфликс» ~ «Netflix»
        val lq = Text.latin(q)
        val best = norm.map { (a, l) ->
            val ll = Text.latin(l)
            val s = when {
                l.startsWith(q) || ll.startsWith(lq) -> 0.9
                l.contains(q) -> 0.8
                else -> Text.similarity(lq, ll)
            }
            a to s
        }.maxByOrNull { it.second }
        return best?.takeIf { it.second >= 0.7 }?.first
    }

    fun launchIntent(app: AppInfo): Intent? = context.packageManager.getLaunchIntentForPackage(app.pkg)
        ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
}
