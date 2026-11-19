package com.safarzod.jarvis.ui

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.safarzod.jarvis.core.Need
import com.safarzod.jarvis.service.JarvisAccessibilityService
import com.safarzod.jarvis.service.JarvisNotificationListener

/** Разрешения: что нужно, выдано ли, как запросить. */
object Perms {

    fun runtime(n: Need): Array<String> = when (n) {
        Need.MIC -> arrayOf(Manifest.permission.RECORD_AUDIO)
        Need.CONTACTS -> arrayOf(Manifest.permission.READ_CONTACTS)
        Need.CALLS -> arrayOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE, Manifest.permission.ANSWER_PHONE_CALLS)
        Need.SMS -> arrayOf(Manifest.permission.SEND_SMS)
        Need.NOTIFICATIONS -> if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()
        else -> emptyArray()
    }

    fun granted(ctx: Context, n: Need): Boolean = when (n) {
        Need.OVERLAY -> Settings.canDrawOverlays(ctx)
        Need.ACCESSIBILITY -> JarvisAccessibilityService.instance != null || isA11yEnabled(ctx)
        Need.LISTENER -> isListenerEnabled(ctx)
        Need.EXACT_ALARMS -> Build.VERSION.SDK_INT < 31 || (ctx.getSystemService(AlarmManager::class.java)).canScheduleExactAlarms()
        else -> runtime(n).all { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }
    }

    fun batteryUnrestricted(ctx: Context): Boolean =
        (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName)

    fun settingsIntent(ctx: Context, n: Need): Intent? = when (n) {
        Need.OVERLAY -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
        Need.ACCESSIBILITY -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        Need.LISTENER -> if (Build.VERSION.SDK_INT >= 30) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, ComponentName(ctx, JarvisNotificationListener::class.java).flattenToString())
        } else Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        Need.EXACT_ALARMS -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}")) else null
        else -> null
    }

    fun appDetails(ctx: Context) = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))

    @Suppress("BatteryLife")
    fun batteryIntent(ctx: Context) = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))

    fun dndGranted(ctx: Context) = (ctx.getSystemService(NotificationManager::class.java)).isNotificationPolicyAccessGranted

    private fun isListenerEnabled(ctx: Context): Boolean {
        val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
        return flat.split(':').any { ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }
    }

    private fun isA11yEnabled(ctx: Context): Boolean {
        val flat = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return flat.split(':').any { ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }
    }
}
