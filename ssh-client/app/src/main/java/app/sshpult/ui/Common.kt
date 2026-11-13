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
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
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

// A deliberately quiet palette: warm paper / graphite neutrals, ink-coloured controls and one
// vermilion accent. No wallpaper-derived ("dynamic") colours, so the app looks the same everywhere.
private val LightColors = lightColorScheme(
    primary = Color(0xFF161616), onPrimary = Color(0xFFFAFAF7),
    primaryContainer = Color(0xFFE9E9E2), onPrimaryContainer = Color(0xFF161616),
    secondary = Color(0xFF55554F), onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE6E6DF), onSecondaryContainer = Color(0xFF161616),
    tertiary = Color(0xFFD9481F), onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFE3D8), onTertiaryContainer = Color(0xFF3A1004),
    background = Color(0xFFFAFAF7), onBackground = Color(0xFF161616),
    surface = Color(0xFFFAFAF7), onSurface = Color(0xFF161616),
    surfaceVariant = Color(0xFFEFEFE9), onSurfaceVariant = Color(0xFF66665F),
    surfaceTint = Color.Transparent,
    outline = Color(0xFFB4B4AB), outlineVariant = Color(0xFFE0E0D8),
    error = Color(0xFFC62828), onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFCE4E4), onErrorContainer = Color(0xFF5F1010),
    inverseSurface = Color(0xFF1C1C1A), inverseOnSurface = Color(0xFFF4F4EF), inversePrimary = Color(0xFFEDEDE8),
    surfaceBright = Color(0xFFFFFFFF), surfaceDim = Color(0xFFE4E4DD),
    surfaceContainerLowest = Color(0xFFFFFFFF), surfaceContainerLow = Color(0xFFF6F6F2),
    surfaceContainer = Color(0xFFF2F2ED), surfaceContainerHigh = Color(0xFFECECE6),
    surfaceContainerHighest = Color(0xFFE6E6DF),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFFEDEDE8), onPrimary = Color(0xFF0C0C0B),
    primaryContainer = Color(0xFF2A2A28), onPrimaryContainer = Color(0xFFEDEDE8),
    secondary = Color(0xFFB5B5AE), onSecondary = Color(0xFF0C0C0B),
    secondaryContainer = Color(0xFF2A2A28), onSecondaryContainer = Color(0xFFEDEDE8),
    tertiary = Color(0xFFFF7A4D), onTertiary = Color(0xFF2B0B00),
    tertiaryContainer = Color(0xFF4A1C0B), onTertiaryContainer = Color(0xFFFFDACC),
    background = Color(0xFF0C0C0B), onBackground = Color(0xFFEDEDE8),
    surface = Color(0xFF0C0C0B), onSurface = Color(0xFFEDEDE8),
    surfaceVariant = Color(0xFF1E1E1C), onSurfaceVariant = Color(0xFF96968F),
    surfaceTint = Color.Transparent,
    outline = Color(0xFF55554F), outlineVariant = Color(0xFF2A2A28),
    error = Color(0xFFFF6B6B), onError = Color(0xFF3A0000),
    errorContainer = Color(0xFF4A1414), onErrorContainer = Color(0xFFFFDAD6),
    inverseSurface = Color(0xFFEDEDE8), inverseOnSurface = Color(0xFF161616), inversePrimary = Color(0xFF161616),
    surfaceBright = Color(0xFF2A2A28), surfaceDim = Color(0xFF0C0C0B),
    surfaceContainerLowest = Color(0xFF131312), surfaceContainerLow = Color(0xFF161615),
    surfaceContainer = Color(0xFF1A1A18), surfaceContainerHigh = Color(0xFF212120),
    surfaceContainerHighest = Color(0xFF2A2A28),
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(14.dp), extraLarge = RoundedCornerShape(18.dp),
)

@Composable
fun SshPultTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        shapes = AppShapes, content = content,
    )
}

/** The single accent colour (caret, prompt, active markers). */
val accent: Color @Composable get() = MaterialTheme.colorScheme.tertiary

/** "Session is open" marker. */
val StatusGreen = Color(0xFF2FA35B)

/** Colours of the terminal and command output panes (always dark, like a real console). */
object TerminalColors {
    val background = Color(0xFF0B0B0A)
    val text = Color(0xFFE4E4DE)
    val dim = Color(0xFF85857E)
    val cursor = Color(0xFFFF7A4D)
    val keys = Color(0xFF151514)
    val line = Color(0xFF262624)
}

/** Flat, hairline-bordered container used instead of shadowed cards. */
@Composable
fun Panel(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val shape = MaterialTheme.shapes.medium
    val border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    val color = MaterialTheme.colorScheme.surfaceContainerLowest
    if (onClick != null) Surface(onClick = onClick, modifier = modifier, shape = shape, color = color, border = border, content = content)
    else Surface(modifier = modifier, shape = shape, color = color, border = border, content = content)
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
        Icon(painterResource(R.drawable.ic_back), contentDescription = stringResource(R.string.action_back), modifier = Modifier.size(22.dp))
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
    onDone: (() -> Unit)? = null,
) {
    var visible by remember { mutableStateOf(false) }
    SafabField(
        value = value, onValueChange = onValueChange, label = { Text(label) },
        singleLine = true, modifier = modifier, isError = isError,
        supportingText = supportingText?.let { { Text(it) } },
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Password, autoCorrectEnabled = false,
            imeAction = if (onDone != null) ImeAction.Done else ImeAction.Default,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
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
