package com.safarzod.jarvis

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.provider.Settings as AndroidSettings
import androidx.core.app.NotificationCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.safarzod.jarvis.actions.Actions
import com.safarzod.jarvis.core.Engine
import com.safarzod.jarvis.core.Settings
import com.safarzod.jarvis.data.Apps
import com.safarzod.jarvis.data.Contacts
import com.safarzod.jarvis.data.Memory
import com.safarzod.jarvis.data.Reminders
import com.safarzod.jarvis.llm.LocalLlm
import com.safarzod.jarvis.voice.SpeechEngine
import com.safarzod.jarvis.voice.VoiceBank
import com.safarzod.jarvis.voice.VoicePlayer

class JarvisApp : Application() {

    lateinit var settings: Settings private set
    lateinit var engine: Engine private set
    lateinit var llm: LocalLlm private set
    lateinit var reminders: Reminders private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        settings = Settings(this)
        createChannels()
        val memory = Memory(this)
        val actions = Actions(this)
        reminders = Reminders(this)
        llm = LocalLlm(this, settings)
        engine = Engine(
            context = this,
            settings = settings,
            voice = VoiceBank(this),
            player = VoicePlayer(this),
            speech = SpeechEngine(this),
            memory = memory,
            contacts = Contacts(this, memory),
            apps = Apps(this, memory),
            actions = actions,
            reminders = reminders,
            llm = llm,
        )
        actions.canLaunch = { engine.appVisible.value || AndroidSettings.canDrawOverlays(this) || com.safarzod.jarvis.service.JarvisAccessibilityService.instance != null }
        actions.onBlocked = { intent -> postTapToOpen(intent) }

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { engine.appVisible.value = true }
            override fun onStop(owner: LifecycleOwner) { engine.appVisible.value = false }
        })
    }

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_SERVICE, "Джарвис на связи", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Постоянное уведомление, пока Джарвис слушает слово «Джарвис»"
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CH_REMINDERS, "Напоминания", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Напоминания, которые вы попросили создать"
            enableVibration(true)
        })
        nm.createNotificationChannel(NotificationChannel(CH_ACTIONS, "Действия", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Когда Android не даёт открыть приложение из фона — нажмите, чтобы открыть"
        })
    }

    /** Android запретил открыть окно из фона — показываем уведомление, по нажатию откроется. */
    private fun postTapToOpen(intent: Intent) {
        val pi = PendingIntent.getActivity(this, 7001, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, CH_ACTIONS)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Джарвис")
            .setContentText("Нажмите, чтобы открыть")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setTimeoutAfter(60_000)
            .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(7001, n) }
    }

    companion object {
        lateinit var instance: JarvisApp private set
        const val CH_SERVICE = "service"
        const val CH_REMINDERS = "reminders"
        const val CH_ACTIONS = "actions"
    }
}
