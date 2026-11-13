package app.sshpult

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import app.sshpult.ui.AppNav
import app.sshpult.ui.LocalApp
import app.sshpult.ui.SshPultTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as App).container
        // The "sessions are open" notification needs this permission on Android 13+. It is asked for
        // when the first session opens; sessions keep working in the background even if it is denied.
        val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
        if (Build.VERSION.SDK_INT >= 33) {
            lifecycleScope.launch {
                container.sessions.connectedIds.first { it.isNotEmpty() }
                if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }
        setContent {
            SshPultTheme {
                CompositionLocalProvider(LocalApp provides container) { AppNav() }
            }
        }
    }
}
