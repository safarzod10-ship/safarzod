package com.safarzod.jarvis.service

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.view.accessibility.AccessibilityEvent
import androidx.core.app.NotificationCompat
import com.safarzod.jarvis.JarvisApp
import com.safarzod.jarvis.MainActivity
import com.safarzod.jarvis.R
import com.safarzod.jarvis.data.IncomingMessage
import com.safarzod.jarvis.data.MessageFeed

/** После перезагрузки: вернуть напоминания и предложить включить Джарвиса. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as JarvisApp
        app.reminders.rescheduleAll()
        if (!app.settings.onboarded.value || !app.settings.background.value || app.settings.muted.value) return
        // С Android 11 микрофон, запущенный из фона (в т.ч. после перезагрузки), не слышит ничего —
        // поэтому просим одно нажатие. На Android 8–10 можно стартовать сразу.
        if (Build.VERSION.SDK_INT >= 30) JarvisService.postTapToResume(context)
        else JarvisService.start(context)
    }
}

/** Кнопка «Выключить» в уведомлении. */
class ServiceActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            JarvisService.ACTION_STOP -> JarvisService.stop(context)
            JarvisService.ACTION_MUTE -> (context.applicationContext as JarvisApp).engine.setMuted(true)
        }
    }
}

/** Сработало напоминание. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as JarvisApp
        val id = intent.getIntExtra("id", 0)
        val text = intent.getStringExtra("text") ?: "Напоминание"
        app.reminders.remove(id)
        val pi = PendingIntent.getActivity(context, id, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, JarvisApp.CH_REMINDERS)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Джарвис напоминает")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .build()
        runCatching { context.getSystemService(NotificationManager::class.java).notify(1000 + (id % 10000), n) }
        if (JarvisService.running) app.engine.onReminder(text)
    }
}

/** Читает входящие сообщения из уведомлений мессенджеров (только в памяти телефона). */
class JarvisNotificationListener : NotificationListenerService() {

    private val messengers = mapOf(
        "org.telegram.messenger" to "Telegram", "org.telegram.messenger.web" to "Telegram", "org.thunderdog.challegram" to "Telegram X",
        "com.whatsapp" to "WhatsApp", "com.whatsapp.w4b" to "WhatsApp Business", "com.viber.voip" to "Viber",
        "com.vkontakte.android" to "ВКонтакте", "com.google.android.apps.messaging" to "Сообщения", "com.samsung.android.messaging" to "Сообщения",
        "com.android.mms" to "Сообщения", "com.discord" to "Discord", "com.instagram.android" to "Instagram", "com.facebook.orca" to "Messenger",
        "ru.oneme.app" to "MAX",
    )

    override fun onListenerConnected() { MessageFeed.listenerConnected = true }
    override fun onListenerDisconnected() { MessageFeed.listenerConnected = false }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val n = sbn.notification ?: return
        val isMsg = n.category == Notification.CATEGORY_MESSAGE || messengers.containsKey(sbn.packageName)
        if (!isMsg || sbn.packageName == packageName) return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val ex = n.extras ?: return
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim().orEmpty()
        if (title.isEmpty() || text.isEmpty()) return
        val label = messengers[sbn.packageName] ?: runCatching {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString()
        }.getOrDefault(sbn.packageName)
        MessageFeed.push(IncomingMessage(label, sbn.packageName, title, text.take(400), sbn.postTime))
    }
}

/** Служба спецвозможностей: только глобальные действия (скриншот, блокировка, назад, домой). */
class JarvisAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() { instance = this }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit
    override fun onUnbind(intent: Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onDestroy() { instance = null; super.onDestroy() }

    companion object {
        @Volatile var instance: JarvisAccessibilityService? = null
            private set
    }
}

/** Плитка в шторке: одним нажатием — «Слушаю, сэр». */
class JarvisTileService : TileService() {
    override fun onStartListening() {
        qsTile?.apply {
            state = if (JarvisService.running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            label = "Джарвис"
            updateTile()
        }
    }

    override fun onClick() {
        val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(MainActivity.EXTRA_LISTEN, true)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 9, i, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION", "StartActivityAndCollapseDeprecated")
            startActivityAndCollapse(i)
        }
    }
}
