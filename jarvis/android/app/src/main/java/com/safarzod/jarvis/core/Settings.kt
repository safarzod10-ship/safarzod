package com.safarzod.jarvis.core

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class CoreStyle(val title: String, val subtitle: String) {
    PLASMA("Плазма", "Энергетическая сфера с орбитами"),
    NEURO("Нейросфера", "Облако частиц, живущее от голоса"),
}

enum class Quality(val title: String, val scale: Float, val plasmaSteps: Int, val particles: Int) {
    ECO("Экономия", 0.45f, 14, 4500),
    BALANCED("Баланс", 0.62f, 20, 7000),
    ULTRA("Максимум", 0.85f, 28, 11000),
}

enum class SearchEngine(val title: String, val url: String) {
    GOOGLE("Google", "https://www.google.com/search?q="),
    YANDEX("Яндекс", "https://yandex.ru/search/?text="),
}

enum class Accent(val title: String, val argb: Long) {
    CYAN("Лёд", 0xFF5BE3FF),
    GOLD("Золото", 0xFFFFC56B),
    VIOLET("Аметист", 0xFFB69CFF),
    EMERALD("Изумруд", 0xFF5CFFB4),
    CRIMSON("Рубин", 0xFFFF6B7A),
}

/** Все настройки в одном месте. Хранятся в SharedPreferences, наружу — как StateFlow. */
class Settings(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("jarvis", Context.MODE_PRIVATE)

    private fun bool(key: String, def: Boolean) = Pref(key, def, { prefs.getBoolean(key, def) }, { prefs.edit().putBoolean(key, it).apply() })
    private fun float(key: String, def: Float) = Pref(key, def, { prefs.getFloat(key, def) }, { prefs.edit().putFloat(key, it).apply() })
    private fun string(key: String, def: String) = Pref(key, def, { prefs.getString(key, def) ?: def }, { prefs.edit().putString(key, it).apply() })
    private inline fun <reified E : Enum<E>> enum(key: String, def: E) = Pref(
        key, def,
        { runCatching { enumValueOf<E>(prefs.getString(key, def.name)!!) }.getOrDefault(def) },
        { prefs.edit().putString(key, it.name).apply() },
    )

    val onboarded = bool("onboarded", false)
    /** Кнопка «Стоп»: Джарвис полностью молчит и не слушает, пока его не включат. */
    val muted = bool("muted", false)
    val wakeWord = bool("wake_word", true)
    val background = bool("background", true)
    val coreStyle = enum("core_style", CoreStyle.PLASMA)
    val quality = enum("quality", Quality.BALANCED)
    val accent = enum("accent", Accent.CYAN)
    val voiceVolume = float("voice_volume", 1.0f)
    val uiSounds = bool("ui_sounds", true)
    val haptics = bool("haptics", true)
    val greetings = bool("greetings", true)
    val confirmCalls = bool("confirm_calls", false)
    val confirmSms = bool("confirm_sms", true)
    val messageGreeting = bool("message_greeting", true)
    val homeCity = string("home_city", "")
    // настройка голоса владельца
    val calibrated = bool("calibrated", false)
    val wakeVariants = string("wake_variants", "")
    val voiceprint = string("voiceprint", "")
    val ownerOnly = bool("owner_only", false)
    val ownerThreshold = float("owner_threshold", 0.45f)
    val speechLevel = float("speech_level", 0f)
    val announceMessages = bool("announce_messages", true)
    val searchEngine = enum("search_engine", SearchEngine.GOOGLE)
    val sensitivity = float("sensitivity", 0.5f)
    val voiceSynth = bool("voice_synth", true)
    val speakDetails = bool("speak_details", true)
    val llmEnabled = bool("llm_enabled", true)
    // правила составляют сообщения надёжнее маленькой нейросети; переписывание — по желанию
    val llmPolish = bool("llm_polish", false)
    val llmModel = string("llm_model", "")
    val lastGreetingDay = string("last_greeting", "")
    val lastActiveAt = string("last_active", "0")

    class Pref<T>(val key: String, val default: T, private val read: () -> T, private val write: (T) -> Unit) {
        private val state = MutableStateFlow(read())
        val flow: StateFlow<T> = state.asStateFlow()
        var value: T
            get() = state.value
            set(v) { write(v); state.value = v }
    }
}
