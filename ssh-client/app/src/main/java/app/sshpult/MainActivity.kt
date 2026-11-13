package app.sshpult

import android.os.Bundle
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
        setContent {
            SshPultTheme {
                CompositionLocalProvider(LocalApp provides container) { AppNav() }
            }
        }
    }
}
