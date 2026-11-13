package app.sshpult.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.widget.Toast
import androidx.annotation.DrawableRes
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.sshpult.AppContainer
import app.sshpult.R
import app.sshpult.ssh.SshError

val LocalApp = staticCompositionLocalOf<AppContainer> { error("AppContainer not provided") }

private val LightColors = lightColorScheme(
    primary = Color(0xFF0F766E), onPrimary = Color.White,
    primaryContainer = Color(0xFFA7F3E6), onPrimaryContainer = Color(0xFF00201C),
    secondary = Color(0xFF4A635F), onSecondary = Color.White,
    secondaryContainer = Color(0xFFCCE8E2), onSecondaryContainer = Color(0xFF06201C),
    tertiary = Color(0xFF456179), onTertiary = Color.White,
    background = Color(0xFFF7FAF9), surface = Color(0xFFF7FAF9),
    surfaceVariant = Color(0xFFDAE5E2), onSurfaceVariant = Color(0xFF3F4947),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFF5EEAD4), onPrimary = Color(0xFF003731),
    primaryContainer = Color(0xFF005048), onPrimaryContainer = Color(0xFFA7F3E6),
    secondary = Color(0xFFB1CCC6), onSecondary = Color(0xFF1C3531),
    secondaryContainer = Color(0xFF334B47), onSecondaryContainer = Color(0xFFCCE8E2),
    tertiary = Color(0xFFADCAE6), onTertiary = Color(0xFF153349),
    background = Color(0xFF0E1513), surface = Color(0xFF0E1513),
    surfaceVariant = Color(0xFF3F4947), onSurfaceVariant = Color(0xFFBEC9C6),
)

@Composable
fun SshPultTheme(dynamicColor: Boolean = true, content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(LocalContext.current) else dynamicLightColorScheme(LocalContext.current)
        dark -> DarkColors
        else -> LightColors
    }
    MaterialTheme(colorScheme = colors, content = content)
}

/** Colours of the terminal and command output panes (always dark, like a real console). */
object TerminalColors {
    val background = Color(0xFF0B1210)
    val text = Color(0xFFD7E3DF)
    val dim = Color(0xFF8A9A95)
    val accent = Color(0xFF5EEAD4)
}

/** Human-readable, localized explanation of a failure. */
fun errorText(context: Context, e: Throwable, keyAuth: Boolean = false): String = when (e) {
    is SshError.AuthFailed -> context.getString(if (keyAuth) R.string.err_auth_key else R.string.err_auth_password)
    is SshError.HostNotFound -> context.getString(R.string.err_host_not_found, e.host)
    is SshError.ConnectionRefused -> context.getString(R.string.err_refused)
    is SshError.Unreachable -> context.getString(R.string.err_unreachable)
    is SshError.Timeout -> context.getString(R.string.err_timeout)
    is SshError.BadPrivateKey -> context.getString(R.string.err_bad_key)
    is SshError.PassphraseRequired -> context.getString(R.string.err_passphrase_required)
    is SshError.WrongPassphrase -> context.getString(R.string.err_wrong_passphrase)
    is SshError.Disconnected -> context.getString(R.string.err_disconnected)
    is SshError.PermissionDenied -> context.getString(R.string.err_permission, e.path)
    is SshError.NoSuchFile -> context.getString(R.string.err_no_such_file, e.path)
    is SshError.Cancelled -> context.getString(R.string.err_cancelled)
    is SshError.PasswordRequired -> context.getString(R.string.err_password_required)
    is SshError.UnknownHostKey, is SshError.HostKeyChanged -> context.getString(R.string.err_host_key)
    is SshError.Other -> context.getString(R.string.err_other, e.detail)
    else -> context.getString(R.string.err_other, e.message ?: e.javaClass.simpleName)
}

fun copyToClipboard(context: Context, label: String, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText(label, text))
    // Android 13+ shows its own confirmation.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        Toast.makeText(context, R.string.copied, Toast.LENGTH_SHORT).show()
    }
}

@Composable
fun BackButton(onBack: () -> Unit) {
    IconButton(onClick = onBack) {
        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
    }
}

/** Centers content and keeps it at a comfortable reading width on tablets and foldables. */
@Composable
fun CenteredContent(modifier: Modifier = Modifier, maxWidth: Int = 640, content: @Composable () -> Unit) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = maxWidth.dp).fillMaxWidth()) { content() }
    }
}

@Composable
fun EmptyState(@DrawableRes icon: Int, title: String, text: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            painterResource(icon), contentDescription = null,
            modifier = Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            text, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun ConfirmDialog(
    title: String, text: String, confirmLabel: String,
    onConfirm: () -> Unit, onDismiss: () -> Unit, destructive: Boolean = true,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirmLabel, color = if (destructive) MaterialTheme.colorScheme.error else Color.Unspecified)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** Password field with a show/hide toggle. */
@Composable
fun SecretField(
    value: String, onValueChange: (String) -> Unit, label: String,
    modifier: Modifier = Modifier, supportingText: String? = null, isError: Boolean = false,
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value, onValueChange = onValueChange, label = { Text(label) },
        singleLine = true, modifier = modifier, isError = isError,
        supportingText = supportingText?.let { { Text(it) } },
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
        trailingIcon = {
            IconButton(onClick = { visible = !visible }) {
                Icon(
                    painterResource(if (visible) R.drawable.ic_eye_off else R.drawable.ic_eye),
                    contentDescription = stringResource(if (visible) R.string.password_hide else R.string.password_show),
                )
            }
        },
    )
}
