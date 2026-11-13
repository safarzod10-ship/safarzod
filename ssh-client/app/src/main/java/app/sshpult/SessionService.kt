package app.sshpult

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Foreground service that exists only while at least one SSH session is open. It does no work
 * itself: its ongoing notification tells Android (and the user) that the app is still in use, so
 * the process and its connections are not killed when the app goes to the background.
 */
class SessionService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISCONNECT_ALL) {
            (application as? App)?.container?.sessions?.disconnectAll()
            stop()
            return START_NOT_STICKY
        }
        val names = intent?.getStringExtra(EXTRA_NAMES).orEmpty()
        try {
            val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(names), type)
        } catch (e: Exception) {
            // Not allowed right now (e.g. started while in the background): sessions simply keep
            // running without the keep-alive guarantee.
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun stop() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun buildNotification(names: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW)
                .apply { setShowBadge(false) },
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val disconnect = PendingIntent.getService(
            this, 1, Intent(this, SessionService::class.java).setAction(ACTION_DISCONNECT_ALL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_safab)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(names)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(0, getString(R.string.notif_disconnect), disconnect)
            .build()
    }

    companion object {
        private const val CHANNEL = "sessions"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_DISCONNECT_ALL = "app.sshpult.DISCONNECT_ALL"
        private const val EXTRA_NAMES = "names"

        /** Starts, updates or stops the service to match the currently open sessions. */
        fun sync(context: Context, openSessionNames: List<String>) {
            val intent = Intent(context, SessionService::class.java)
            try {
                if (openSessionNames.isEmpty()) context.stopService(intent)
                else context.startService(intent.putExtra(EXTRA_NAMES, openSessionNames.joinToString(", ")))
            } catch (e: Exception) {
                // startService is refused while the app is in the background; nothing to do then.
            }
        }
    }
}
