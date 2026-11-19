package com.safarzod.jarvis.actions

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import android.telecom.TelecomManager
import android.telephony.SmsManager
import android.view.KeyEvent
import androidx.core.content.ContextCompat
import com.safarzod.jarvis.nlu.MediaAction
import com.safarzod.jarvis.nlu.MessengerApp
import com.safarzod.jarvis.nlu.PanelKind
import com.safarzod.jarvis.nlu.VolumeAction
import com.safarzod.jarvis.service.JarvisAccessibilityService
import java.net.URLEncoder
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/** Результат действия. */
/** BLOCKED — Android запретил открыть окно из фона; пользователю показано уведомление «нажмите, чтобы открыть». */
enum class Outcome { OK, NO_PERMISSION, NOT_FOUND, NO_INTERNET, UNSUPPORTED, FAILED, BLOCKED }

/** Всё, что Джарвис делает с телефоном. */
class Actions(private val context: Context) {

    /** Можно ли сейчас открывать окна (приложение на экране или есть разрешение). */
    var canLaunch: () -> Boolean = { true }
    /** Что делать, если открыть окно нельзя: показать уведомление с этим Intent. */
    var onBlocked: (Intent) -> Unit = {}

    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val camera = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    private val main = Handler(Looper.getMainLooper())

    @Volatile var torchOn = false
        private set

    init {
        runCatching {
            camera.registerTorchCallback(object : CameraManager.TorchCallback() {
                override fun onTorchModeChanged(cameraId: String, enabled: Boolean) { torchOn = enabled }
            }, main)
        }
    }

    fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    /** Можно ли открывать окна, когда Джарвис работает в фоне. */
    fun canStartFromBackground(): Boolean = Settings.canDrawOverlays(context) || JarvisAccessibilityService.instance != null

    private fun start(i: Intent): Outcome {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (!canLaunch()) {
            onBlocked(i)
            return Outcome.BLOCKED
        }
        return try {
            context.startActivity(i); Outcome.OK
        } catch (_: ActivityNotFoundException) {
            Outcome.NOT_FOUND
        } catch (_: SecurityException) {
            Outcome.NO_PERMISSION
        } catch (_: Exception) {
            Outcome.FAILED
        }
    }

    /** Открыть произвольный экран/приложение с учётом фоновых ограничений. */
    fun open(i: Intent): Outcome = start(i)

    // ---------------- связь ----------------

    fun call(number: String): Outcome {
        if (!granted(Manifest.permission.CALL_PHONE)) {
            return start(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number))))
        }
        return start(Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number))))
    }

    /**
     * Отправить SMS и дождаться ответа системы (до 12 с). Без сети / без SIM по умолчанию — FAILED,
     * а не ложное «отправлено».
     */
    suspend fun sendSms(number: String, text: String): Outcome {
        if (!granted(Manifest.permission.SEND_SMS)) return Outcome.NO_PERMISSION
        val sms = try {
            if (Build.VERSION.SDK_INT >= 31) context.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
        } catch (_: Exception) { null } ?: return Outcome.FAILED
        val parts = runCatching { sms.divideMessage(text) }.getOrNull() ?: return Outcome.FAILED
        val action = "com.safarzod.jarvis.SMS_SENT." + SystemClock.uptimeMillis()
        val result = CompletableDeferred<Outcome>()
        var remaining = parts.size
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (resultCode != Activity.RESULT_OK) { result.complete(Outcome.FAILED); return }
                remaining--
                if (remaining <= 0) result.complete(Outcome.OK)
            }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
        try {
            val sent = ArrayList<PendingIntent>()
            for (k in parts.indices) {
                sent += PendingIntent.getBroadcast(
                    context, k, Intent(action).setPackage(context.packageName),
                    PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE,
                )
            }
            if (parts.size > 1) sms.sendMultipartTextMessage(number, null, parts, sent, null)
            else sms.sendTextMessage(number, null, text, sent[0], null)
            // нет ответа за 12 с — система поставила сообщение в очередь, считаем отправленным
            return withTimeoutOrNull(12_000) { result.await() } ?: Outcome.OK
        } catch (_: Exception) {
            return Outcome.FAILED
        } finally {
            runCatching { context.unregisterReceiver(receiver) }
        }
    }

    /** Открыть чат в мессенджере с готовым текстом (отправку подтверждает сам пользователь). */
    fun openMessenger(app: MessengerApp, number: String?, text: String?): Outcome {
        val installed = runCatching { context.packageManager.getPackageInfo(app.pkg, 0); true }.getOrDefault(false)
        if (!installed) return Outcome.NOT_FOUND
        val phone = number?.let { normalizePhone(it) }
        val enc = { s: String -> URLEncoder.encode(s, "UTF-8").replace("+", "%20") }
        val intent = when (app) {
            MessengerApp.WHATSAPP -> Intent(Intent.ACTION_VIEW, Uri.parse(
                "https://api.whatsapp.com/send?" + (phone?.let { "phone=${it.removePrefix("+")}&" } ?: "") + (text?.let { "text=${enc(it)}" } ?: "")
            )).setPackage(app.pkg)
            MessengerApp.TELEGRAM -> if (phone != null) {
                Intent(Intent.ACTION_VIEW, Uri.parse("tg://resolve?phone=${phone.removePrefix("+")}" + (text?.let { "&text=${enc(it)}" } ?: ""))).setPackage(app.pkg)
            } else if (text != null) {
                Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).setPackage(app.pkg)
            } else context.packageManager.getLaunchIntentForPackage(app.pkg)
            MessengerApp.VIBER -> if (phone != null) {
                Intent(Intent.ACTION_VIEW, Uri.parse("viber://chat?number=${Uri.encode(phone)}")).setPackage(app.pkg)
            } else context.packageManager.getLaunchIntentForPackage(app.pkg)
        } ?: return Outcome.NOT_FOUND
        return start(intent)
    }

    private fun normalizePhone(p: String): String {
        val d = p.filter { it.isDigit() || it == '+' }
        return when {
            d.startsWith("+") -> d
            d.length == 11 && d.startsWith("8") -> "+7" + d.drop(1)
            d.length == 11 && d.startsWith("7") -> "+$d"
            d.length == 10 -> "+7$d"
            else -> d
        }
    }

    @SuppressLint("MissingPermission")
    fun answerCall(): Outcome {
        if (!granted(Manifest.permission.ANSWER_PHONE_CALLS)) return Outcome.NO_PERMISSION
        return runCatching {
            (context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager).acceptRingingCall(); Outcome.OK
        }.getOrDefault(Outcome.FAILED)
    }

    @SuppressLint("MissingPermission")
    fun endCall(): Outcome {
        if (Build.VERSION.SDK_INT < 28) return Outcome.UNSUPPORTED
        if (!granted(Manifest.permission.ANSWER_PHONE_CALLS)) return Outcome.NO_PERMISSION
        return runCatching {
            if ((context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager).endCall()) Outcome.OK else Outcome.NOT_FOUND
        }.getOrDefault(Outcome.FAILED)
    }

    // ---------------- интернет ----------------

    fun isOnline(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    fun openUrl(url: String): Outcome = start(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))

    fun search(base: String, query: String): Outcome = openUrl(base + URLEncoder.encode(query, "UTF-8"))

    fun youtube(query: String?): Outcome {
        if (query.isNullOrBlank()) {
            val i = context.packageManager.getLaunchIntentForPackage("com.google.android.youtube")
            return if (i != null) start(i) else openUrl("https://m.youtube.com")
        }
        val app = Intent(Intent.ACTION_SEARCH).setPackage("com.google.android.youtube").putExtra("query", query)
        val r = start(app)
        return if (r == Outcome.OK) r else openUrl("https://m.youtube.com/results?search_query=" + URLEncoder.encode(query, "UTF-8"))
    }

    fun maps(query: String, navigate: Boolean): Outcome {
        val q = Uri.encode(query)
        if (navigate) {
            val r = start(Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$q")))
            if (r == Outcome.OK) return r
        }
        return start(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$q")))
    }

    // ---------------- медиа и звук ----------------

    fun media(a: MediaAction): Outcome {
        val code = when (a) {
            MediaAction.PLAY -> KeyEvent.KEYCODE_MEDIA_PLAY
            MediaAction.PAUSE -> KeyEvent.KEYCODE_MEDIA_PAUSE
            MediaAction.NEXT -> KeyEvent.KEYCODE_MEDIA_NEXT
            MediaAction.PREV -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
        }
        val t = SystemClock.uptimeMillis()
        audio.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0))
        audio.dispatchMediaKeyEvent(KeyEvent(t, t + 20, KeyEvent.ACTION_UP, code, 0))
        return Outcome.OK
    }

    fun isMusicActive() = audio.isMusicActive

    fun volume(a: VolumeAction): Outcome = runCatching {
        val s = AudioManager.STREAM_MUSIC
        when (a) {
            VolumeAction.UP -> repeat(2) { audio.adjustStreamVolume(s, AudioManager.ADJUST_RAISE, if (it == 1) AudioManager.FLAG_SHOW_UI else 0) }
            VolumeAction.DOWN -> repeat(2) { audio.adjustStreamVolume(s, AudioManager.ADJUST_LOWER, if (it == 1) AudioManager.FLAG_SHOW_UI else 0) }
            VolumeAction.MAX -> audio.setStreamVolume(s, audio.getStreamMaxVolume(s), AudioManager.FLAG_SHOW_UI)
            VolumeAction.MUTE -> audio.adjustStreamVolume(s, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI)
            VolumeAction.UNMUTE -> {
                audio.adjustStreamVolume(s, AudioManager.ADJUST_UNMUTE, 0)
                setRinger(AudioManager.RINGER_MODE_NORMAL)
            }
            VolumeAction.SILENT -> setRinger(AudioManager.RINGER_MODE_VIBRATE)
        }
        Outcome.OK
    }.getOrDefault(Outcome.FAILED)

    private fun setRinger(mode: Int) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (mode == AudioManager.RINGER_MODE_SILENT && !nm.isNotificationPolicyAccessGranted) return
        runCatching { audio.ringerMode = mode }
    }

    /** Громкость музыки 0..1 — для индикатора на экране. */
    fun musicVolume(): Float {
        val s = AudioManager.STREAM_MUSIC
        return audio.getStreamVolume(s).toFloat() / audio.getStreamMaxVolume(s).coerceAtLeast(1)
    }

    fun torch(on: Boolean): Outcome {
        val id = runCatching {
            camera.cameraIdList.firstOrNull {
                val ch = camera.getCameraCharacteristics(it)
                ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true &&
                    ch.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            } ?: camera.cameraIdList.firstOrNull { camera.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
        }.getOrNull() ?: return Outcome.UNSUPPORTED
        return runCatching { camera.setTorchMode(id, on); torchOn = on; Outcome.OK }.getOrDefault(Outcome.FAILED)
    }

    fun panel(kind: PanelKind): Outcome {
        val action = when (kind) {
            PanelKind.WIFI -> if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS
            PanelKind.INTERNET -> if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_INTERNET_CONNECTIVITY else Settings.ACTION_DATA_ROAMING_SETTINGS
            PanelKind.NFC -> if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_NFC else Settings.ACTION_NFC_SETTINGS
            PanelKind.BLUETOOTH -> Settings.ACTION_BLUETOOTH_SETTINGS
            PanelKind.LOCATION -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            PanelKind.DISPLAY -> Settings.ACTION_DISPLAY_SETTINGS
            PanelKind.BATTERY -> Settings.ACTION_BATTERY_SAVER_SETTINGS
            PanelKind.SOUND -> if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_VOLUME else Settings.ACTION_SOUND_SETTINGS
            PanelKind.SETTINGS -> Settings.ACTION_SETTINGS
        }
        val r = start(Intent(action))
        return if (r == Outcome.OK) r else start(Intent(Settings.ACTION_SETTINGS))
    }

    // ---------------- время ----------------

    fun alarm(hour: Int, minute: Int): Outcome = start(
        Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_MESSAGE, "Джарвис")
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    )

    fun timer(seconds: Long): Outcome = start(
        Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds.coerceIn(1, 86_399).toInt())
            .putExtra(AlarmClock.EXTRA_MESSAGE, "Джарвис")
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    )

    // ---------------- экран ----------------

    fun camera(selfie: Boolean): Outcome {
        val i = Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
        if (selfie) {
            i.putExtra("android.intent.extras.CAMERA_FACING", 1)
            i.putExtra("android.intent.extras.LENS_FACING_FRONT", 1)
            i.putExtra("android.intent.extra.USE_FRONT_CAMERA", true)
        }
        return start(i)
    }

    fun screenshot(): Outcome {
        val s = JarvisAccessibilityService.instance ?: return Outcome.NO_PERMISSION
        if (Build.VERSION.SDK_INT < 28) return Outcome.UNSUPPORTED
        return if (s.performGlobalAction(AccessibilityService.GLOBAL_ACTION_TAKE_SCREENSHOT)) Outcome.OK else Outcome.FAILED
    }

    fun lock(): Outcome {
        val s = JarvisAccessibilityService.instance ?: return Outcome.NO_PERMISSION
        if (Build.VERSION.SDK_INT < 28) return Outcome.UNSUPPORTED
        return if (s.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)) Outcome.OK else Outcome.FAILED
    }

    fun home(): Outcome {
        JarvisAccessibilityService.instance?.let { if (it.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)) return Outcome.OK }
        return start(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))
    }

    fun back(): Outcome {
        val s = JarvisAccessibilityService.instance ?: return Outcome.NO_PERMISSION
        return if (s.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)) Outcome.OK else Outcome.FAILED
    }

    data class Battery(val percent: Int, val charging: Boolean, val temperatureC: Float?)

    fun battery(): Battery {
        val i = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = i?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val temp = i?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)?.takeIf { it != Int.MIN_VALUE }?.let { it / 10f }
        val pct = if (level >= 0 && scale > 0) level * 100 / scale else
            (context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return Battery(pct, status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL, temp)
    }
}
