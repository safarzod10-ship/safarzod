package com.safarzod.jarvis.data

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.safarzod.jarvis.service.ReminderReceiver
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File

@Serializable
data class Reminder(val id: Int, val text: String, val at: Long, val createdAt: Long = System.currentTimeMillis())

/** Напоминания: хранятся локально и ставятся в AlarmManager (переживают перезагрузку). */
class Reminders(private val context: Context) {
    private val file = File(context.filesDir, "reminders.json")
    private val json = Json { ignoreUnknownKeys = true }
    private val _items = MutableStateFlow(load())
    val items: StateFlow<List<Reminder>> = _items

    private fun load(): List<Reminder> = runCatching {
        json.decodeFromString(ListSerializer(Reminder.serializer()), file.readText())
    }.getOrDefault(emptyList())

    private fun save(list: List<Reminder>) {
        _items.value = list.sortedBy { it.at }
        runCatching { file.writeText(json.encodeToString(ListSerializer(Reminder.serializer()), _items.value)) }
    }

    fun add(text: String, at: Long): Reminder {
        val id = ((System.currentTimeMillis() / 1000) % Int.MAX_VALUE).toInt()
        val r = Reminder(id, text, at)
        save(_items.value + r)
        schedule(r)
        return r
    }

    fun remove(id: Int) {
        _items.value.firstOrNull { it.id == id }?.let { cancel(it) }
        save(_items.value.filterNot { it.id == id })
    }

    fun get(id: Int) = _items.value.firstOrNull { it.id == id }

    /** После перезагрузки: заново поставить будущие, просроченные — показать сразу. */
    fun rescheduleAll() {
        val now = System.currentTimeMillis()
        for (r in _items.value) schedule(if (r.at < now) r.copy(at = now + 5_000) else r)
    }

    private fun pi(r: Reminder): PendingIntent = PendingIntent.getBroadcast(
        context, r.id,
        Intent(context, ReminderReceiver::class.java).putExtra("id", r.id).putExtra("text", r.text),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun schedule(r: Reminder) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        runCatching {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi(r))
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi(r))
        }
    }

    private fun cancel(r: Reminder) {
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pi(r))
    }
}

/** Входящее сообщение из уведомления мессенджера/SMS. */
data class IncomingMessage(val app: String, val pkg: String, val sender: String, val text: String, val time: Long)

/** Последние сообщения из уведомлений (только в памяти, нигде не сохраняются). */
object MessageFeed {
    private val _items = MutableStateFlow<List<IncomingMessage>>(emptyList())
    val items: StateFlow<List<IncomingMessage>> = _items
    private val _incoming = MutableSharedFlow<IncomingMessage>(extraBufferCapacity = 8)
    val incoming: SharedFlow<IncomingMessage> = _incoming

    @Volatile var listenerConnected = false

    fun push(m: IncomingMessage) {
        val dup = _items.value.firstOrNull { it.pkg == m.pkg && it.sender == m.sender && it.text == m.text }
        if (dup != null) return
        _items.value = (listOf(m) + _items.value).take(30)
        _incoming.tryEmit(m)
    }

    fun clear() { _items.value = emptyList() }
}

/** Журнал диалога за сессию. */
data class Turn(val user: String?, val jarvis: String?, val time: Long = System.currentTimeMillis())

object History {
    private val _turns = MutableStateFlow<List<Turn>>(emptyList())
    val turns: StateFlow<List<Turn>> = _turns
    fun add(t: Turn) { _turns.value = (_turns.value + t).takeLast(200) }
    fun clear() { _turns.value = emptyList() }
}
