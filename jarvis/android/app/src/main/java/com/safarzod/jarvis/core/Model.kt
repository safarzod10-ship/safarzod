package com.safarzod.jarvis.core

import com.safarzod.jarvis.data.Alias
import com.safarzod.jarvis.data.ContactMatch
import com.safarzod.jarvis.data.IncomingMessage
import com.safarzod.jarvis.nlu.MessengerApp

enum class Phase { OFF, LOADING, STANDBY, LISTENING, THINKING, SPEAKING }

enum class CardIcon {
    CLOCK, CALENDAR, BATTERY, CALC, PHONE, MESSAGE, APP, SEARCH, WEATHER, YOUTUBE, MAP, MUSIC, VOLUME,
    FLASH, SETTINGS, CAMERA, MEMORY, TIMER, ALARM, REMINDER, LOCK, INFO, ERROR, MIC, NEURAL
}

enum class Need { CONTACTS, CALLS, SMS, MIC, NOTIFICATIONS, OVERLAY, ACCESSIBILITY, LISTENER, EXACT_ALARMS }

/** То, что показывается под ядром как карточка-результат. */
sealed interface Card {
    data class ContactChoice(val query: String, val matches: List<ContactMatch>) : Card
    data class SmsDraft(val name: String, val number: String, val text: String, val via: MessengerApp?, val polished: Boolean) : Card
    data class Big(val label: String, val value: String, val sub: String?, val icon: CardIcon) : Card
    data class Remembered(val alias: Alias) : Card
    data class ReminderSet(val text: String, val at: Long) : Card
    data class ReminderPickTime(val text: String) : Card
    data class TimerSet(val seconds: Long, val endsAt: Long) : Card
    data class AlarmSet(val hour: Int, val minute: Int, val dayOffset: Int) : Card
    data class Messages(val items: List<IncomingMessage>) : Card
    data class Info(val title: String, val body: String, val icon: CardIcon) : Card
    data class Permission(val title: String, val body: String, val need: Need) : Card
    data class Calling(val name: String, val number: String, val label: String?) : Card
    data class Opened(val title: String, val subtitle: String?, val icon: CardIcon) : Card
    data class Offer(val title: String, val body: String, val button: String, val query: String) : Card
    data object Help : Card
}

/** Состояние экрана. */
data class UiState(
    val phase: Phase = Phase.OFF,
    val partial: String = "",
    val userText: String? = null,
    val reply: String? = null,
    val card: Card? = null,
    val awaiting: Boolean = false,
    val notice: String? = null,
    val micReady: Boolean = false,
)

/** Нажатия на карточки. */
sealed interface UiAction {
    data class PickContact(val index: Int) : UiAction
    data object SendDraft : UiAction
    data class EditDraft(val text: String) : UiAction
    data class RemindAt(val millis: Long) : UiAction
    data class Search(val query: String) : UiAction
    data object Cancel : UiAction
    data object Dismiss : UiAction
}

/** Разовые события для экрана. */
sealed interface UiEvent {
    data class Open(val screen: String) : UiEvent
    data class RequestNeed(val need: Need) : UiEvent
}
