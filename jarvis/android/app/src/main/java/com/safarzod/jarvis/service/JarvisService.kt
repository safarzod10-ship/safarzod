package com.safarzod.jarvis.service

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.safarzod.jarvis.JarvisApp
import com.safarzod.jarvis.MainActivity
import com.safarzod.jarvis.R
import com.safarzod.jarvis.core.Phase
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Фоновая служба: держит микрофон и распознавание, пока Джарвис «на связи».
 * Android требует постоянное уведомление — в нём кнопки «Слушать» и «Выключить».
 */
class JarvisService : LifecycleService() {

    private val app get() = application as JarvisApp
    private var telephonyCallback: Any? = null
    private var booted = false

    override fun onCreate() {
        super.onCreate()
        running = true
        startForegroundCompat(buildNotification(Phase.LOADING))
        lifecycleScope.launch {
            app.engine.ui.map { it.phase }.distinctUntilChanged().collect { phase ->
                runCatching {
                    androidx.core.app.NotificationManagerCompat.from(this@JarvisService).notify(NOTIF_ID, buildNotification(phase))
                }
            }
        }
        listenCalls()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
            ACTION_LISTEN -> app.engine.onMicTap()
            ACTION_REFRESH -> listenCalls()
        }
        // Система перезапустила службу сама (intent == null). С Android 11 микрофон из фона в таком случае
        // глухой — честно просим одно нажатие вместо того, чтобы «слушать» тишину.
        if (intent == null && Build.VERSION.SDK_INT >= 30 && !app.engine.appVisible.value) {
            postTapToResume(this)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!booted) {
            booted = true
            val greet = intent?.getBooleanExtra(EXTRA_GREET, false) == true
            lifecycleScope.launch { app.engine.boot(greet) }
        }
        return START_STICKY
    }

    private fun startForegroundCompat(n: Notification) {
        val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, n, type)
        } catch (e: Exception) {
            // Android 14+: микрофонную службу нельзя запустить из фона — тихо выходим
            stopSelf()
        }
    }

    private fun buildNotification(phase: Phase): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val listen = PendingIntent.getService(this, 1, Intent(this, JarvisService::class.java).setAction(ACTION_LISTEN), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getBroadcast(this, 2, Intent(this, ServiceActionReceiver::class.java).setAction(ACTION_MUTE), PendingIntent.FLAG_IMMUTABLE)
        val text = when (phase) {
            Phase.LOADING -> "Загружаю распознавание речи…"
            Phase.LISTENING -> "Слушаю вас…"
            Phase.THINKING -> "Обрабатываю…"
            Phase.SPEAKING -> "Отвечаю"
            else -> if (app.settings.wakeWord.value) "Скажите «Джарвис»" else "Нажмите «Слушать»"
        }
        return NotificationCompat.Builder(this, JarvisApp.CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Джарвис на связи")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setColor(0xFF5BE3FF.toInt())
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, "Слушать", listen)
            .addAction(0, "Стоп", stop)
            .build()
    }

    /** Во время телефонного разговора микрофон отдаём звонку. */
    private fun listenCalls() {
        if (telephonyCallback != null) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return
        val tm = getSystemService(TelephonyManager::class.java) ?: return
        runCatching {
            if (Build.VERSION.SDK_INT >= 31) {
                val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                    override fun onCallStateChanged(state: Int) = onCall(state)
                }
                tm.registerTelephonyCallback(mainExecutor, cb)
                telephonyCallback = cb
            } else {
                @Suppress("DEPRECATION")
                val l = object : android.telephony.PhoneStateListener() {
                    @Deprecated("Deprecated in Java")
                    override fun onCallStateChanged(state: Int, phoneNumber: String?) = onCall(state)
                }
                @Suppress("DEPRECATION")
                tm.listen(l, android.telephony.PhoneStateListener.LISTEN_CALL_STATE)
                telephonyCallback = l
            }
        }
    }

    private fun onCall(state: Int) {
        app.engine.ringing = state == TelephonyManager.CALL_STATE_RINGING
        app.engine.onCallState(state == TelephonyManager.CALL_STATE_OFFHOOK)
    }

    override fun onDestroy() {
        running = false
        runCatching {
            val tm = getSystemService(TelephonyManager::class.java)
            val cb = telephonyCallback
            if (Build.VERSION.SDK_INT >= 31 && cb is TelephonyCallback) tm?.unregisterTelephonyCallback(cb)
            @Suppress("DEPRECATION")
            if (cb is android.telephony.PhoneStateListener) tm?.listen(cb, android.telephony.PhoneStateListener.LISTEN_NONE)
        }
        app.engine.shutdown()
        super.onDestroy()
    }

    companion object {
        const val NOTIF_ID = 42
        const val ACTION_STOP = "com.safarzod.jarvis.STOP"
        const val ACTION_LISTEN = "com.safarzod.jarvis.LISTEN"
        const val ACTION_REFRESH = "com.safarzod.jarvis.REFRESH"
        const val ACTION_MUTE = "com.safarzod.jarvis.MUTE"
        const val EXTRA_GREET = "greet"
        @Volatile var running = false
            private set

        fun start(context: Context, greet: Boolean = false) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
            if ((context.applicationContext as JarvisApp).settings.muted.value) return
            val i = Intent(context, JarvisService::class.java).putExtra(EXTRA_GREET, greet)
            runCatching { ContextCompat.startForegroundService(context, i) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, JarvisService::class.java))
        }

        /** Разрешения поменялись — служба перепроверит, что может (например, слушать звонки). */
        fun refresh(context: Context) {
            if (!running) return
            runCatching { context.startService(Intent(context, JarvisService::class.java).setAction(ACTION_REFRESH)) }
        }

        /** Уведомление «нажмите, чтобы включить слух» — когда Android не даёт запустить микрофон из фона. */
        fun postTapToResume(context: Context) {
            val pi = PendingIntent.getActivity(context, 3, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            val n = NotificationCompat.Builder(context, JarvisApp.CH_SERVICE)
                .setSmallIcon(R.drawable.ic_stat_jarvis)
                .setContentTitle("Джарвис готов")
                .setContentText("Нажмите, чтобы включить прослушивание")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build()
            runCatching { androidx.core.app.NotificationManagerCompat.from(context).notify(43, n) }
        }
    }
}
