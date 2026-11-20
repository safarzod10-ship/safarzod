package com.safarzod.jarvis.nlu

/** Всё, что Джарвис умеет понять. */
sealed interface Command {
    // --- связь ---
    data class Call(val who: String?) : Command
    data class CallNumber(val digits: String) : Command
    data class Sms(val who: String?, val text: String?) : Command
    data class Messenger(val app: MessengerApp, val who: String?, val text: String?) : Command
    data object AnswerCall : Command
    data object RejectCall : Command
    data object EndCall : Command
    data object ReadMessages : Command

    // --- приложения и интернет ---
    data class OpenApp(val name: String) : Command
    data object GoHome : Command
    data object GoBack : Command
    data class WebSearch(val query: String) : Command
    data class Weather(val place: String?) : Command
    data class YouTube(val query: String?) : Command
    data class Movie(val title: String) : Command
    data class Maps(val query: String, val navigate: Boolean) : Command
    data object News : Command

    // --- телефон ---
    data class Music(val action: MediaAction) : Command
    data class Volume(val action: VolumeAction) : Command
    data class Flashlight(val on: Boolean) : Command
    data class Panel(val kind: PanelKind) : Command
    data object Camera : Command
    data object Selfie : Command
    data object Screenshot : Command
    data object LockScreen : Command

    // --- время ---
    data class Alarm(val hour: Int, val minute: Int, val dayOffset: Int) : Command
    data class AlarmIn(val seconds: Long) : Command
    data object AlarmMissingTime : Command
    data class Timer(val seconds: Long) : Command
    data object TimerMissingTime : Command
    data class Reminder(val text: String, val atMillis: Long?, val inSeconds: Long?) : Command
    data object ShowTime : Command
    data object ShowDate : Command
    data object ShowBattery : Command
    data class Calculate(val expression: String, val result: Double) : Command

    // --- память ---
    data class Remember(val alias: String, val target: String) : Command
    data class Forget(val alias: String) : Command
    data object ShowMemory : Command

    // --- разговор ---
    data object Wake : Command
    data object Hello : Command
    data object Thanks : Command
    data object Praise : Command
    data object Insult : Command
    data object HowAreYou : Command
    data object WhoAreYou : Command
    data object Help : Command
    data object Joke : Command
    data object Fact : Command
    data object Bye : Command
    data object GoodNight : Command
    data object Cancel : Command
    data object Yes : Command
    data object No : Command
    data object Repeat : Command
    data class Choose(val index: Int) : Command
    data object StopListening : Command

    /** Вопрос «что/кто/почему/как…» — отвечает нейросеть (если есть), иначе поиск в интернете. */
    data class Question(val text: String) : Command
    data class Unknown(val text: String) : Command
}

enum class MessengerApp(val title: String, val pkg: String) {
    WHATSAPP("WhatsApp", "com.whatsapp"),
    TELEGRAM("Telegram", "org.telegram.messenger"),
    VIBER("Viber", "com.viber.voip"),
}

enum class MediaAction { PLAY, PAUSE, NEXT, PREV }
enum class VolumeAction { UP, DOWN, MAX, MUTE, UNMUTE, SILENT }
enum class PanelKind { WIFI, BLUETOOTH, INTERNET, SETTINGS, NFC, LOCATION, BATTERY, DISPLAY, SOUND }
